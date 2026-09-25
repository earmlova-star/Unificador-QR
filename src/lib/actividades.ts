import { ActividadEjecutada } from '@/types/index'

// Alineación de "Actividades ejecutadas" con las columnas Act.1..Act.N de
// Fuerza Laboral Directa y Maquinaria.
//
// Esto vivía dentro de ParteDiarioForm.tsx y ahí no se podía probar. Es la
// lógica que arregló el hallazgo #5 del QA 2026-09-15: las horas de cada
// cargo/equipo se guardan como un array posicional (posición i = actividad
// i), así que cualquier actividad que se saque del listado — sea porque el
// usuario la borró, sea porque quedó en blanco y se filtra al guardar —
// tiene que sacarse de ESE MISMO índice en todos los arrays de horas. Si
// solo se trunca el final (como se hacía antes), las horas de las
// actividades posteriores quedan atribuidas a la actividad equivocada y la
// última se pierde, sin ningún error visible: el reporte se guarda igual y
// el Excel sale con los números corridos de columna.

/** Una fila de actividad cuenta como "real" si tiene área o descripción. */
const tieneContenido = (a: ActividadEjecutada) => Boolean(a.area.trim() || a.descripcion.trim())

/**
 * Posiciones (en el array original) de las actividades con contenido real.
 * Es la máscara que hay que aplicar a cualquier array de horas para que siga
 * calzando con las actividades que de verdad se guardan.
 */
export function indicesActividadesValidas(actividades: ActividadEjecutada[]): number[] {
  return actividades.map((a, i) => (tieneContenido(a) ? i : -1)).filter((i) => i !== -1)
}

/** Las actividades con contenido real, en su orden original. */
export function actividadesValidas(actividades: ActividadEjecutada[]): ActividadEjecutada[] {
  return actividades.filter(tieneContenido)
}

/** Cuadrilla de Fuerza Laboral Directa — ver CuadrillaManoObra en types/index.ts. */
interface CuadrillaParaCalculo {
  operativos: number
  actividades: boolean[]
}

/**
 * Horas por actividad de un cargo de Fuerza Laboral Directa: las HH que dura
 * cada actividad ("Cantidad") × los operativos de ese cargo. No se tipea a
 * mano, siempre se deriva — por eso acá no hace falta realinear nada, se
 * calcula directo sobre las actividades ya filtradas.
 *
 * Si el cargo tiene cuadrillas (supervisor + su grupo, pedido explícito
 * 2026-09-24), `operativos` se ignora para esta cuenta: cada actividad suma
 * solo los operativos de las cuadrillas que marcaron participar en ella,
 * en vez de repartir el total del cargo por igual en todas las actividades.
 * `cuadrilla.actividades` usa el mismo índice posicional que el resultado
 * (índice i = actividad válida i-ésima), igual que `horas_por_actividad`.
 */
export function horasDirectaPorActividad(
  actividades: ActividadEjecutada[],
  operativos: number,
  cuadrillas?: CuadrillaParaCalculo[]
): number[] {
  const validas = actividadesValidas(actividades)
  if (cuadrillas && cuadrillas.length > 0) {
    return validas.map((act, i) => {
      const operativosEnActividad = cuadrillas.reduce((suma, c) => suma + (c.actividades[i] ? c.operativos : 0), 0)
      return (act.cantidad ?? 0) * operativosEnActividad
    })
  }
  return validas.map((act) => (act.cantidad ?? 0) * operativos)
}

/**
 * Horas por actividad de una fila de Maquinaria. A diferencia de Directa,
 * estas SÍ se tipean a mano por celda, así que son estado propio que hay que
 * realinear con la misma máscara de índices — no basta con truncar. Solo se
 * usa cuando el equipo NO tiene grupos (ver horasMaquinariaCalculadas).
 */
export function horasMaquinariaPorActividad(actividades: ActividadEjecutada[], horas: number[]): number[] {
  return indicesActividadesValidas(actividades).map((i) => horas[i] ?? 0)
}

/** Grupo de Maquinaria — ver GrupoMaquinaria en types/index.ts. */
interface GrupoParaCalculo {
  cantidad: number
  actividades: boolean[]
}

/**
 * Horas por actividad de un equipo de Maquinaria calculadas desde sus
 * grupos — mismo mecanismo que horasDirectaPorActividad con cuadrillas
 * (pedido explícito 2026-09-25), pero sin "supervisor": cada actividad
 * suma la cantidad de equipos de los grupos que marcaron participar en
 * ella. Reemplaza a horasMaquinariaPorActividad (tipeado a mano) para un
 * equipo que sí tiene grupos.
 */
export function horasMaquinariaCalculadas(actividades: ActividadEjecutada[], grupos: GrupoParaCalculo[]): number[] {
  const validas = actividadesValidas(actividades)
  return validas.map((act, i) => {
    const cantidadEnActividad = grupos.reduce((suma, g) => suma + (g.actividades[i] ? g.cantidad : 0), 0)
    return (act.cantidad ?? 0) * cantidadEnActividad
  })
}

/**
 * Participación por actividad de una cuadrilla de Fuerza Laboral Directa,
 * realineada contra las actividades válidas al momento de guardar — mismo
 * motivo y misma máscara que horasMaquinariaPorActividad: los checkboxes se
 * marcan en vivo contra el listado sin filtrar (índice = posición en
 * pantalla), así que si queda una fila de actividad en blanco al medio hay
 * que sacar ESE MISMO índice acá también, o la participación queda
 * atribuida a la actividad equivocada.
 */
export function realinearActividadesCuadrilla(actividades: ActividadEjecutada[], participaciones: boolean[]): boolean[] {
  return indicesActividadesValidas(actividades).map((i) => participaciones[i] ?? false)
}

interface FilaDirectaConCuadrillas {
  cuadrillas?: { actividades: boolean[] }[]
}

interface FilaMaquinariaConGrupos {
  horas: number[]
  grupos?: { actividades: boolean[] }[]
}

/**
 * Quita la actividad en `index` y saca esa misma posición de cada array de
 * horas de maquinaria, de cada `actividades` de grupo de maquinaria (ver
 * GrupoMaquinaria en types/index.ts, pedido explícito 2026-09-25) y, si se
 * pasa, de cada `actividades` de cuadrilla de mano de obra directa (mismo
 * motivo, ver CuadrillaManoObra), para que no se corran. `manoObraDirecta`
 * es opcional y por eso queda al final: los llamados existentes (y sus
 * pruebas) que no lo pasan siguen funcionando igual, sin tocar ninguna
 * cuadrilla.
 */
export function quitarActividad<
  TMaq extends FilaMaquinariaConGrupos = FilaMaquinariaConGrupos,
  TDir extends FilaDirectaConCuadrillas = FilaDirectaConCuadrillas
>(
  actividades: ActividadEjecutada[],
  maquinaria: TMaq[],
  index: number,
  manoObraDirecta?: TDir[]
): { actividades: ActividadEjecutada[]; maquinaria: TMaq[]; manoObraDirecta?: TDir[] } {
  return {
    actividades: actividades.filter((_, i) => i !== index),
    maquinaria: maquinaria.map((f) => ({
      ...f,
      horas: f.horas.filter((_, i) => i !== index),
      grupos: f.grupos?.map((g) => ({ ...g, actividades: g.actividades.filter((_, i) => i !== index) })),
    })),
    manoObraDirecta: manoObraDirecta?.map((f) => ({
      ...f,
      cuadrillas: f.cuadrillas?.map((c) => ({ ...c, actividades: c.actividades.filter((_, i) => i !== index) })),
    })),
  }
}
