import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { ConfiguracionViaje, CuadrillaTurno } from '@/types/index'
import { PRESETS_TURNO, PatronTurno } from './lib/presetsTurno'
import { TEMAS_COLOR } from './lib/coloresTurno'
import { CALENDARIO_INICIO, CALENDARIO_FIN } from './lib/rangoFechas'

interface ModalEditarTurnoProps {
  cuadrilla: CuadrillaTurno
  configuraciones: ConfiguracionViaje[]
  onCerrar: () => void
  onGuardado: (cuadrilla: CuadrillaTurno) => void
}

function coincideConPreset(dt: number, dd: number): string {
  const match = PRESETS_TURNO.find((p) => p.diasTrabajo === dt && p.diasDescanso === dd)
  return match ? match.id : 'custom'
}

// Solo campos propios del turno (nombre, patrón, fecha, color, config de
// viaje) — la gestión de sus trabajadores (ver/editar/agregar/eliminar) se
// sacó a ModalTrabajadores (pedido explícito 2026-09-30), compartido con
// las subidas/bajadas sueltas, para no tener dos lugares distintos editando
// lo mismo. guardarEdicionCuadrillaTurno igual acepta una lista de
// trabajadores cambiados (para el caso combinado); acá se le pasa vacía —
// esta pantalla nunca toca esos datos.
export const ModalEditarTurno = ({ cuadrilla, configuraciones, onCerrar, onGuardado }: ModalEditarTurnoProps) => {
  const [nombre, setNombre] = useState(cuadrilla.nombre)
  const [presetId, setPresetId] = useState(coincideConPreset(cuadrilla.patron_dias_trabajo, cuadrilla.patron_dias_descanso))
  const [diasTrabajo, setDiasTrabajo] = useState(cuadrilla.patron_dias_trabajo)
  const [diasDescanso, setDiasDescanso] = useState(cuadrilla.patron_dias_descanso)
  const [incluyeSubida, setIncluyeSubida] = useState(cuadrilla.patron_incluye_subida)
  const [fechaInicio, setFechaInicio] = useState(cuadrilla.fecha_inicio)
  const [colorTemaId, setColorTemaId] = useState(cuadrilla.color_tema)
  const [configSubidaId, setConfigSubidaId] = useState(cuadrilla.config_subida_id ?? '')
  const [configBajadaId, setConfigBajadaId] = useState(cuadrilla.config_bajada_id ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const elegirPreset = (preset: PatronTurno) => {
    setPresetId(preset.id)
    setDiasTrabajo(preset.diasTrabajo)
    setDiasDescanso(preset.diasDescanso)
  }

  const guardar = async () => {
    setError(null)
    if (!nombre.trim()) return setError('El nombre del turno es obligatorio.')
    if (diasTrabajo < 1 || diasDescanso < 1) return setError('Los días de trabajo y descanso deben ser al menos 1.')
    if (fechaInicio < CALENDARIO_INICIO || fechaInicio > CALENDARIO_FIN) {
      return setError(`La fecha de inicio debe estar entre ${CALENDARIO_INICIO} y ${CALENDARIO_FIN}.`)
    }

    setGuardando(true)
    try {
      const actualizada = await db.guardarEdicionCuadrillaTurno(cuadrilla.id, [], {
        nombre: nombre.trim(),
        patron_dias_trabajo: diasTrabajo,
        patron_dias_descanso: diasDescanso,
        patron_incluye_subida: incluyeSubida,
        fecha_inicio: fechaInicio,
        color_tema: colorTemaId,
        config_subida_id: configSubidaId || null,
        config_bajada_id: configBajadaId || null,
      })

      onGuardado({ ...actualizada, trabajadores: cuadrilla.trabajadores } as CuadrillaTurno)
    } catch (err) {
      setError(traducirError(err, 'No se pudo guardar el turno'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white rounded-lg shadow-xl z-50 p-6 max-h-[85vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-bold text-slate-900 mb-4">Editar Turno</Dialog.Title>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Nombre del turno / cuadrilla</label>
              <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Patrón de turno</label>
              <div className="flex flex-wrap gap-2 mb-3">
                {PRESETS_TURNO.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => elegirPreset(preset)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      presetId === preset.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                    }`}
                  >
                    {preset.nombre}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPresetId('custom')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    presetId === 'custom' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                  }`}
                >
                  Personalizado
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Días de trabajo</label>
                  <input type="number" min={1} value={diasTrabajo} onChange={(e) => { setPresetId('custom'); setDiasTrabajo(Number(e.target.value)) }} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Días de descanso</label>
                  <input type="number" min={1} value={diasDescanso} onChange={(e) => { setPresetId('custom'); setDiasDescanso(Number(e.target.value)) }} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600" />
                </div>
              </div>
              <label className="flex items-center gap-2 mt-3 text-sm text-slate-600">
                <input type="checkbox" checked={incluyeSubida} onChange={(e) => setIncluyeSubida(e.target.checked)} />
                Incluir día de subida (tránsito)
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Fecha de inicio</label>
              <input type="date" min={CALENDARIO_INICIO} max={CALENDARIO_FIN} value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Configuración de viaje (Reservas de Pasajes)</label>
              <p className="text-[11px] text-slate-400 mb-2">
                Si no asignas ninguna, la subida/bajada de este turno sigue usando el Origen/Destino genérico.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">▲ Subida</label>
                  <select
                    value={configSubidaId}
                    onChange={(e) => setConfigSubidaId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                  >
                    <option value="">Sin asignar</option>
                    {configuraciones
                      .filter((c) => c.tipo === 'subida')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.hora} — {c.origen} → {c.destino}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">▼ Bajada</label>
                  <select
                    value={configBajadaId}
                    onChange={(e) => setConfigBajadaId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                  >
                    <option value="">Sin asignar</option>
                    {configuraciones
                      .filter((c) => c.tipo === 'bajada')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.hora} — {c.origen} → {c.destino}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Color</label>
              <div className="flex flex-wrap gap-2">
                {TEMAS_COLOR.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    title={t.etiqueta}
                    onClick={() => setColorTemaId(t.id)}
                    className={`w-8 h-8 rounded-lg border-2 ${t.tema.turno.split(' ')[0]} ${colorTemaId === t.id ? 'border-slate-900' : 'border-transparent'}`}
                  />
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <Dialog.Close asChild>
                <button type="button" className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">
                  Cancelar
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={guardar}
                disabled={guardando}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                {guardando ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
