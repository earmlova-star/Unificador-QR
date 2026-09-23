import { useEffect, useMemo, useState } from 'react'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { CuadrillaTurno, Usuario } from '@/types/index'
import { generarLineaTiempoCuadrilla } from './lib/motorTurnos'
import { PRESETS_TURNO, PatronTurno } from './lib/presetsTurno'
import { CALENDARIO_INICIO, TAMANO_VENTANA, enInicioDeRango, enFinDeRango, limitarInicioVentana, sumarDias } from './lib/rangoFechas'
import { ModalAgregarTurno } from './ModalAgregarTurno'
import { ModalEditarTurno } from './ModalEditarTurno'
import { ModalAgregarFuncionario } from './ModalAgregarFuncionario'

interface OrganizadorTurnosProps {
  usuario: Usuario
}

// Módulo "Organizador de Turnos": carta Gantt de cuadrillas mineras,
// compartida vía Supabase (ver add_organizador_turnos.sql) entre
// coordinador y consultor (ver fix_organizador_turnos_rol_consultor.sql).
// Independiente de faena/contrato — pedido explícito.
export const OrganizadorTurnos = ({ usuario }: OrganizadorTurnosProps) => {
  const [cuadrillas, setCuadrillas] = useState<CuadrillaTurno[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [inicioVentana, setInicioVentana] = useState(CALENDARIO_INICIO)
  const [bloqueoGlobal, setBloqueoGlobal] = useState(false)

  const [modalPatron, setModalPatron] = useState<PatronTurno | null | undefined>(undefined)
  const [cuadrillaFuncionarioId, setCuadrillaFuncionarioId] = useState<string | null | undefined>(undefined)
  const [cuadrillaEditando, setCuadrillaEditando] = useState<CuadrillaTurno | null>(null)

  const [arrastrandoId, setArrastrandoId] = useState<string | null>(null)
  const [sobreId, setSobreId] = useState<string | null>(null)

  const cargar = async () => {
    setCargando(true)
    setError(null)
    try {
      const data = await db.obtenerCuadrillasTurno()
      setCuadrillas(data as CuadrillaTurno[])
    } catch (err) {
      setError(traducirError(err, 'No se pudieron cargar los turnos'))
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
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
    } catch (err) {
      setError(traducirError(err, 'No se pudo eliminar el turno'))
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
      await db.reordenarCuadrillasTurno(reordenadas.map((c, idx) => ({ id: c.id, orden: idx })))
    } catch (err) {
      setError(traducirError(err, 'No se pudo reordenar los turnos'))
      cargar()
    }
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-6 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Organizador de Turnos</h2>
          <p className="text-sm text-slate-500">Carta Gantt de cuadrillas: operaciones, tránsito y descansos</p>
        </div>

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
            onClick={() => setBloqueoGlobal((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              bloqueoGlobal ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
            }`}
            title="Al mover la fecha de un turno con ← →, mover también todos los demás"
          >
            {bloqueoGlobal ? '🔒 Sincronizado' : '🔓 Individual'}
          </button>
        </div>
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

      {cargando ? (
        <p className="text-sm text-slate-500 py-12 text-center">Cargando…</p>
      ) : cuadrillas.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-slate-500">Aún no hay turnos creados.</p>
          <p className="text-xs text-slate-400 mt-1">Usa los botones de preconfiguración o "Agregar Turno" para comenzar.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            <div className="flex border-b border-slate-200 sticky top-0 bg-white z-10">
              <div className="w-44 sm:w-72 flex-shrink-0 px-3 sm:px-4 py-2 font-semibold text-xs text-slate-500 uppercase tracking-wider border-r border-slate-200 sticky left-0 bg-white z-20">
                Cuadrilla / Dotación
              </div>
              <div className="flex">
                {columnasFecha.map((fecha, idx) => {
                  const mes = fecha.toLocaleDateString('es-CL', { month: 'short' })
                  const diaSemana = fecha.toLocaleDateString('es-CL', { weekday: 'short' }).replace('.', '')
                  const esFinDeSemana = fecha.getDay() === 0 || fecha.getDay() === 6
                  return (
                    <div
                      key={idx}
                      className={`w-12 flex-shrink-0 text-center py-2 border-r border-slate-100 text-xs ${
                        esFinDeSemana ? 'bg-amber-50 font-bold text-amber-700' : 'text-slate-600'
                      }`}
                    >
                      <div className="text-[10px] text-slate-400 uppercase">{mes}</div>
                      <div>{fecha.getDate()}</div>
                      <div className="text-[9px] uppercase opacity-70">{diaSemana}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {cuadrillas.map((cuadrilla) => {
              const segmentos = generarLineaTiempoCuadrilla(cuadrilla, inicioVentanaFecha, TAMANO_VENTANA)
              const estaArrastrando = arrastrandoId === cuadrilla.id
              const estaSobre = sobreId === cuadrilla.id && arrastrandoId !== cuadrilla.id

              return (
                <div
                  key={cuadrilla.id}
                  className={`flex border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                    estaArrastrando ? 'opacity-40' : ''
                  } ${estaSobre ? 'border-t-2 border-t-blue-500' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setSobreId(cuadrilla.id) }}
                  onDragLeave={() => setSobreId((c) => (c === cuadrilla.id ? null : c))}
                  onDrop={(e) => { e.preventDefault(); soltarCuadrilla(cuadrilla); setArrastrandoId(null); setSobreId(null) }}
                >
                  <div className="w-44 sm:w-72 flex-shrink-0 px-3 sm:px-4 py-2 border-r border-slate-200 sticky left-0 bg-white z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-0">
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
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm text-slate-800 truncate">{cuadrilla.nombre}</h3>
                        <p className="text-xs text-slate-500">{cuadrilla.trabajadores.length} trabajadores</p>
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
                    {segmentos.map((seg) => (
                      <div
                        key={seg.id}
                        className={`w-12 h-10 border-r border-slate-100 flex items-center justify-center text-[10px] font-bold select-none ${
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
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 sm:px-6 py-3 border-t border-slate-200 text-xs text-slate-500">
        <span className="font-semibold w-full sm:w-auto">Leyenda:</span>
        <div className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded bg-amber-800 inline-block" />Subida / Bajada</div>
        <div className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded bg-amber-400 inline-block" />Turno en Faena</div>
        <div className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded bg-slate-200 inline-block" />Descanso</div>
      </div>

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
          onAgregado={(cuadrillaId, trabajador) => {
            setCuadrillas((prev) =>
              prev.map((c) => (c.id === cuadrillaId ? { ...c, trabajadores: [...c.trabajadores, trabajador] } : c))
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
    </div>
  )
}
