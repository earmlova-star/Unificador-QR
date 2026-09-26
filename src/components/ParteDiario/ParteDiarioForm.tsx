import { Fragment, useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { db, storage } from '@lib/supabase'
import {
  ActividadEjecutada,
  CARGOS_DIRECTOS,
  CARGOS_INDIRECTOS,
  CuadrillaManoObra,
  EQUIPOS_MAQUINARIA,
  Faena,
  FAENA_LABELS,
  GrupoMaquinaria,
  HH_TURNO_POR_FAENA,
  ParteDiario,
  ParteDiarioEstado,
  Usuario,
} from '@/types/index'
import { FotoPendiente, GestorFotos } from './GestorFotos'
import { DailyReportExcelPreview } from './DailyReportExcelPreview'
import { traducirError } from '@lib/errores'
import { useAutoguardado, leerBorrador, haceCuanto } from '@hooks/useBorradorLocal'
import { hhDeFila, hhTotales, permisoDescanso } from '@lib/calculosHH'
import {
  actividadesValidas,
  horasDirectaPorActividad,
  horasMaquinariaCalculadas,
  horasMaquinariaPorActividad,
  indicesActividadesValidas,
  realinearActividadesCuadrilla,
  quitarActividad as quitarActividadYRealinear,
} from '@lib/actividades'
import { HH_DIRECTAS_PROGRAMADO_POR_FECHA } from '@lib/hhProgramadoSchedule'

interface ParteDiarioFormProps {
  usuario: Usuario
  contrato: any
  // Si viene seteado, el formulario entra en modo edición: hidrata todos
  // los campos desde este Daily Report existente en vez de partir vacío, y
  // guardar() hace un update en lugar de un insert.
  parteExistente?: ParteDiario
  onGuardado: () => void
  onCancelar: () => void
}

const MAX_ACTIVIDADES = 7

// Control interno: la suma de "Cantidad" (HH x actividad) de Actividades
// Ejecutadas debe llegar al mínimo de HH_TURNO_POR_FAENA[faena] para
// poder enviar el reporte. Aplica solo al enviar (nuevo envío o
// borrador→enviado) — no bloquea "Guardar borrador" ni "Guardar cambios"
// sobre un reporte ya enviado (pedido explícito, ver conversación del
// 2026-08-23). El mismo HH_TURNO_POR_FAENA también define "HH por Día"
// (J9 del Excel) y el multiplicador de HH Total de Fuerza laboral
// indirecta — antes fijo en 10/11 para todos, ahora depende de la faena.

const actividadVacia = (): ActividadEjecutada => ({ area: '', descripcion: '', cantidad: null })

// El campo "Cantidad" de Actividades Ejecutadas ahora guarda las HH que
// dura esa actividad en particular (ej: 0,5) — no una cantidad de items.
// Las HH de Fuerza laboral directa por actividad se calculan solas a
// partir de eso: cantidad (HH x actividad) × operativos del cargo (ej:
// actividad 1 dura 0,5 → cada técnico operativo suma 0,5 HH en esa
// columna). Por eso FilaManoObraDirecta ya no guarda "horas" como estado
// propio — se deriva en cada render con calcularHorasCargo() más abajo.
interface FilaManoObraDirecta {
  cargo: string
  contratados: number
  operativos: number
  // Desglose opcional por cuadrilla (supervisor + su grupo de técnicos) —
  // ver CuadrillaManoObra en types/index.ts. Si existe, `operativos` de
  // arriba deja de tipearse a mano y pasa a ser la suma de estas (ver
  // operativosEfectivos más abajo).
  cuadrillas?: CuadrillaManoObra[]
}

interface FilaManoObraIndirecta {
  cargo: string
  contratados: number
  operativos: number
}

interface FilaMaquinaria {
  equipo: string
  cantidad: number
  mantencion: number
  standby: number
  horas: number[]
  // Desglose opcional por grupo (cantidad de equipos por actividad) — ver
  // GrupoMaquinaria en types/index.ts. Si existe, las Act.N de este equipo
  // dejan de tipearse a mano y pasan a calcularse solas (ver
  // calcularHorasMaquinaria más abajo) — igual que cuadrillas en
  // FilaManoObraDirecta.
  grupos?: GrupoMaquinaria[]
}

const sumar = (valores: number[]) => valores.reduce((acc, v) => acc + (v || 0), 0)

// Invierte la posición actIndex de un array de participación por
// actividad (cuadrilla o grupo de maquinaria), extendiéndolo con `false`
// primero si hace falta. Hallazgo QA 2026-09-25: hacer `actividades[actIndex]
// = !actividades[actIndex]` directo en un array más corto que actIndex deja
// posiciones intermedias como huecos dispersos de verdad (no `false`) —
// Array.prototype.filter() (usado al realinear en quitarActividad, ver
// src/lib/actividades.ts) nunca visita un hueco, así que esas posiciones
// se pierden en vez de correrse, corrompiendo el realineo de esa cuadrilla/
// grupo la próxima vez que se borre una actividad anterior.
function alternarEnIndice(actividades: boolean[], actIndex: number): boolean[] {
  const siguiente = Array.from({ length: Math.max(actividades.length, actIndex + 1) }, (_, i) => actividades[i] ?? false)
  siguiente[actIndex] = !siguiente[actIndex]
  return siguiente
}

// Formulario completo de Daily Report — ver MAPEO_CAMPOS.md para el detalle
// celda por celda del Excel que cada sección alimenta. Los cálculos
// (Permiso-Descanso, HH/HM Total x Act., Operativos, totales, acumulados)
// se hacen acá igual que las fórmulas del Excel original, para que el
// usuario vea los mismos números antes de generar el archivo.
export const ParteDiarioForm = ({ usuario, contrato, parteExistente, onGuardado, onCancelar }: ParteDiarioFormProps) => {
  const editando = Boolean(parteExistente)
  // Si el reporte ya fue enviado (o comentado por el mandante), editarlo no
  // puede volver a pisar el estado — solo se corrigen los datos del
  // reporte. Solo en borrador siguen disponibles los dos botones de
  // siempre (guardar como borrador / enviar).
  const estadoBloqueado = Boolean(parteExistente && parteExistente.estado !== ParteDiarioEstado.BORRADOR)

  const [fecha, setFecha] = useState(() => parteExistente?.fecha ?? new Date().toISOString().slice(0, 10))
  const [condicionClimatica, setCondicionClimatica] = useState(() => parteExistente?.condicion_climatica ?? '')
  // La faena se elige solo una vez: al crear un reporte nuevo, mediante la
  // ventana obligatoria de abajo (ver <Dialog.Root> más abajo en el
  // render); al editar uno existente, ya viene fija desde parteExistente.
  // En ningún caso se puede cambiar después — cambiarla no recalcula los
  // acumulados (ver "Al editar NO se tocan las columnas *_acumuladas" más
  // abajo en guardar()), así que si se pudiera editar libremente un
  // reporte ya guardado quedaría con datos de una faena pero acumulados
  // de la cadena de otra.
  const [faena, setFaena] = useState<Faena>(() => parteExistente?.faena ?? Faena.LT)
  // Controla las dos ventanas obligatorias al crear un reporte nuevo:
  // primero fecha, después faena (pedido explícito) — el formulario
  // completo queda tapado hasta que ambas estén elegidas, sin forma de
  // cerrarlas antes. Arrancan sin elegir (false) solo cuando !editando; al
  // editar, ya vienen "elegidas" de entrada porque fecha y faena vienen
  // fijas desde parteExistente.
  const [fechaElegida, setFechaElegida] = useState<boolean>(editando)
  const [faenaElegida, setFaenaElegida] = useState<boolean>(editando)
  const [actividades, setActividades] = useState<ActividadEjecutada[]>(() =>
    parteExistente && parteExistente.actividades.length > 0
      ? parteExistente.actividades.map((a) => ({ ...a }))
      : [actividadVacia()]
  )

  const [manoObraDirecta, setManoObraDirecta] = useState<FilaManoObraDirecta[]>(() =>
    CARGOS_DIRECTOS.map((cargo) => {
      const existente = parteExistente?.mano_obra_directa.find((f) => f.cargo === cargo)
      return {
        cargo,
        contratados: existente?.contratados ?? 0,
        operativos: existente?.operativos ?? 0,
        cuadrillas: existente?.cuadrillas?.map((c) => ({ ...c, actividades: [...c.actividades] })),
      }
    })
  )
  // Qué cargos de mano de obra directa tienen su desglose de cuadrillas
  // desplegado — solo estado de UI, no se guarda (cargo es único dentro de
  // CARGOS_DIRECTOS así que sirve como key).
  const [cargosExpandidos, setCargosExpandidos] = useState<Set<string>>(new Set())
  const [manoObraIndirecta, setManoObraIndirecta] = useState<FilaManoObraIndirecta[]>(() =>
    CARGOS_INDIRECTOS.map((cargo) => {
      const existente = parteExistente?.mano_obra_indirecta.find((f) => f.cargo === cargo)
      return {
        cargo,
        contratados: existente?.contratados ?? 0,
        operativos: existente?.operativos ?? 0,
      }
    })
  )
  const [maquinaria, setMaquinaria] = useState<FilaMaquinaria[]>(() =>
    EQUIPOS_MAQUINARIA.map((equipo) => {
      const existente = parteExistente?.maquinaria.find((f) => f.equipo === equipo)
      return {
        equipo,
        cantidad: existente?.cantidad ?? 0,
        mantencion: existente?.mantencion ?? 0,
        standby: existente?.standby ?? 0,
        horas: existente?.horas_por_actividad ? [...existente.horas_por_actividad] : [],
        grupos: existente?.grupos?.map((g) => ({ ...g, actividades: [...g.actividades] })),
      }
    })
  )
  // Qué equipos de Maquinaria tienen su desglose de grupos desplegado —
  // solo estado de UI, no se guarda (equipo es único dentro de
  // EQUIPOS_MAQUINARIA así que sirve como key).
  const [equiposExpandidos, setEquiposExpandidos] = useState<Set<string>>(new Set())

  const [jornada, setJornada] = useState(() => {
    const j = parteExistente?.jornada
    return {
      inicio: j?.inicio ?? '08:00',
      fin: j?.fin ?? '18:00',
      efectivaEntrada: j?.horas_efectivas?.entrada ?? '08:00',
      efectivaSalida: j?.horas_efectivas?.salida ?? '19:00',
      perdidaEntrada: j?.horas_perdidas?.entrada ?? '00:00',
      perdidaSalida: j?.horas_perdidas?.salida ?? '00:00',
    }
  })

  const [hhDirectasProgramado, setHhDirectasProgramado] = useState(() => parteExistente?.hh_directas_programado ?? 0)
  const [hhIndirectasProgramado, setHhIndirectasProgramado] = useState(
    () => parteExistente?.hh_indirectas_programado ?? 0
  )

  // Autocompleta "HH Directas — Programado" según la fecha elegida, con el
  // cronograma del contrato (HH_DIRECTAS_PROGRAMADO_POR_FECHA). Solo al
  // crear un reporte nuevo (no editando uno existente, para no pisar un
  // valor ya guardado/corregido a mano) — y solo autocompleta, el campo
  // sigue siendo un input editable normal: si la persona lo corrige a
  // mano después de esto, su valor queda tal cual hasta que vuelva a
  // cambiar la fecha.
  useEffect(() => {
    if (editando) return
    setHhDirectasProgramado(HH_DIRECTAS_PROGRAMADO_POR_FECHA[fecha] ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, editando])

  const [comentarioContratistaAutor, setComentarioContratistaAutor] = useState(
    () => parteExistente?.comentario_contratista_autor ?? usuario.nombre
  )
  const [comentarioContratista, setComentarioContratista] = useState(
    () => parteExistente?.comentario_contratista ?? ''
  )

  const [fotos, setFotos] = useState<FotoPendiente[]>(() =>
    (parteExistente?.fotos ?? []).map((f) => ({
      url: f.url,
      caption: f.caption ?? '',
      preview: f.url,
      actividadIndex: f.actividadIndex,
    }))
  )
  // Qué secciones de "Fotos por actividad" están abiertas. -1 es la sección
  // "Sin actividad asignada" (fotos de reportes guardados antes de este
  // cambio, o que quedaron sin actividad al borrarse la suya — ver
  // quitarActividad más abajo).
  const [fotosExpandidas, setFotosExpandidas] = useState<Set<number>>(new Set())
  const alternarFotosExpandida = (idx: number) => {
    setFotosExpandidas((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(idx)) siguiente.delete(idx)
      else siguiente.add(idx)
      return siguiente
    })
  }

  const [numeroReporte, setNumeroReporte] = useState<number | null>(() => parteExistente?.numero_reporte ?? null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState<'borrador' | 'enviado' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Al terminar de guardar, en vez de volver directo a la lista (como
  // antes) se muestra una pantalla de confirmación con un botón "Ver
  // Daily Report" que abre la vista previa tipo Excel — pedido explícito
  // ("al crear un daily coloca un botón para poder ver el daily final
  // creado al estilo modal", ver conversación del 2026-08-24). parteGuardada
  // se llena con el registro recién guardado, vuelto a pedir completo
  // (con usuario_creador y firma_url incluidos, que ni crearParteDiario ni
  // actualizarParteDiario devuelven) para que la vista previa tenga todo
  // lo que necesita, igual que ParteDiarioDetalle.
  const [parteGuardada, setParteGuardada] = useState<ParteDiario | null>(null)
  const [mostrarVistaPrevia, setMostrarVistaPrevia] = useState(false)
  // Id del reporte si un intento anterior ya alcanzó a crearlo — ver el
  // comentario en guardar(). Evita que un reintento inserte por segunda vez.
  const [parteCreadoId, setParteCreadoId] = useState<string | null>(null)

  const numActividades = Math.min(Math.max(actividades.length, 1), MAX_ACTIVIDADES)

  // ---------- Autoguardado local ----------
  // Solo para reportes nuevos: al editar uno existente, el original ya está
  // a salvo en el servidor y un borrador local solo confundiría.
  const claveBorrador = `daily:${contrato?.id ?? 'sin-contrato'}:${usuario.id}`

  const datosBorrador = {
    fecha,
    condicionClimatica,
    faena,
    actividades,
    manoObraDirecta,
    manoObraIndirecta,
    maquinaria,
    jornada,
    hhDirectasProgramado,
    hhIndirectasProgramado,
    comentarioContratistaAutor,
    comentarioContratista,
    // Las fotos NO van: son objetos File, que no se pueden serializar. Se
    // avisa al recuperar el borrador.
  }

  const { guardadoEn, limpiar: limpiarBorrador } = useAutoguardado(
    claveBorrador,
    datosBorrador,
    !editando && faenaElegida && !parteGuardada
  )

  const [borradorDisponible, setBorradorDisponible] = useState(() =>
    editando ? null : leerBorrador<typeof datosBorrador>(claveBorrador)
  )

  const recuperarBorrador = () => {
    if (!borradorDisponible) return
    const d = borradorDisponible.datos
    setFecha(d.fecha)
    setFechaElegida(true)
    setCondicionClimatica(d.condicionClimatica)
    setFaena(d.faena)
    setFaenaElegida(true)
    setActividades(d.actividades)
    setManoObraDirecta(d.manoObraDirecta)
    setManoObraIndirecta(d.manoObraIndirecta)
    setMaquinaria(d.maquinaria)
    setJornada(d.jornada)
    setHhDirectasProgramado(d.hhDirectasProgramado)
    setHhIndirectasProgramado(d.hhIndirectasProgramado)
    setComentarioContratistaAutor(d.comentarioContratistaAutor)
    setComentarioContratista(d.comentarioContratista)
    setBorradorDisponible(null)
  }

  const descartarBorrador = () => {
    limpiarBorrador()
    setBorradorDisponible(null)
  }

  useEffect(() => {
    // En modo edición el N° de reporte ya viene fijo desde parteExistente —
    // no hay que pedir uno nuevo (correría el correlativo innecesariamente).
    if (editando) return
    if (!contrato?.id) return
    setIsLoading(true)
    // Solo previsualiza (no reserva/incrementa el contador): este efecto
    // corre cada vez que se ABRE el formulario, incluso si el usuario
    // termina cancelando sin guardar. El número real se pide recién al
    // guardar (ver guardar()) — bug de saltos de correlativo 2026-09-26.
    db.previsualizarSiguienteNumeroParte(contrato.id)
      .then(setNumeroReporte)
      .catch((err) => setError(traducirError(err, 'No se pudo obtener el N° de reporte')))
      .finally(() => setIsLoading(false))
  }, [contrato?.id, editando])

  // ---------- Actividades ----------
  const actualizarActividad = (index: number, campo: keyof ActividadEjecutada, valor: string) => {
    setActividades((prev) =>
      prev.map((act, i) =>
        i === index
          ? { ...act, [campo]: campo === 'cantidad' ? (valor === '' ? null : Number(valor)) : valor }
          : act
      )
    )
  }
  const agregarActividad = () => {
    if (actividades.length >= MAX_ACTIVIDADES) return
    setActividades((prev) => [...prev, actividadVacia()])
  }
  // Quitar una actividad tiene que sacar esa misma posición de las horas de
  // Maquinaria y de la participación de cada cuadrilla de mano de obra
  // directa (estado propio por posición, a diferencia del resto de Directa
  // que se deriva sola) — ver src/lib/actividades.ts para el porqué y sus pruebas.
  const quitarActividad = (index: number) => {
    const resultado = quitarActividadYRealinear(actividades, maquinaria, index, manoObraDirecta)
    setActividades(resultado.actividades)
    setMaquinaria(resultado.maquinaria)
    if (resultado.manoObraDirecta) setManoObraDirecta(resultado.manoObraDirecta)
    // Las fotos de la actividad borrada quedan "sin actividad asignada"
    // (no se borran) y las de las actividades siguientes bajan un puesto,
    // para seguir apuntando a la misma actividad de siempre.
    setFotos((prev) =>
      prev.map((f) =>
        f.actividadIndex === undefined
          ? f
          : f.actividadIndex === index
          ? { ...f, actividadIndex: undefined }
          : f.actividadIndex > index
          ? { ...f, actividadIndex: f.actividadIndex - 1 }
          : f
      )
    )
  }

  // ---------- Mano de obra directa ----------
  const actualizarDirecta = (index: number, campo: 'contratados' | 'operativos', valor: string) => {
    setManoObraDirecta((prev) =>
      prev.map((f, i) => (i === index ? { ...f, [campo]: Number(valor) || 0 } : f))
    )
  }

  // Operativos "de verdad" de un cargo: si tiene cuadrillas, es la suma de
  // sus operativos (el campo Operativos del cargo pasa a ser de solo
  // lectura); si no, es el número tipeado a mano de siempre. Todo lo que
  // antes leía fila.operativos para mostrar/calcular pasa a usar esto, para
  // que un cargo sin cuadrillas siga funcionando exactamente igual que hoy.
  const operativosEfectivos = (fila: FilaManoObraDirecta): number =>
    fila.cuadrillas && fila.cuadrillas.length > 0 ? sumar(fila.cuadrillas.map((c) => c.operativos)) : fila.operativos

  // HH de un cargo en cada actividad = HH que dura la actividad (el
  // "Cantidad" de Actividades Ejecutadas) × operativos de ese cargo — o,
  // si el cargo tiene cuadrillas (supervisor + su grupo, pedido explícito
  // 2026-09-24), solo los operativos de las cuadrillas que marcaron
  // participar en esa actividad puntual, no el total del cargo repartido
  // por igual en todas. Ya no se tipea a mano por celda — se deriva en
  // cada render, así que si algo cambia, la tabla se actualiza sola.
  const calcularHorasCargo = (fila: FilaManoObraDirecta): number[] => {
    const acts = actividades.slice(0, numActividades)
    if (fila.cuadrillas && fila.cuadrillas.length > 0) {
      const cuadrillas = fila.cuadrillas
      return acts.map((act, i) => {
        const operativosEnActividad = sumar(cuadrillas.map((c) => (c.actividades[i] ? c.operativos : 0)))
        return (act.cantidad ?? 0) * operativosEnActividad
      })
    }
    return acts.map((act) => (act.cantidad ?? 0) * fila.operativos)
  }

  // ---------- Cuadrillas de mano de obra directa ----------
  const alternarCargoExpandido = (cargo: string) => {
    setCargosExpandidos((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(cargo)) siguiente.delete(cargo)
      else siguiente.add(cargo)
      return siguiente
    })
  }

  const agregarCuadrilla = (index: number) => {
    setCargosExpandidos((prev) => new Set(prev).add(manoObraDirecta[index].cargo))
    setManoObraDirecta((prev) =>
      prev.map((f, i) =>
        i === index
          ? {
              ...f,
              cuadrillas: [
                ...(f.cuadrillas ?? []),
                { id: crypto.randomUUID(), supervisor: '', operativos: 0, actividades: Array(numActividades).fill(false) },
              ],
            }
          : f
      )
    )
  }

  const eliminarCuadrilla = (index: number, cuadrillaId: string) => {
    setManoObraDirecta((prev) =>
      prev.map((f, i) => (i === index ? { ...f, cuadrillas: f.cuadrillas?.filter((c) => c.id !== cuadrillaId) } : f))
    )
  }

  const actualizarCuadrilla = (index: number, cuadrillaId: string, campo: 'supervisor' | 'operativos', valor: string) => {
    setManoObraDirecta((prev) =>
      prev.map((f, i) =>
        i === index
          ? {
              ...f,
              cuadrillas: f.cuadrillas?.map((c) =>
                c.id === cuadrillaId ? { ...c, [campo]: campo === 'operativos' ? Number(valor) || 0 : valor } : c
              ),
            }
          : f
      )
    )
  }

  const alternarActividadCuadrilla = (index: number, cuadrillaId: string, actIndex: number) => {
    setManoObraDirecta((prev) =>
      prev.map((f, i) =>
        i === index
          ? {
              ...f,
              cuadrillas: f.cuadrillas?.map((c) =>
                c.id === cuadrillaId ? { ...c, actividades: alternarEnIndice(c.actividades, actIndex) } : c
              ),
            }
          : f
      )
    )
  }

  // ---------- Mano de obra indirecta ----------
  const actualizarIndirecta = (index: number, campo: 'contratados' | 'operativos', valor: string) => {
    setManoObraIndirecta((prev) =>
      prev.map((f, i) => (i === index ? { ...f, [campo]: Number(valor) || 0 } : f))
    )
  }

  // ---------- Maquinaria ----------
  const actualizarMaquinaria = (
    index: number,
    campo: 'cantidad' | 'mantencion' | 'standby',
    valor: string
  ) => {
    setMaquinaria((prev) => prev.map((f, i) => (i === index ? { ...f, [campo]: Number(valor) || 0 } : f)))
  }
  const actualizarHorasMaquinaria = (index: number, actIndex: number, valor: string) => {
    setMaquinaria((prev) =>
      prev.map((f, i) => {
        if (i !== index) return f
        const horas = [...f.horas]
        horas[actIndex] = Number(valor) || 0
        return { ...f, horas }
      })
    )
  }

  // HM de un equipo en cada actividad = HH que dura la actividad × cantidad
  // de equipos de ese grupo participando — mismo mecanismo (y mismo motivo
  // para no reusar horasMaquinariaCalculadas acá: esa filtra actividades en
  // blanco, pensada para guardar; en vivo hay que mostrar las numActividades
  // columnas tal cual están en pantalla) que calcularHorasCargo con
  // cuadrillas. Sin grupos, sigue el tipeo manual de siempre por celda.
  const calcularHorasMaquinaria = (fila: FilaMaquinaria): number[] => {
    const acts = actividades.slice(0, numActividades)
    if (fila.grupos && fila.grupos.length > 0) {
      const grupos = fila.grupos
      return acts.map((act, i) => {
        const cantidadEnActividad = sumar(grupos.map((g) => (g.actividades[i] ? g.cantidad : 0)))
        return (act.cantidad ?? 0) * cantidadEnActividad
      })
    }
    // Igual que Array.from({length:numActividades}) — SIEMPRE numActividades
    // celdas, sin importar cuánto mida fila.horas todavía. `.slice()` sobre
    // un array más corto (p. ej. [] en un equipo recién creado) devolvía
    // MENOS celdas que columnas de encabezado: en un equipo nuevo (horas=[])
    // no salía NINGÚN input para tipear, sin ningún error visible.
    return Array.from({ length: numActividades }, (_, i) => fila.horas[i] ?? 0)
  }

  // ---------- Grupos de Maquinaria ----------
  const alternarEquipoExpandido = (equipo: string) => {
    setEquiposExpandidos((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(equipo)) siguiente.delete(equipo)
      else siguiente.add(equipo)
      return siguiente
    })
  }

  const agregarGrupoMaquinaria = (index: number) => {
    setEquiposExpandidos((prev) => new Set(prev).add(maquinaria[index].equipo))
    setMaquinaria((prev) =>
      prev.map((f, i) =>
        i === index
          ? { ...f, grupos: [...(f.grupos ?? []), { id: crypto.randomUUID(), cantidad: 0, actividades: Array(numActividades).fill(false) }] }
          : f
      )
    )
  }

  const eliminarGrupoMaquinaria = (index: number, grupoId: string) => {
    setMaquinaria((prev) => prev.map((f, i) => (i === index ? { ...f, grupos: f.grupos?.filter((g) => g.id !== grupoId) } : f)))
  }

  const actualizarGrupoMaquinaria = (index: number, grupoId: string, valor: string) => {
    setMaquinaria((prev) =>
      prev.map((f, i) =>
        i === index ? { ...f, grupos: f.grupos?.map((g) => (g.id === grupoId ? { ...g, cantidad: Number(valor) || 0 } : g)) } : f
      )
    )
  }

  const alternarActividadGrupoMaquinaria = (index: number, grupoId: string, actIndex: number) => {
    setMaquinaria((prev) =>
      prev.map((f, i) =>
        i === index
          ? {
              ...f,
              grupos: f.grupos?.map((g) =>
                g.id === grupoId ? { ...g, actividades: alternarEnIndice(g.actividades, actIndex) } : g
              ),
            }
          : f
      )
    )
  }

  // ---------- Totales calculados (mismas fórmulas que el Excel) ----------
  const totalHhDirectas = sumar(manoObraDirecta.map((f) => sumar(calcularHorasCargo(f))))
  const totalHhIndirectas = hhTotales(faena, manoObraIndirecta)
  const totalHm = sumar(maquinaria.map((f) => sumar(calcularHorasMaquinaria(f))))

  // Suma de "Cantidad" (HH x actividad) de Actividades Ejecutadas — es
  // solo control interno de visualización + validación al enviar (ver
  // HH_TURNO_POR_FAENA más abajo), no alimenta ninguna celda del Excel.
  const totalHhActividades = sumar(actividades.slice(0, numActividades).map((a) => a.cantidad ?? 0))
  // Redondeo a 2 decimales para evitar artefactos de punto flotante
  // (ej: 0.1 + 0.2) al mostrar/comparar la suma.
  const totalHhActividadesRedondeado = Math.round(totalHhActividades * 100) / 100
  const minHhActividades = HH_TURNO_POR_FAENA[faena]

  const guardar = async (estadoFinal: ParteDiarioEstado.BORRADOR | ParteDiarioEstado.ENVIADO) => {
    if (!contrato?.id) return
    if (!editando && numeroReporte === null) return

    // Bloqueo duro de HH x actividad, solo al enviar (nuevo envío o
    // borrador→enviado). No aplica a "Guardar borrador" ni a "Guardar
    // cambios" sobre un reporte que ya estaba enviado (estadoBloqueado) —
    // ese botón reutiliza estadoFinal=ENVIADO pero es una corrección de
    // datos, no un envío nuevo. El mínimo depende de la faena elegida.
    if (estadoFinal === ParteDiarioEstado.ENVIADO && !estadoBloqueado && totalHhActividadesRedondeado < minHhActividades) {
      setError(
        `La suma de HH x actividad es ${totalHhActividadesRedondeado} y debe llegar al menos a ${minHhActividades} HH (mínimo de ${FAENA_LABELS[faena]}) para enviar el reporte. Puedes guardarlo como borrador mientras completas las actividades.`
      )
      return
    }

    setIsSaving(estadoFinal)
    setError(null)

    try {
      // Las filas de actividad en blanco (típico dejar una vacía a medias) se
      // filtran ANTES de calcular las horas por actividad, y con los mismos
      // índices para ambas cosas — ver src/lib/actividades.ts y sus pruebas.
      const actividadesAGuardar = actividadesValidas(actividades)

      const camposComunes = {
        fecha,
        condicion_climatica: condicionClimatica || null,
        faena,

        actividades: actividadesAGuardar,
        mano_obra_directa: manoObraDirecta.map((f) => {
          const cuadrillasRealineadas = f.cuadrillas?.map((c) => ({
            ...c,
            actividades: realinearActividadesCuadrilla(actividades, c.actividades),
          }))
          const operativos = operativosEfectivos(f)
          return {
            cargo: f.cargo,
            contratados: f.contratados,
            operativos,
            horas_por_actividad: horasDirectaPorActividad(actividades, operativos, cuadrillasRealineadas),
            cuadrillas: cuadrillasRealineadas,
          }
        }),
        mano_obra_indirecta: manoObraIndirecta.map((f) => ({
          cargo: f.cargo,
          contratados: f.contratados,
          operativos: f.operativos,
        })),
        maquinaria: maquinaria.map((f) => {
          const gruposRealineados = f.grupos?.map((g) => ({ ...g, actividades: realinearActividadesCuadrilla(actividades, g.actividades) }))
          return {
            equipo: f.equipo,
            cantidad: f.cantidad,
            mantencion: f.mantencion,
            standby: f.standby,
            horas_por_actividad:
              gruposRealineados && gruposRealineados.length > 0
                ? horasMaquinariaCalculadas(actividades, gruposRealineados)
                : horasMaquinariaPorActividad(actividades, f.horas),
            grupos: gruposRealineados,
          }
        }),

        jornada: {
          inicio: jornada.inicio,
          fin: jornada.fin,
          horas_efectivas: { entrada: jornada.efectivaEntrada, salida: jornada.efectivaSalida },
          horas_perdidas: { entrada: jornada.perdidaEntrada, salida: jornada.perdidaSalida },
        },

        hh_directas_programado: hhDirectasProgramado,
        hh_indirectas_programado: hhIndirectasProgramado,

        comentario_contratista_autor: comentarioContratistaAutor || null,
        comentario_contratista: comentarioContratista || null,
      }

      let parte: any

      // parteCreadoId: si un intento anterior YA creó el reporte y falló
      // después (subiendo fotos), este reintento tiene que ACTUALIZAR ese
      // reporte, no insertar otro. Sin esto, el segundo intento chocaba
      // contra la restricción única de (contrato, número de reporte) y el
      // usuario quedaba atrapado: no podía guardar nunca más desde este
      // formulario, y perdía todo lo capturado.
      if (parteCreadoId && !editando) {
        parte = await db.actualizarParteDiario(parteCreadoId, {
          ...camposComunes,
          estado: estadoFinal,
        })
      } else if (editando && parteExistente) {
        // Tampoco se pisa el estado si el reporte ya fue enviado o
        // comentado por el mandante (ver estadoBloqueado).
        const updates: Record<string, unknown> = { ...camposComunes }
        if (!estadoBloqueado) {
          updates.estado = estadoFinal
        }
        // Bloqueo optimista contra el estado con el que se abrió este
        // formulario (hallazgo QA 2026-09-25): si cambió mientras estaba
        // abierto (otra persona lo guardó, o el mandante lo comentó), el
        // UPDATE no aplica y se avisa en vez de pisarlo en silencio.
        parte = await db.actualizarParteDiarioSiEstado(parteExistente.id, parteExistente.estado, updates)
      } else {
        // Recién ahora se reserva el número de verdad (incrementa el
        // contador atómico) — el `numeroReporte` mostrado hasta este punto
        // era solo una previsualización sin reservar nada (ver el useEffect
        // de arriba y el bug de saltos de correlativo 2026-09-26).
        const numeroReporteReal = await db.obtenerSiguienteNumeroParte(contrato.id)
        setNumeroReporte(numeroReporteReal)

        // hh_*_acumuladas acá es solo un valor inicial razonable (por si
        // recalcularAcumuladosFaena de abajo llegara a fallar después de
        // esta inserción) — el recálculo de la cadena completa es el que
        // deja el valor definitivo, así que no hace falta traer el último
        // reporte de la faena para sumarle el de este.
        parte = await db.crearParteDiario({
          contrato_id: contrato.id,
          numero_reporte: numeroReporteReal,
          ...camposComunes,

          hh_directas_acumuladas: totalHhDirectas,
          hm_acumuladas: totalHm,
          hh_indirectas_acumuladas: totalHhIndirectas,

          fotos: [],

          estado: estadoFinal,
          creado_por: usuario.id,
        })
        // El reporte ya existe en la base. A partir de acá, cualquier fallo
        // debe reintentarse como actualización, nunca como inserción nueva.
        setParteCreadoId(parte.id)
      }

      // Recalcula la cadena de acumulados de la faena DESDE CERO, a partir
      // del HH real de cada reporte guardado — no solo "el último + este".
      // Se llama después de las tres ramas de arriba (crear, reintento de
      // creación, y editar uno existente) para que un reporte editado
      // propague el cambio a todos los reportes posteriores de la cadena.
      // Antes esto no pasaba: la auditoría del 2026-09-07 encontró 5
      // reportes reales con acumulados desincronizados, hasta 141 HH de
      // diferencia con la suma real. Ver db.recalcularAcumuladosFaena.
      await db.recalcularAcumuladosFaena(contrato.id, faena)

      // Fotos: unifica las nuevas (traen "file", hay que subirlas a Storage)
      // con las ya existentes (traen "url", vienen de editar un Daily
      // Report que ya tenía fotos guardadas — se mantienen tal cual, salvo
      // que el usuario haya cambiado el orden, el pie de foto, o las haya
      // quitado). El resultado reemplaza por completo el arreglo "fotos" del
      // parte, así que una foto quitada en el formulario también se quita acá.
      //
      // Cada foto se sube dentro de su propio try/catch. Antes, una sola
      // foto fallida (señal intermitente en faena, que es lo normal) hacía
      // salir del bucle entero: el reporte quedaba guardado con fotos: [],
      // las anteriores quedaban huérfanas en Storage, y el mensaje de error
      // no decía que el reporte SÍ se había guardado.
      // El N° de Actividad de cada foto vive en el estado del formulario
      // (`fotos`) como índice en el array `actividades` SIN filtrar (el que
      // se ve en pantalla) — igual que horasDirectaPorActividad/cuadrillas,
      // acá se realinea a la posición final entre las actividades válidas
      // (o se deja sin actividad si la suya quedó en blanco y se filtró al
      // guardar) SOLO para el payload que se manda a la base de datos. El
      // estado `fotos` en sí NUNCA guarda el índice ya realineado: si se
      // hiciera, un reintento volvería a realinear un valor que ya no es un
      // índice sin filtrar y quedaría mal.
      const indicesValidos = indicesActividadesValidas(actividades)
      const actividadIndexFinal = (actividadIndex?: number): number | undefined => {
        if (actividadIndex === undefined) return undefined
        const posicion = indicesValidos.indexOf(actividadIndex)
        return posicion === -1 ? undefined : posicion
      }

      const fotosFinal: { url: string; caption: string; actividadIndex?: number }[] = []
      const fotosExitosas: FotoPendiente[] = []
      const fotosPendientes: FotoPendiente[] = []

      for (let i = 0; i < fotos.length; i++) {
        const foto = fotos[i]
        if (foto.file) {
          try {
            const path = `partes-diarios/${contrato.id}/${parte.id}/${Date.now()}-${i}-${foto.file.name}`
            await storage.uploadFoto('documentos', path, foto.file)
            const url = await storage.getSignedUrl('documentos', path)
            fotosFinal.push({ url, caption: foto.caption, actividadIndex: actividadIndexFinal(foto.actividadIndex) })
            fotosExitosas.push({ url, caption: foto.caption, preview: url, actividadIndex: foto.actividadIndex })
          } catch {
            // Se guarda para reintentarla; el resto del reporte igual se salva.
            fotosPendientes.push(foto)
          }
        } else if (foto.url) {
          fotosFinal.push({ url: foto.url, caption: foto.caption, actividadIndex: actividadIndexFinal(foto.actividadIndex) })
          fotosExitosas.push(foto)
        }
      }

      // Siempre se guarda lo que sí subió, aunque algunas hayan fallado.
      if (editando || parteCreadoId || fotosFinal.length > 0) {
        await db.actualizarParteDiario(parte.id, { fotos: fotosFinal })
      }

      if (fotosPendientes.length > 0) {
        // El formulario queda abierto con solo las fotos que faltan, para
        // que "Guardar" de nuevo reintente únicamente esas.
        setFotos([...fotosExitosas, ...fotosPendientes])
        setError(
          `El reporte se guardó, pero ${fotosPendientes.length} foto${fotosPendientes.length === 1 ? '' : 's'} no se pudo subir por problemas de conexión. ` +
            'Vuelve a tocar Guardar cuando tengas señal para reintentar solo esas.'
        )
        return
      }

      limpiarBorrador()

      // crearParteDiario/actualizarParteDiario no traen usuario_creador ni
      // el arreglo de fotos final (si se acaban de subir) — se vuelve a
      // pedir completo, igual que hace ParteDiarioDetalle, para que la
      // vista previa muestre nombre/firma del coordinador y las fotos.
      const parteCompleto = await db.obtenerParteDiario(parte.id)
      setParteGuardada(parteCompleto as ParteDiario)
    } catch (err) {
      // El bloqueo optimista (actualizarParteDiarioSiEstado) lanza un
      // Error normal con un mensaje ya pensado para mostrarse tal cual —
      // traducirError lo reemplazaría por el genérico al no matchear
      // ningún patrón conocido (mismo criterio que ya usa DocumentList.tsx
      // con "ya fue actualizado").
      const msg =
        err instanceof Error && err.message.includes('ya fue actualizado por otra persona')
          ? err.message
          : traducirError(err, 'No se pudo guardar el Daily Report')
      setError(msg)
    } finally {
      setIsSaving(null)
    }
  }

  const inputClase =
    'w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600'
  const inputNumClase = inputClase + ' text-right'

  // Pantalla de confirmación tras guardar: reemplaza al formulario (en vez
  // de volver directo a la lista con onGuardado()) para ofrecer "Ver Daily
  // Report" antes de salir. onGuardado() se llama recién cuando el usuario
  // elige "Volver a la lista" (o cierra la vista previa y decide volver).
  if (parteGuardada) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-8 text-center space-y-4">
        <div className="text-emerald-600 text-4xl">✓</div>
        <h2 className="text-lg font-bold text-slate-900">
          Daily Report N° {String(parteGuardada.numero_reporte).padStart(3, '0')} guardado
        </h2>
        <p className="text-sm text-slate-500">
          {FAENA_LABELS[parteGuardada.faena]} · {parteGuardada.fecha}
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => setMostrarVistaPrevia(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
          >
            Ver Daily Report
          </button>
          <button
            type="button"
            onClick={onGuardado}
            className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors"
          >
            Volver a la lista
          </button>
        </div>
        {mostrarVistaPrevia && (
          <DailyReportExcelPreview
            parte={parteGuardada}
            contrato={contrato}
            onCerrar={() => setMostrarVistaPrevia(false)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-8">
      {/* Dos ventanas obligatorias al crear (no editando), en secuencia:
          primero fecha, después faena — ninguna se puede cerrar sin elegir
          (sin botón de cerrar, sin Dialog.Close, ignorando Esc/click
          afuera). El resto del formulario igual se renderiza detrás (el
          overlay bloquea la interacción), así que el N° de reporte ya está
          listo apenas se cierran ambas ventanas. */}
      {!editando && !fechaElegida && (
        <Dialog.Root open onOpenChange={() => {}}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
            <Dialog.Content
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-white rounded-lg shadow-xl z-50 p-6"
              onEscapeKeyDown={(e) => e.preventDefault()}
              onInteractOutside={(e) => e.preventDefault()}
            >
              <Dialog.Title className="text-lg font-bold text-slate-900 mb-1">
                ¿Qué fecha tiene este Daily Report?
              </Dialog.Title>
              <Dialog.Description className="text-sm text-slate-500 mb-4">
                Confirma o cambia la fecha para continuar.
              </Dialog.Description>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className={`${inputClase} mb-4`}
              />
              <button
                type="button"
                disabled={!fecha}
                onClick={() => setFechaElegida(true)}
                className="w-full px-4 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Continuar
              </button>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      {!editando && fechaElegida && !faenaElegida && (
        <Dialog.Root open onOpenChange={() => {}}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
            <Dialog.Content
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-white rounded-lg shadow-xl z-50 p-6"
              onEscapeKeyDown={(e) => e.preventDefault()}
              onInteractOutside={(e) => e.preventDefault()}
            >
              <Dialog.Title className="text-lg font-bold text-slate-900 mb-1">
                ¿Qué faena es este Daily Report?
              </Dialog.Title>
              <Dialog.Description className="text-sm text-slate-500 mb-4">
                Elige una faena para continuar. No se podrá cambiar después de este paso.
              </Dialog.Description>
              <div className="space-y-2">
                {Object.values(Faena).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      setFaena(f)
                      setFaenaElegida(true)
                    }}
                    className="w-full text-left px-4 py-3 border border-slate-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors font-semibold text-slate-800"
                  >
                    {FAENA_LABELS[f]}
                  </button>
                ))}
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            {editando ? 'Editar Daily Report' : 'Nuevo Daily Report'}
          </h2>
          <p className="text-sm text-slate-500">
            {contrato?.codigo} · {contrato?.nombre}
          </p>
        </div>
        <div className="text-right">
          <span className="block text-sm font-mono text-slate-500">
            {isLoading ? 'Report N° …' : `Report N° ${String(numeroReporte).padStart(3, '0')}`}
          </span>
          {guardadoEn && (
            <span className="block text-xs text-slate-400 mt-0.5">Borrador guardado en este equipo ✓</span>
          )}
        </div>
      </div>

      {/* Recuperación de un borrador anterior: aparece si el navegador se
          cerró (o descartó la pestaña) con trabajo sin guardar. */}
      {borradorDisponible && !editando && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-amber-900">
            Tienes un Daily Report a medio llenar de {haceCuanto(borradorDisponible.guardadoEn)}
          </p>
          <p className="text-xs text-amber-800/80 mt-1">
            Puedes seguir donde lo dejaste. Las fotos no se guardan en el borrador, hay que volver a cargarlas.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              type="button"
              onClick={recuperarBorrador}
              className="px-4 py-2.5 bg-amber-600 text-white text-sm font-semibold rounded-lg hover:bg-amber-700"
            >
              Recuperar lo que llevaba
            </button>
            <button
              type="button"
              onClick={descartarBorrador}
              className="px-4 py-2.5 text-sm font-semibold text-amber-800 border border-amber-300 rounded-lg hover:bg-amber-100"
            >
              Empezar de cero
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Encabezado */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Encabezado</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Faena</label>
            <select
              value={faena}
              onChange={(e) => setFaena(e.target.value as Faena)}
              disabled={faenaElegida}
              className={`${inputClase} disabled:bg-slate-100 disabled:text-slate-500`}
            >
              {Object.values(Faena).map((f) => (
                <option key={f} value={f}>
                  {FAENA_LABELS[f]}
                </option>
              ))}
            </select>
            {faenaElegida && (
              <p className="text-xs text-slate-400 mt-1">La faena queda fija para este reporte.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Fecha</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClase} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Condición climática</label>
            <input
              type="text"
              placeholder="Despejado, nublado, lluvia…"
              value={condicionClimatica}
              onChange={(e) => setCondicionClimatica(e.target.value)}
              className={inputClase}
            />
          </div>
        </div>
      </section>

      {/* Actividades ejecutadas */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
            Actividades ejecutadas
          </h3>
          <button
            type="button"
            onClick={agregarActividad}
            disabled={actividades.length >= MAX_ACTIVIDADES}
            className="text-sm font-semibold text-blue-600 hover:text-blue-700 disabled:text-slate-300"
          >
            + Agregar actividad
          </button>
        </div>
        <div className="space-y-2">
          {actividades.map((actividad, index) => (
            <div key={index} className="grid grid-cols-1 sm:grid-cols-[24px_1fr_2fr_100px_32px] gap-2 items-center">
              <span className="text-xs font-mono text-slate-400 text-center">{index + 1}</span>
              <input
                type="text"
                placeholder="Área"
                value={actividad.area}
                onChange={(e) => actualizarActividad(index, 'area', e.target.value)}
                className={inputClase}
              />
              <input
                type="text"
                placeholder="Descripción"
                value={actividad.descripcion}
                onChange={(e) => actualizarActividad(index, 'descripcion', e.target.value)}
                className={inputClase}
              />
              <input
                type="number"
                step="0.1"
                placeholder="HH x actividad"
                title="Horas que dura esta actividad en particular (ej: 0,5) — se usa para calcular las HH de Fuerza laboral directa."
                value={actividad.cantidad ?? ''}
                onChange={(e) => actualizarActividad(index, 'cantidad', e.target.value)}
                className={inputNumClase}
              />
              <button
                type="button"
                onClick={() => quitarActividad(index)}
                disabled={actividades.length === 1}
                className="text-slate-400 hover:text-red-600 disabled:opacity-30"
                aria-label="Quitar actividad"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* Suma de HH x actividad — solo visualización + control interno
            para el bloqueo de envío (ver HH_TURNO_POR_FAENA, el mínimo
            depende de la faena elegida arriba). No es una celda del Excel. */}
        <div className="grid grid-cols-1 sm:grid-cols-[24px_1fr_2fr_100px_32px] gap-2 items-center mt-2 pt-2 border-t border-slate-200">
          <span />
          <span className="sm:col-span-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Total HH x actividad
          </span>
          <span
            className={`text-sm font-semibold text-right ${
              totalHhActividadesRedondeado < minHhActividades ? 'text-red-600' : 'text-emerald-600'
            }`}
          >
            {totalHhActividadesRedondeado}
          </span>
          <span />
        </div>
        {totalHhActividadesRedondeado < minHhActividades && (
          <p className="text-xs text-red-500 text-right mt-1">
            Mínimo {minHhActividades} HH ({FAENA_LABELS[faena]}) para poder enviar el reporte.
          </p>
        )}
      </section>

      {/* Fuerza laboral directa */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-1">
          Fuerza laboral directa
        </h3>
        <p className="text-xs text-slate-400 mb-3">
          Las columnas Act.1..Act.{numActividades} se calculan solas: HH x actividad (campo "Cantidad" de
          Actividades Ejecutadas) × Operativos de cada cargo (o, si el cargo tiene cuadrillas, solo los
          operativos de las cuadrillas que participan en cada actividad).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-xs text-slate-500 uppercase">
                <th className="text-left py-1 pr-2">Cargo</th>
                <th className="text-right py-1 px-1 w-24">Contratados</th>
                <th className="text-right py-1 px-1 w-24">Operativos</th>
                <th className="text-right py-1 px-1 w-24">Permiso/Desc.</th>
                {Array.from({ length: numActividades }).map((_, i) => (
                  <th key={i} className="text-right py-1 px-1 w-16">
                    Act.{i + 1}
                  </th>
                ))}
                <th className="text-right py-1 pl-1 w-20">HH Total</th>
              </tr>
            </thead>
            <tbody>
              {manoObraDirecta.map((fila, index) => {
                const tieneCuadrillas = Boolean(fila.cuadrillas && fila.cuadrillas.length > 0)
                const expandido = cargosExpandidos.has(fila.cargo)
                const totalColumnas = 5 + numActividades
                return (
                  <Fragment key={fila.cargo}>
                    <tr className="border-t border-slate-100">
                      <td className="py-1 pr-2 text-slate-700">
                        <div className="flex items-center gap-1.5">
                          {tieneCuadrillas && (
                            <button
                              type="button"
                              onClick={() => alternarCargoExpandido(fila.cargo)}
                              className="text-slate-400 hover:text-slate-700 flex-shrink-0"
                              title={expandido ? 'Ocultar cuadrillas' : 'Ver cuadrillas'}
                            >
                              {expandido ? '▾' : '▸'}
                            </button>
                          )}
                          <span>{fila.cargo}</span>
                          {!tieneCuadrillas && (
                            <button
                              type="button"
                              onClick={() => agregarCuadrilla(index)}
                              title="Repartir los operativos de este cargo entre cuadrillas (supervisor + su grupo), cada una con las actividades en que participó"
                              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-500 flex-shrink-0"
                            >
                              + Cuadrilla
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-1 px-1">
                        <input
                          type="number"
                          value={fila.contratados || ''}
                          onChange={(e) => actualizarDirecta(index, 'contratados', e.target.value)}
                          className={inputNumClase}
                        />
                      </td>
                      <td className="py-1 px-1">
                        {tieneCuadrillas ? (
                          <span
                            title="Suma de los operativos de las cuadrillas de este cargo — ya no se tipea a mano."
                            className="block text-right font-mono text-xs text-slate-500 px-2 py-1"
                          >
                            {operativosEfectivos(fila)}
                          </span>
                        ) : (
                          <input
                            type="number"
                            value={fila.operativos || ''}
                            onChange={(e) => actualizarDirecta(index, 'operativos', e.target.value)}
                            className={inputNumClase}
                          />
                        )}
                      </td>
                      <td className="py-1 px-1 text-right text-slate-400 font-mono text-xs">
                        {permisoDescanso({ ...fila, operativos: operativosEfectivos(fila) })}
                      </td>
                      {calcularHorasCargo(fila).map((horas, actIndex) => (
                        <td key={actIndex} className="py-1 px-1 text-right font-mono text-xs text-slate-500">
                          {horas || ''}
                        </td>
                      ))}
                      <td className="py-1 pl-1 text-right font-mono text-xs text-slate-500">
                        {sumar(calcularHorasCargo(fila))}
                      </td>
                    </tr>

                    {tieneCuadrillas && expandido && (
                      <tr key={`${fila.cargo}-cuadrillas`} className="bg-slate-50">
                        <td colSpan={totalColumnas} className="px-2 py-2">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-slate-400 uppercase text-[10px]">
                                <th className="text-left font-semibold pb-1 pr-2">Supervisor</th>
                                <th className="text-right font-semibold pb-1 px-2 w-20">Operativos</th>
                                {Array.from({ length: numActividades }).map((_, i) => (
                                  <th key={i} className="text-center font-semibold pb-1 px-1 w-10">
                                    Act.{i + 1}
                                  </th>
                                ))}
                                <th className="w-8" />
                              </tr>
                            </thead>
                            <tbody>
                              {fila.cuadrillas!.map((c) => (
                                <tr key={c.id} className="border-t border-slate-200">
                                  <td className="py-1 pr-2">
                                    <input
                                      type="text"
                                      value={c.supervisor}
                                      onChange={(e) => actualizarCuadrilla(index, c.id, 'supervisor', e.target.value)}
                                      placeholder="Nombre del supervisor"
                                      className="w-full px-2 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600"
                                    />
                                  </td>
                                  <td className="py-1 px-2">
                                    <input
                                      type="number"
                                      value={c.operativos || ''}
                                      onChange={(e) => actualizarCuadrilla(index, c.id, 'operativos', e.target.value)}
                                      className="w-full px-2 py-1 border border-slate-300 rounded text-xs text-right focus:outline-none focus:border-blue-600"
                                    />
                                  </td>
                                  {Array.from({ length: numActividades }).map((_, actIndex) => (
                                    <td key={actIndex} className="text-center px-1">
                                      <input
                                        type="checkbox"
                                        checked={c.actividades[actIndex] ?? false}
                                        onChange={() => alternarActividadCuadrilla(index, c.id, actIndex)}
                                        className="w-3.5 h-3.5"
                                      />
                                    </td>
                                  ))}
                                  <td className="text-center">
                                    <button
                                      type="button"
                                      onClick={() => eliminarCuadrilla(index, c.id)}
                                      title="Quitar cuadrilla"
                                      className="text-red-600 hover:text-red-700"
                                    >
                                      🗑
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <button
                            type="button"
                            onClick={() => agregarCuadrilla(index)}
                            className="mt-2 text-[11px] px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 text-slate-700"
                          >
                            + Agregar cuadrilla
                          </button>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              <tr className="border-t-2 border-slate-300 font-semibold text-slate-700">
                <td className="py-1 pr-2">Total</td>
                <td className="py-1 px-1 text-right">{sumar(manoObraDirecta.map((f) => f.contratados))}</td>
                <td className="py-1 px-1 text-right">{sumar(manoObraDirecta.map(operativosEfectivos))}</td>
                <td />
                <td colSpan={numActividades} />
                <td className="py-1 pl-1 text-right">{totalHhDirectas}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Jornada */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Jornada</h3>
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Inicio jornada</label>
            <input type="time" value={jornada.inicio} onChange={(e) => setJornada({ ...jornada, inicio: e.target.value })} className={inputClase} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Fin jornada</label>
            <input type="time" value={jornada.fin} onChange={(e) => setJornada({ ...jornada, fin: e.target.value })} className={inputClase} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">H. efectivas — entrada</label>
            <input type="time" value={jornada.efectivaEntrada} onChange={(e) => setJornada({ ...jornada, efectivaEntrada: e.target.value })} className={inputClase} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">H. efectivas — salida</label>
            <input type="time" value={jornada.efectivaSalida} onChange={(e) => setJornada({ ...jornada, efectivaSalida: e.target.value })} className={inputClase} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">H. perdidas — entrada</label>
            <input type="time" value={jornada.perdidaEntrada} onChange={(e) => setJornada({ ...jornada, perdidaEntrada: e.target.value })} className={inputClase} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">H. perdidas — salida</label>
            <input type="time" value={jornada.perdidaSalida} onChange={(e) => setJornada({ ...jornada, perdidaSalida: e.target.value })} className={inputClase} />
          </div>
        </div>
      </section>

      {/* Maquinaria */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Maquinaria</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-xs text-slate-500 uppercase">
                <th className="text-left py-1 pr-2">Equipo</th>
                <th className="text-right py-1 px-1 w-20">N° Equipos</th>
                <th className="text-right py-1 px-1 w-24">Mantención</th>
                <th className="text-right py-1 px-1 w-20">Stand-by</th>
                <th className="text-right py-1 px-1 w-20">Operativos</th>
                {Array.from({ length: numActividades }).map((_, i) => (
                  <th key={i} className="text-right py-1 px-1 w-16">
                    Act.{i + 1}
                  </th>
                ))}
                <th className="text-right py-1 pl-1 w-20">HM Total</th>
              </tr>
            </thead>
            <tbody>
              {maquinaria.map((fila, index) => {
                const tieneGrupos = Boolean(fila.grupos && fila.grupos.length > 0)
                const expandido = equiposExpandidos.has(fila.equipo)
                const totalColumnas = 6 + numActividades
                return (
                  <Fragment key={fila.equipo}>
                    <tr className="border-t border-slate-100">
                      <td className="py-1 pr-2 text-slate-700">
                        <div className="flex items-center gap-1.5">
                          {tieneGrupos && (
                            <button
                              type="button"
                              onClick={() => alternarEquipoExpandido(fila.equipo)}
                              className="text-slate-400 hover:text-slate-700 flex-shrink-0"
                              title={expandido ? 'Ocultar grupos' : 'Ver grupos'}
                            >
                              {expandido ? '▾' : '▸'}
                            </button>
                          )}
                          <span>{fila.equipo}</span>
                          {!tieneGrupos && (
                            <button
                              type="button"
                              onClick={() => agregarGrupoMaquinaria(index)}
                              title="Repartir los equipos de esta fila entre grupos, cada uno con las actividades en que participó"
                              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-500 flex-shrink-0"
                            >
                              + Grupo
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-1 px-1">
                        <input type="number" value={fila.cantidad || ''} onChange={(e) => actualizarMaquinaria(index, 'cantidad', e.target.value)} className={inputNumClase} />
                      </td>
                      <td className="py-1 px-1">
                        <input type="number" value={fila.mantencion || ''} onChange={(e) => actualizarMaquinaria(index, 'mantencion', e.target.value)} className={inputNumClase} />
                      </td>
                      <td className="py-1 px-1">
                        <input type="number" value={fila.standby || ''} onChange={(e) => actualizarMaquinaria(index, 'standby', e.target.value)} className={inputNumClase} />
                      </td>
                      <td className="py-1 px-1 text-right text-slate-400 font-mono text-xs">
                        {fila.cantidad - fila.mantencion - fila.standby}
                      </td>
                      {calcularHorasMaquinaria(fila).map((horas, actIndex) =>
                        tieneGrupos ? (
                          <td key={actIndex} className="py-1 px-1 text-right font-mono text-xs text-slate-500">
                            {horas || ''}
                          </td>
                        ) : (
                          <td key={actIndex} className="py-1 px-1">
                            <input type="number" value={fila.horas[actIndex] || ''} onChange={(e) => actualizarHorasMaquinaria(index, actIndex, e.target.value)} className={inputNumClase} />
                          </td>
                        )
                      )}
                      <td className="py-1 pl-1 text-right font-mono text-xs text-slate-500">
                        {sumar(calcularHorasMaquinaria(fila))}
                      </td>
                    </tr>

                    {tieneGrupos && expandido && (
                      <tr key={`${fila.equipo}-grupos`} className="bg-slate-50">
                        <td colSpan={totalColumnas} className="px-2 py-2">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-slate-400 uppercase text-[10px]">
                                <th className="text-right font-semibold pb-1 px-2 w-20">Cantidad</th>
                                {Array.from({ length: numActividades }).map((_, i) => (
                                  <th key={i} className="text-center font-semibold pb-1 px-1 w-10">
                                    Act.{i + 1}
                                  </th>
                                ))}
                                <th className="w-8" />
                              </tr>
                            </thead>
                            <tbody>
                              {fila.grupos!.map((g) => (
                                <tr key={g.id} className="border-t border-slate-200">
                                  <td className="py-1 px-2">
                                    <input
                                      type="number"
                                      value={g.cantidad || ''}
                                      onChange={(e) => actualizarGrupoMaquinaria(index, g.id, e.target.value)}
                                      className="w-full px-2 py-1 border border-slate-300 rounded text-xs text-right focus:outline-none focus:border-blue-600"
                                    />
                                  </td>
                                  {Array.from({ length: numActividades }).map((_, actIndex) => (
                                    <td key={actIndex} className="text-center px-1">
                                      <input
                                        type="checkbox"
                                        checked={g.actividades[actIndex] ?? false}
                                        onChange={() => alternarActividadGrupoMaquinaria(index, g.id, actIndex)}
                                        className="w-3.5 h-3.5"
                                      />
                                    </td>
                                  ))}
                                  <td className="text-center">
                                    <button
                                      type="button"
                                      onClick={() => eliminarGrupoMaquinaria(index, g.id)}
                                      title="Quitar grupo"
                                      className="text-red-600 hover:text-red-700"
                                    >
                                      🗑
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <button
                            type="button"
                            onClick={() => agregarGrupoMaquinaria(index)}
                            className="mt-2 text-[11px] px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 text-slate-700"
                          >
                            + Agregar grupo
                          </button>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              <tr className="border-t-2 border-slate-300 font-semibold text-slate-700">
                <td className="py-1 pr-2">Total</td>
                <td className="py-1 px-1 text-right">{sumar(maquinaria.map((f) => f.cantidad))}</td>
                <td colSpan={3} />
                <td colSpan={numActividades} />
                <td className="py-1 pl-1 text-right">{totalHm}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Fuerza laboral indirecta */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
          Fuerza laboral indirecta
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-xs text-slate-500 uppercase">
                <th className="text-left py-1 pr-2">Cargo</th>
                <th className="text-right py-1 px-1 w-24">Contratados</th>
                <th className="text-right py-1 px-1 w-24">Operativos</th>
                <th className="text-right py-1 px-1 w-24">Permiso/Desc.</th>
                <th className="text-right py-1 pl-1 w-24">HH Total (×{HH_TURNO_POR_FAENA[faena]})</th>
              </tr>
            </thead>
            <tbody>
              {manoObraIndirecta.map((fila, index) => (
                <tr key={fila.cargo} className="border-t border-slate-100">
                  <td className="py-1 pr-2 text-slate-700">{fila.cargo}</td>
                  <td className="py-1 px-1">
                    <input type="number" value={fila.contratados || ''} onChange={(e) => actualizarIndirecta(index, 'contratados', e.target.value)} className={inputNumClase} />
                  </td>
                  <td className="py-1 px-1">
                    <input type="number" value={fila.operativos || ''} onChange={(e) => actualizarIndirecta(index, 'operativos', e.target.value)} className={inputNumClase} />
                  </td>
                  <td className="py-1 px-1 text-right text-slate-400 font-mono text-xs">
                    {permisoDescanso(fila)}
                  </td>
                  {/* Usa HH_TURNO_POR_FAENA, no un literal: son 10 h en Las
                      Tórtolas y 12 en Los Bronces. Esta celda había quedado
                      en 11 (un valor que no corresponde a ninguna faena) y
                      por eso las filas no sumaban el Total de más abajo. */}
                  <td className="py-1 pl-1 text-right font-mono text-xs text-slate-500">
                    {hhDeFila(faena, fila)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 font-semibold text-slate-700">
                <td className="py-1 pr-2">Total</td>
                <td className="py-1 px-1 text-right">{sumar(manoObraIndirecta.map((f) => f.contratados))}</td>
                <td className="py-1 px-1 text-right">{sumar(manoObraIndirecta.map((f) => f.operativos))}</td>
                <td />
                <td className="py-1 pl-1 text-right">{totalHhIndirectas}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Resumen HH Programado vs Real */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
          Resumen HH Programado vs. Real
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">HH Directas — Programado</label>
            <input type="number" value={hhDirectasProgramado || ''} onChange={(e) => setHhDirectasProgramado(Number(e.target.value) || 0)} className={inputNumClase} />
            <p className="text-xs text-slate-400 mt-1">Real: {totalHhDirectas} (calculado)</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">HH Indirectas — Programado</label>
            <input type="number" value={hhIndirectasProgramado || ''} onChange={(e) => setHhIndirectasProgramado(Number(e.target.value) || 0)} className={inputNumClase} />
            <p className="text-xs text-slate-400 mt-1">Real: {totalHhIndirectas} (calculado)</p>
          </div>
        </div>
      </section>

      {/* Fotos — agrupadas por N° de Actividad: se abre la actividad, se
          cargan sus fotos, se les pone nombre, y se pasa a la siguiente
          (pedido explícito 2026-09-24). Cada sección es independiente de
          las demás, en cualquier orden — no hay flujo forzado. */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-1">Fotos del día</h3>
        <p className="text-xs text-slate-400 mb-3">Abre la actividad correspondiente para cargar y nombrar sus fotos.</p>
        <div className="space-y-2">
          {actividades.map((act, idx) => {
            const fotosActividad = fotos.filter((f) => f.actividadIndex === idx)
            const expandida = fotosExpandidas.has(idx)
            return (
              <div key={idx} className="border border-slate-200 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => alternarFotosExpandida(idx)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-slate-700 bg-slate-50 hover:bg-slate-100"
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="text-slate-400 flex-shrink-0">{expandida ? '▾' : '▸'}</span>
                    <span className="font-medium flex-shrink-0">Act.{idx + 1}</span>
                    {(act.descripcion || act.area) && <span className="text-slate-400 truncate">— {act.descripcion || act.area}</span>}
                  </span>
                  <span className="text-xs text-slate-400 flex-shrink-0">
                    {fotosActividad.length} foto{fotosActividad.length === 1 ? '' : 's'}
                  </span>
                </button>
                {expandida && (
                  <div className="p-3">
                    <GestorFotos
                      fotos={fotosActividad}
                      onChange={(nuevas) => {
                        // Solo las que vengan sin actividadIndex son fotos recién
                        // agregadas acá adentro — se etiquetan con esta actividad;
                        // las ya etiquetadas (reordenadas, renombradas o intactas)
                        // se respetan tal cual.
                        const etiquetadas = nuevas.map((f) => (f.actividadIndex === undefined ? { ...f, actividadIndex: idx } : f))
                        setFotos((prev) => [...prev.filter((f) => f.actividadIndex !== idx), ...etiquetadas])
                      }}
                    />
                  </div>
                )}
              </div>
            )
          })}

          {fotos.some((f) => f.actividadIndex === undefined) && (
            <div className="border border-amber-200 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => alternarFotosExpandida(-1)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-amber-800 bg-amber-50 hover:bg-amber-100"
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-amber-500">{fotosExpandidas.has(-1) ? '▾' : '▸'}</span>
                  <span className="font-medium">Sin actividad asignada</span>
                </span>
                <span className="text-xs text-amber-600 flex-shrink-0">
                  {fotos.filter((f) => f.actividadIndex === undefined).length} foto
                  {fotos.filter((f) => f.actividadIndex === undefined).length === 1 ? '' : 's'}
                </span>
              </button>
              {fotosExpandidas.has(-1) && (
                <div className="p-3">
                  <GestorFotos
                    fotos={fotos.filter((f) => f.actividadIndex === undefined)}
                    onChange={(nuevas) => setFotos((prev) => [...prev.filter((f) => f.actividadIndex !== undefined), ...nuevas])}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Comentario del contratista */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
          Comentarios del contratista al Daily Report
        </h3>
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Autor del comentario"
            value={comentarioContratistaAutor}
            onChange={(e) => setComentarioContratistaAutor(e.target.value)}
            className={`${inputClase} max-w-xs`}
          />
          <textarea
            placeholder="Comentario…"
            value={comentarioContratista}
            onChange={(e) => setComentarioContratista(e.target.value)}
            rows={3}
            className={inputClase}
          />
        </div>
        <p className="text-xs text-slate-400 mt-2">
          El comentario del cliente/mandante se agrega después de enviar el reporte, desde su propia sesión.
        </p>
      </section>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
        <button type="button" onClick={onCancelar} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
          Cancelar
        </button>
        {estadoBloqueado ? (
          // El reporte ya fue enviado (o comentado por el mandante): solo
          // se pueden corregir sus datos, no volver a elegir borrador/envío.
          <button
            type="button"
            onClick={() => guardar(ParteDiarioEstado.ENVIADO)}
            disabled={isSaving !== null}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving !== null ? 'Guardando…' : 'Guardar cambios'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => guardar(ParteDiarioEstado.BORRADOR)}
              disabled={isSaving !== null || isLoading || !contrato?.id}
              className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving === 'borrador' ? 'Guardando…' : 'Guardar borrador'}
            </button>
            <button
              type="button"
              onClick={() => guardar(ParteDiarioEstado.ENVIADO)}
              disabled={isSaving !== null || isLoading || !contrato?.id}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving === 'enviado' ? 'Enviando…' : editando ? 'Guardar y enviar' : 'Enviar reporte'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
