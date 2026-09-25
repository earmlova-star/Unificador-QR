import { Fragment, useEffect, useMemo, useState } from 'react'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { CuadrillaTurno, EventoTransito, Usuario } from '@/types/index'
import { generarLineaTiempoCuadrilla } from './lib/motorTurnos'
import { PRESETS_TURNO, PatronTurno } from './lib/presetsTurno'
import { CALENDARIO_INICIO, TAMANO_VENTANA, enInicioDeRango, enFinDeRango, limitarInicioVentana, sumarDias } from './lib/rangoFechas'
import { esFeriado, nombreFeriado } from './lib/feriados'
import { ModalAgregarTurno } from './ModalAgregarTurno'
import { ModalEditarTurno } from './ModalEditarTurno'
import { ModalAgregarFuncionario } from './ModalAgregarFuncionario'
import { ModalAgregarEventoTransito } from './ModalAgregarEventoTransito'
import { ModalAgregarFuncionarioEvento } from './ModalAgregarFuncionarioEvento'
import { ReservasPasajes } from './ReservasPasajes'

interface OrganizadorTurnosProps {
  usuario: Usuario
}

type Vista = 'gantt' | 'reservas'

// Módulo "Organizador de Turnos": carta Gantt de cuadrillas mineras,
// compartida vía Supabase (ver add_organizador_turnos.sql) entre
// coordinador y consultor (ver fix_organizador_turnos_rol_consultor.sql).
// Independiente de faena/contrato — pedido explícito. Incluye la pestaña
// "Reservas de Pasajes" (ver add_reservas_pasaje.sql), que organiza la
// reserva de buses según las subidas/bajadas ya calculadas acá.
export const OrganizadorTurnos = ({ usuario }: OrganizadorTurnosProps) => {
  const [vista, setVista] = useState<Vista>('gantt')
  const [cuadrillas, setCuadrillas] = useState<CuadrillaTurno[]>([])
  const [eventosTransito, setEventosTransito] = useState<EventoTransito[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [inicioVentana, setInicioVentana] = useState(CALENDARIO_INICIO)
  const [bloqueoGlobal, setBloqueoGlobal] = useState(false)

  const [modalPatron, setModalPatron] = useState<PatronTurno | null | undefined>(undefined)
  const [cuadrillaFuncionarioId, setCuadrillaFuncionarioId] = useState<string | null | undefined>(undefined)
  const [cuadrillaEditando, setCuadrillaEditando] = useState<CuadrillaTurno | null>(null)
  // Subida/Bajada sueltas (ver EventoTransito) — 'subida' | 'bajada' abre el
  // modal de creación con ese tipo fijo; el id abre "agregar funcionario"
  // para un evento ya creado.
  const [modalEvento, setModalEvento] = useState<'subida' | 'bajada' | undefined>(undefined)
  const [eventoFuncionarioId, setEventoFuncionarioId] = useState<string | undefined>(undefined)

  const [arrastrandoId, setArrastrandoId] = useState<string | null>(null)
  const [sobreId, setSobreId] = useState<string | null>(null)
  const [columnaHover, setColumnaHover] = useState<number | null>(null)
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const [eventosExpandidos, setEventosExpandidos] = useState<Set<string>>(new Set())
  const [ocultas, setOcultas] = useState<Set<string>>(new Set())
  const [mostrarOcultos, setMostrarOcultos] = useState(false)
  const [menuContextual, setMenuContextual] = useState<{ cuadrillaId: string; x: number; y: number } | null>(null)

  const alternarExpandida = (id: string) => {
    setExpandidas((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  const alternarEventoExpandido = (id: string) => {
    setEventosExpandidos((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  // "Ocultar" es solo visual (estado local, no se guarda en la base): saca
  // el turno de la carta Gantt sin tocar sus datos ni los de nadie más, y
  // el botón "Mostrar ocultos" del encabezado lo trae de vuelta. Distinto
  // de "Eliminar", que sí borra el turno y sus trabajadores para siempre.
  const alternarOculta = (id: string) => {
    setOcultas((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
    setMenuContextual(null)
  }

  useEffect(() => {
    if (!menuContextual) return
    const cerrar = () => setMenuContextual(null)
    const alPresionarTecla = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    window.addEventListener('click', cerrar)
    window.addEventListener('scroll', cerrar, true)
    window.addEventListener('keydown', alPresionarTecla)
    return () => {
      window.removeEventListener('click', cerrar)
      window.removeEventListener('scroll', cerrar, true)
      window.removeEventListener('keydown', alPresionarTecla)
    }
  }, [menuContextual])

  const cargar = async () => {
    setCargando(true)
    setError(null)
    try {
      const [datosCuadrillas, datosEventos] = await Promise.all([db.obtenerCuadrillasTurno(), db.obtenerEventosTransito()])
      setCuadrillas(datosCuadrillas as CuadrillaTurno[])
      setEventosTransito(datosEventos as EventoTransito[])
    } catch (err) {
      setError(traducirError(err, 'No se pudieron cargar los turnos'))
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  // Sin realtime: si un coordinador crea/edita un turno mientras este tab
  // ya estaba abierto en la pestaña de otra persona, esa pestaña no se
  // entera sola. Recargar al volver a la pestaña cubre el caso más común
  // (alt-tab / cambiar de módulo y volver) sin tener que armar una
  // suscripción realtime para un módulo de bajo volumen de escritura.
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') cargar()
    }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alVolver)
    return () => {
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', alVolver)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const inicioVentanaFecha = useMemo(() => new Date(`${inicioVentana}T00:00:00`), [inicioVentana])
  const columnasFecha = useMemo(
    () =>
      Array.from({ length: TAMANO_VENTANA }, (_, i) => {
        const d = new Date(inicioVentanaFecha)
        d.setDate(d.getDate() + i)
        return d
      }),
    [inicioVentanaFecha]
  )

  const navegarVentana = (deltaDias: number) => {
    setInicioVentana((actual) => limitarInicioVentana(sumarDias(actual, deltaDias)))
  }

  const moverFechaCuadrilla = async (cuadrilla: CuadrillaTurno, deltaDias: number) => {
    const objetivo = bloqueoGlobal ? cuadrillas : [cuadrilla]
    setError(null)
    try {
      await Promise.all(
        objetivo.map((c) => db.actualizarCuadrillaTurno(c.id, { fecha_inicio: sumarDias(c.fecha_inicio, deltaDias) }))
      )
      setCuadrillas((prev) =>
        prev.map((c) => (objetivo.some((o) => o.id === c.id) ? { ...c, fecha_inicio: sumarDias(c.fecha_inicio, deltaDias) } : c))
      )
    } catch (err) {
      setError(traducirError(err, 'No se pudo mover la fecha del turno'))
    }
  }

  const eliminarCuadrilla = async (cuadrilla: CuadrillaTurno) => {
    const ok = window.confirm(`¿Eliminar el turno "${cuadrilla.nombre}"? Esta acción no se puede deshacer y se perderán sus funcionarios asignados.`)
    if (!ok) return
    setError(null)
    try {
      await db.eliminarCuadrillaTurno(cuadrilla.id)
      setCuadrillas((prev) => prev.filter((c) => c.id !== cuadrilla.id))
      setOcultas((prev) => {
        if (!prev.has(cuadrilla.id)) return prev
        const siguiente = new Set(prev)
        siguiente.delete(cuadrilla.id)
        return siguiente
      })
    } catch (err) {
      setError(traducirError(err, 'No se pudo eliminar el turno'))
    }
  }

  const eliminarEvento = async (evento: EventoTransito) => {
    const etiqueta = evento.tipo === 'subida' ? 'Subida' : 'Bajada'
    const ok = window.confirm(`¿Eliminar esta ${etiqueta} suelta del ${evento.fecha}? Esta acción no se puede deshacer.`)
    if (!ok) return
    setError(null)
    try {
      await db.eliminarEventoTransito(evento.id)
      setEventosTransito((prev) => prev.filter((e) => e.id !== evento.id))
    } catch (err) {
      setError(traducirError(err, `No se pudo eliminar la ${etiqueta.toLowerCase()}`))
    }
  }

  const soltarCuadrilla = async (destino: CuadrillaTurno) => {
    if (!arrastrandoId || arrastrandoId === destino.id) return
    const origenIdx = cuadrillas.findIndex((c) => c.id === arrastrandoId)
    const destinoIdx = cuadrillas.findIndex((c) => c.id === destino.id)
    if (origenIdx === -1 || destinoIdx === -1) return

    const reordenadas = [...cuadrillas]
    const [movida] = reordenadas.splice(origenIdx, 1)
    reordenadas.splice(destinoIdx, 0, movida)
    setCuadrillas(reordenadas)

    setError(null)
    try {
      await db.reordenarCuadrillasTurno(reordenadas.map((c) => c.id))
    } catch (err) {
      setError(traducirError(err, 'No se pudo reordenar los turnos'))
      cargar()
    }
  }

  const cuadrillasVisibles = mostrarOcultos ? cuadrillas : cuadrillas.filter((c) => !ocultas.has(c.id))

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-6 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Organizador de Turnos</h2>
          <p className="text-sm text-slate-500">Carta Gantt de cuadrillas: operaciones, tránsito y descansos</p>
        </div>

        {vista === 'gantt' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 uppercase mr-1">Preconfigurar:</span>
            {PRESETS_TURNO.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setModalPatron(preset)}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                {preset.nombre}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setModalPatron(null)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              + Agregar Turno
            </button>
            <button
              type="button"
              onClick={() => setCuadrillaFuncionarioId(null)}
              disabled={cuadrillas.length === 0}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-700 hover:bg-slate-800 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Agregar Funcionario
            </button>
            <button
              type="button"
              onClick={() => setModalEvento('subida')}
              title="Agregar una Subida suelta de un solo día, independiente de cualquier turno"
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-100 hover:bg-emerald-200 text-emerald-800 transition-colors"
            >
              + ▲ Subida
            </button>
            <button
              type="button"
              onClick={() => setModalEvento('bajada')}
              title="Agregar una Bajada suelta de un solo día, independiente de cualquier turno"
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-100 hover:bg-amber-200 text-amber-800 transition-colors"
            >
              + ▼ Bajada
            </button>
            <button
              type="button"
              onClick={() => setBloqueoGlobal((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                bloqueoGlobal ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
              }`}
              title="Al mover la fecha de un turno con ← →, mover también todos los demás"
            >
              {bloqueoGlobal ? '🔒 Sincronizado' : '🔓 Individual'}
            </button>
            <button
              type="button"
              onClick={cargar}
              disabled={cargando}
              title="Volver a cargar los turnos desde el servidor — no hay sincronización en tiempo real, así que los cambios de otro coordinador no aparecen solos"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors disabled:opacity-40"
            >
              {cargando ? '⏳ Actualizando…' : '↻ Actualizar'}
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 px-4 sm:px-6 pt-3 border-b border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setVista('gantt')}
          className={`px-3 py-1.5 rounded-t-lg text-sm font-semibold transition-colors ${
            vista === 'gantt' ? 'bg-blue-50 text-blue-700 border border-b-0 border-slate-200' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          📅 Carta Gantt
        </button>
        <button
          type="button"
          onClick={() => setVista('reservas')}
          className={`px-3 py-1.5 rounded-t-lg text-sm font-semibold transition-colors ${
            vista === 'reservas' ? 'bg-blue-50 text-blue-700 border border-b-0 border-slate-200' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          🚌 Reservas de Pasajes
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border-b border-red-200 px-4 sm:px-6 py-3">{error}</p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
        <button
          type="button"
          onClick={() => navegarVentana(-TAMANO_VENTANA)}
          disabled={enInicioDeRango(inicioVentana)}
          className="px-2 py-1 rounded hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ← Anterior
        </button>
        <span className="font-semibold whitespace-nowrap">
          {columnasFecha[0]?.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })}
          {' — '}
          {columnasFecha[columnasFecha.length - 1]?.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })}
        </span>
        <button
          type="button"
          onClick={() => navegarVentana(TAMANO_VENTANA)}
          disabled={enFinDeRango(inicioVentana)}
          className="px-2 py-1 rounded hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Siguiente →
        </button>
      </div>

      {vista === 'gantt' && (cargando ? (
        <p className="text-sm text-slate-500 py-12 text-center">Cargando…</p>
      ) : cuadrillas.length === 0 && eventosTransito.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-slate-500">Aún no hay turnos ni subidas/bajadas sueltas creadas.</p>
          <p className="text-xs text-slate-400 mt-1">Usa los botones de preconfiguración, "Agregar Turno", o "+ ▲ Subida" / "+ ▼ Bajada" para comenzar.</p>
        </div>
      ) : cuadrillasVisibles.length === 0 && eventosTransito.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-slate-500">Todos los turnos están ocultos.</p>
          <button
            type="button"
            onClick={() => setMostrarOcultos(true)}
            className="text-xs text-blue-600 hover:underline mt-1"
          >
            👁 Mostrar ocultos ({ocultas.size})
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            <div className="flex border-b border-slate-200 sticky top-0 bg-white z-10">
              <div className="relative w-48 sm:w-96 flex-shrink-0 px-3 sm:px-4 py-2 font-semibold text-xs text-slate-500 uppercase tracking-wider border-r border-slate-200 sticky left-0 bg-white z-20">
                Cuadrilla / Dotación
                {ocultas.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setMostrarOcultos((v) => !v)}
                    title={mostrarOcultos ? 'Ocultar de nuevo los turnos ocultos' : 'Mostrar los turnos ocultos'}
                    className={`absolute bottom-1 right-2 px-1.5 py-0.5 rounded text-[10px] font-semibold normal-case tracking-normal transition-colors ${
                      mostrarOcultos ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    👁 {mostrarOcultos ? 'Viendo ocultos' : `Ocultos (${ocultas.size})`}
                  </button>
                )}
              </div>
              <div className="flex">
                {columnasFecha.map((fecha, idx) => {
                  const mes = fecha.toLocaleDateString('es-CL', { month: 'short' })
                  const diaSemana = fecha.toLocaleDateString('es-CL', { weekday: 'short' }).replace('.', '')
                  const esFinDeSemana = fecha.getDay() === 0 || fecha.getDay() === 6
                  const feriado = esFeriado(fecha)
                  return (
                    <div
                      key={idx}
                      onMouseEnter={() => setColumnaHover(idx)}
                      onMouseLeave={() => setColumnaHover((c) => (c === idx ? null : c))}
                      title={feriado ? `Feriado: ${nombreFeriado(fecha)}` : undefined}
                      className={`relative w-12 flex-shrink-0 text-center py-2 border-r border-slate-100 text-xs ${
                        feriado
                          ? 'bg-yellow-100 font-bold text-yellow-800'
                          : esFinDeSemana
                          ? 'bg-amber-50 font-bold text-amber-700'
                          : 'text-slate-600'
                      }`}
                    >
                      <div className="text-[10px] text-slate-400 uppercase">{mes}</div>
                      <div>{fecha.getDate()}</div>
                      <div className="text-[9px] uppercase opacity-70">{diaSemana}</div>
                      {columnaHover === idx && <div className="absolute inset-0 bg-emerald-300/40 pointer-events-none" />}
                    </div>
                  )
                })}
              </div>
            </div>

            {cuadrillasVisibles.map((cuadrilla) => {
              const segmentos = generarLineaTiempoCuadrilla(cuadrilla, inicioVentanaFecha, TAMANO_VENTANA)
              const estaArrastrando = arrastrandoId === cuadrilla.id
              const estaSobre = sobreId === cuadrilla.id && arrastrandoId !== cuadrilla.id
              const estaExpandida = expandidas.has(cuadrilla.id)
              const estaOculta = ocultas.has(cuadrilla.id)

              return (
              <Fragment key={cuadrilla.id}>
                <div
                  className={`flex border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                    estaArrastrando ? 'opacity-40' : ''
                  } ${estaSobre ? 'border-t-2 border-t-blue-500' : ''} ${estaOculta ? 'opacity-50' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setSobreId(cuadrilla.id) }}
                  onDragLeave={() => setSobreId((c) => (c === cuadrilla.id ? null : c))}
                  onDrop={(e) => { e.preventDefault(); soltarCuadrilla(cuadrilla); setArrastrandoId(null); setSobreId(null) }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenuContextual({ cuadrillaId: cuadrilla.id, x: e.clientX, y: e.clientY })
                  }}
                >
                  <div className="w-48 sm:w-96 flex-shrink-0 px-3 sm:px-4 py-2 border-r border-slate-200 sticky left-0 bg-white z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-0">
                    <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                      <span
                        draggable
                        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setArrastrandoId(cuadrilla.id) }}
                        onDragEnd={() => { setArrastrandoId(null); setSobreId(null) }}
                        title="Arrastrar para reordenar"
                        className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-700 flex-shrink-0"
                      >
                        ⠿
                      </span>
                      <button
                        type="button"
                        onClick={() => alternarExpandida(cuadrilla.id)}
                        title={estaExpandida ? 'Ocultar trabajadores asignados' : 'Ver trabajadores asignados'}
                        className="text-slate-400 hover:text-slate-700 flex-shrink-0"
                      >
                        {estaExpandida ? '▾' : '▸'}
                      </button>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm text-slate-800 truncate">
                          {cuadrilla.nombre}
                          {estaOculta && <span className="ml-1.5 text-[10px] font-normal text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">oculto</span>}
                        </h3>
                        <button
                          type="button"
                          onClick={() => alternarExpandida(cuadrilla.id)}
                          className="text-xs text-slate-500 hover:text-blue-600 hover:underline"
                        >
                          {cuadrilla.trabajadores.length} trabajadores
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-0.5 sm:gap-1">
                      <button
                        type="button"
                        onClick={() => setCuadrillaEditando(cuadrilla)}
                        title="Editar turno"
                        className="p-1 hover:bg-slate-100 rounded text-blue-600"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => setCuadrillaFuncionarioId(cuadrilla.id)}
                        title="Agregar funcionario"
                        className="p-1 hover:bg-slate-100 rounded text-slate-600"
                      >
                        +👤
                      </button>
                      <button
                        type="button"
                        onClick={() => moverFechaCuadrilla(cuadrilla, -1)}
                        title="Mover 1 día atrás"
                        className="p-1 hover:bg-slate-100 rounded text-slate-500"
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        onClick={() => moverFechaCuadrilla(cuadrilla, 1)}
                        title="Mover 1 día adelante"
                        className="p-1 hover:bg-slate-100 rounded text-slate-500"
                      >
                        →
                      </button>
                      <button
                        type="button"
                        onClick={() => eliminarCuadrilla(cuadrilla)}
                        title="Eliminar turno"
                        className="p-1 hover:bg-slate-100 rounded text-red-600"
                      >
                        🗑
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center">
                    {segmentos.map((seg, idx) => (
                      <div
                        key={seg.id}
                        onMouseEnter={() => setColumnaHover(idx)}
                        onMouseLeave={() => setColumnaHover((c) => (c === idx ? null : c))}
                        className={`relative w-12 h-10 border-r border-slate-100 flex items-center justify-center text-[10px] font-bold select-none ${
                          seg.tipo === 'SIN_INICIO' ? 'bg-white' : seg.colorClass
                        }`}
                        title={
                          seg.tipo === 'SIN_INICIO'
                            ? `${cuadrilla.nombre} | ${seg.fecha} : Turno aún no iniciado`
                            : seg.tipo === 'BAJADA'
                            ? `${cuadrilla.nombre} | ${seg.fecha} : Bajada (${seg.etiqueta})`
                            : `${cuadrilla.nombre} | ${seg.fecha} : ${seg.etiqueta}`
                        }
                      >
                        {seg.tipo === 'SUBIDA' && '▲'}
                        {seg.tipo === 'BAJADA' && (
                          <span className="flex flex-col items-center leading-[1.1]">
                            <span>{seg.etiqueta.replace('Día ', 'D')}</span>
                            <span>▼</span>
                          </span>
                        )}
                        {seg.tipo === 'TURNO' && seg.etiqueta.replace('Día ', 'D')}
                        {seg.tipo === 'DESCANSO' && '-'}
                        {columnasFecha[idx] && esFeriado(columnasFecha[idx]) && (
                          <div className="absolute inset-0 bg-yellow-200/50 pointer-events-none" />
                        )}
                        {columnaHover === idx && <div className="absolute inset-0 bg-emerald-300/40 pointer-events-none" />}
                      </div>
                    ))}
                  </div>
                </div>

                {estaExpandida && (
                  <div className="bg-slate-50 border-b border-slate-100 px-4 sm:px-6 py-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-2">
                      Trabajadores asignados — {cuadrilla.nombre}
                    </p>
                    {cuadrilla.trabajadores.length === 0 ? (
                      <p className="text-xs text-slate-400">Sin trabajadores asignados todavía.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="text-xs text-left min-w-[400px]">
                          <thead>
                            <tr className="text-slate-400 uppercase text-[10px]">
                              <th className="font-semibold pr-4 pb-1">Nombre</th>
                              <th className="font-semibold pr-4 pb-1">RUT</th>
                              <th className="font-semibold pb-1">Cargo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cuadrilla.trabajadores.map((t) => (
                              <tr key={t.id} className="border-t border-slate-200">
                                <td className="pr-4 py-1 text-slate-800">{t.nombre} {t.apellido}</td>
                                <td className="pr-4 py-1 text-slate-600">{t.rut}</td>
                                <td className="py-1 text-slate-600">{t.cargo}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </Fragment>
              )
            })}

            {eventosTransito.length > 0 && (
              <>
                <div className="px-3 sm:px-4 py-1.5 bg-slate-50 border-b border-t border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Subidas / Bajadas sueltas
                </div>
                {eventosTransito.map((evento) => {
                  const estaExpandido = eventosExpandidos.has(evento.id)
                  const etiquetaTipo = evento.tipo === 'subida' ? 'Subida' : 'Bajada'
                  return (
                    <Fragment key={evento.id}>
                      <div className="flex border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <div className="w-48 sm:w-96 flex-shrink-0 px-3 sm:px-4 py-2 border-r border-slate-200 sticky left-0 bg-white z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-0">
                          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                            <button
                              type="button"
                              onClick={() => alternarEventoExpandido(evento.id)}
                              title={estaExpandido ? 'Ocultar trabajadores asignados' : 'Ver trabajadores asignados'}
                              className="text-slate-400 hover:text-slate-700 flex-shrink-0"
                            >
                              {estaExpandido ? '▾' : '▸'}
                            </button>
                            <div className="min-w-0">
                              <h3 className="font-semibold text-sm text-slate-800 truncate">
                                {evento.tipo === 'subida' ? '▲' : '▼'} {etiquetaTipo} suelta
                              </h3>
                              <button
                                type="button"
                                onClick={() => alternarEventoExpandido(evento.id)}
                                className="text-xs text-slate-500 hover:text-blue-600 hover:underline"
                              >
                                {evento.trabajadores.length} trabajadores
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center gap-0.5 sm:gap-1">
                            <button
                              type="button"
                              onClick={() => setEventoFuncionarioId(evento.id)}
                              title="Agregar funcionario"
                              className="p-1 hover:bg-slate-100 rounded text-slate-600"
                            >
                              +👤
                            </button>
                            <button
                              type="button"
                              onClick={() => eliminarEvento(evento)}
                              title={`Eliminar ${etiquetaTipo.toLowerCase()}`}
                              className="p-1 hover:bg-slate-100 rounded text-red-600"
                            >
                              🗑
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center">
                          {columnasFecha.map((fecha, idx) => {
                            const fechaStr = fecha.toISOString().split('T')[0]
                            const esElDia = fechaStr === evento.fecha
                            return (
                              <div
                                key={idx}
                                onMouseEnter={() => setColumnaHover(idx)}
                                onMouseLeave={() => setColumnaHover((c) => (c === idx ? null : c))}
                                className={`relative w-12 h-10 border-r border-slate-100 flex items-center justify-center text-[10px] font-bold select-none ${
                                  esElDia ? 'bg-amber-800 text-white' : 'bg-white'
                                }`}
                                title={esElDia ? `${etiquetaTipo} suelta | ${evento.fecha}` : undefined}
                              >
                                {esElDia && (evento.tipo === 'subida' ? '▲' : '▼')}
                                {esFeriado(fecha) && <div className="absolute inset-0 bg-yellow-200/50 pointer-events-none" />}
                                {columnaHover === idx && <div className="absolute inset-0 bg-emerald-300/40 pointer-events-none" />}
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {estaExpandido && (
                        <div className="bg-slate-50 border-b border-slate-100 px-4 sm:px-6 py-3">
                          <p className="text-xs font-semibold text-slate-500 uppercase mb-2">
                            Trabajadores asignados — {etiquetaTipo} suelta del {evento.fecha}
                          </p>
                          {evento.trabajadores.length === 0 ? (
                            <p className="text-xs text-slate-400">Sin trabajadores asignados todavía.</p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="text-xs text-left min-w-[400px]">
                                <thead>
                                  <tr className="text-slate-400 uppercase text-[10px]">
                                    <th className="font-semibold pr-4 pb-1">Nombre</th>
                                    <th className="font-semibold pr-4 pb-1">RUT</th>
                                    <th className="font-semibold pb-1">Cargo</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {evento.trabajadores.map((t) => (
                                    <tr key={t.id} className="border-t border-slate-200">
                                      <td className="pr-4 py-1 text-slate-800">{t.nombre} {t.apellido}</td>
                                      <td className="pr-4 py-1 text-slate-600">{t.rut}</td>
                                      <td className="py-1 text-slate-600">{t.cargo}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </Fragment>
                  )
                })}
              </>
            )}
          </div>
        </div>
      ))}

      {vista === 'gantt' && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 sm:px-6 py-3 border-t border-slate-200 text-xs text-slate-500">
          <span className="font-semibold w-full sm:w-auto">Leyenda:</span>
          <div className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded bg-amber-800 inline-block" />Subida / Bajada</div>
          <div className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded bg-amber-400 inline-block" />Turno en Faena</div>
          <div className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded bg-slate-200 inline-block" />Descanso</div>
        </div>
      )}

      {vista === 'reservas' && (
        <ReservasPasajes
          cuadrillas={cuadrillas}
          eventosTransito={eventosTransito}
          inicioVentanaFecha={inicioVentanaFecha}
          diasVentana={TAMANO_VENTANA}
          usuario={usuario}
        />
      )}

      {modalPatron !== undefined && (
        <ModalAgregarTurno
          patronInicial={modalPatron}
          cantidadCuadrillas={cuadrillas.length}
          usuario={usuario}
          onCerrar={() => setModalPatron(undefined)}
          onCreado={(nueva) => { setCuadrillas((prev) => [...prev, nueva]); setModalPatron(undefined) }}
        />
      )}

      {cuadrillaFuncionarioId !== undefined && (
        <ModalAgregarFuncionario
          cuadrillas={cuadrillas}
          cuadrillaIdInicial={cuadrillaFuncionarioId ?? undefined}
          onCerrar={() => setCuadrillaFuncionarioId(undefined)}
          onAgregados={(cuadrillaId, trabajadores) => {
            setCuadrillas((prev) =>
              prev.map((c) => (c.id === cuadrillaId ? { ...c, trabajadores: [...c.trabajadores, ...trabajadores] } : c))
            )
            setCuadrillaFuncionarioId(undefined)
          }}
        />
      )}

      {cuadrillaEditando && (
        <ModalEditarTurno
          cuadrilla={cuadrillaEditando}
          onCerrar={() => setCuadrillaEditando(null)}
          onGuardado={(actualizada) => {
            setCuadrillas((prev) => prev.map((c) => (c.id === actualizada.id ? actualizada : c)))
            setCuadrillaEditando(null)
          }}
        />
      )}

      {modalEvento !== undefined && (
        <ModalAgregarEventoTransito
          tipo={modalEvento}
          usuario={usuario}
          onCerrar={() => setModalEvento(undefined)}
          onCreado={(nuevo) => { setEventosTransito((prev) => [...prev, nuevo]); setModalEvento(undefined) }}
        />
      )}

      {eventoFuncionarioId !== undefined && (
        <ModalAgregarFuncionarioEvento
          evento={eventosTransito.find((e) => e.id === eventoFuncionarioId)!}
          onCerrar={() => setEventoFuncionarioId(undefined)}
          onAgregados={(eventoId, trabajadores) => {
            setEventosTransito((prev) =>
              prev.map((e) => (e.id === eventoId ? { ...e, trabajadores: [...e.trabajadores, ...trabajadores] } : e))
            )
            setEventoFuncionarioId(undefined)
          }}
        />
      )}

      {menuContextual && (
        <div
          className="fixed bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1 min-w-[180px]"
          style={{ top: menuContextual.y, left: menuContextual.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => alternarOculta(menuContextual.cuadrillaId)}
            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            {ocultas.has(menuContextual.cuadrillaId) ? '👁 Mostrar turno' : '🙈 Ocultar turno'}
          </button>
        </div>
      )}
    </div>
  )
}
