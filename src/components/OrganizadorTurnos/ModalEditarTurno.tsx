import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { ConfiguracionViaje, CuadrillaTurno } from '@/types/index'
import { PRESETS_TURNO, PatronTurno } from './lib/presetsTurno'
import { TEMAS_COLOR } from './lib/coloresTurno'
import { CALENDARIO_INICIO, CALENDARIO_FIN } from './lib/rangoFechas'
import { validarRut, formatearRut } from './lib/rut'
import { parsearTrabajadoresMasivo } from './lib/parseoMasivo'

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
  const [trabajadores, setTrabajadores] = useState(cuadrilla.trabajadores)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoApellido, setNuevoApellido] = useState('')
  const [nuevoRut, setNuevoRut] = useState('')
  const [nuevoCargo, setNuevoCargo] = useState('')
  const [mostrarPegado, setMostrarPegado] = useState(false)
  const [textoMasivo, setTextoMasivo] = useState('')
  const [agregandoMasivo, setAgregandoMasivo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { validos: masivoValidos, errores: masivoErrores } = parsearTrabajadoresMasivo(textoMasivo)

  const elegirPreset = (preset: PatronTurno) => {
    setPresetId(preset.id)
    setDiasTrabajo(preset.diasTrabajo)
    setDiasDescanso(preset.diasDescanso)
  }

  const actualizarTrabajadorLocal = (id: string, campo: 'nombre' | 'apellido' | 'rut' | 'cargo', valor: string) => {
    setTrabajadores((prev) => prev.map((t) => (t.id === id ? { ...t, [campo]: campo === 'rut' ? formatearRut(valor) : valor } : t)))
  }

  const eliminarTrabajador = async (id: string) => {
    setError(null)
    try {
      await db.eliminarTrabajadorCuadrilla(id)
      setTrabajadores((prev) => prev.filter((t) => t.id !== id))
    } catch (err) {
      setError(traducirError(err, 'No se pudo eliminar el funcionario'))
    }
  }

  const agregarTrabajadorNuevo = async () => {
    setError(null)
    if (!nuevoNombre.trim() || !nuevoApellido.trim() || !nuevoCargo.trim()) return setError('Completa nombre, apellido y cargo del nuevo funcionario.')
    if (!validarRut(nuevoRut)) return setError('RUT inválido. Formato esperado XX.XXX.XXX-X.')

    try {
      const t = await db.agregarTrabajadorCuadrilla({
        cuadrilla_id: cuadrilla.id,
        nombre: nuevoNombre.trim(),
        apellido: nuevoApellido.trim(),
        rut: nuevoRut,
        cargo: nuevoCargo.trim(),
      })
      setTrabajadores((prev) => [...prev, t as any])
      setNuevoNombre(''); setNuevoApellido(''); setNuevoRut(''); setNuevoCargo('')
    } catch (err) {
      setError(traducirError(err, 'No se pudo agregar el funcionario'))
    }
  }

  const agregarDesdePegado = async () => {
    if (masivoValidos.length === 0 || masivoErrores.length > 0) return
    setError(null)
    setAgregandoMasivo(true)
    try {
      const nuevos = await db.agregarTrabajadoresCuadrilla(
        masivoValidos.map((t) => ({ cuadrilla_id: cuadrilla.id, ...t }))
      )
      setTrabajadores((prev) => [...prev, ...(nuevos as any[])])
      setTextoMasivo('')
      setMostrarPegado(false)
    } catch (err) {
      setError(traducirError(err, 'No se pudieron agregar los funcionarios'))
    } finally {
      setAgregandoMasivo(false)
    }
  }

  const guardar = async () => {
    setError(null)
    if (!nombre.trim()) return setError('El nombre del turno es obligatorio.')
    if (diasTrabajo < 1 || diasDescanso < 1) return setError('Los días de trabajo y descanso deben ser al menos 1.')
    if (fechaInicio < CALENDARIO_INICIO || fechaInicio > CALENDARIO_FIN) {
      return setError(`La fecha de inicio debe estar entre ${CALENDARIO_INICIO} y ${CALENDARIO_FIN}.`)
    }
    for (const t of trabajadores) {
      if (!t.nombre.trim() || !t.apellido.trim() || !t.cargo.trim()) return setError('Completa nombre, apellido y cargo de cada funcionario.')
      if (!validarRut(t.rut)) return setError(`RUT inválido: ${t.rut}.`)
    }

    setGuardando(true)
    try {
      const original = cuadrilla.trabajadores
      const cambiosTrabajadores = trabajadores.filter((t) => {
        const o = original.find((x) => x.id === t.id)
        return o && (o.nombre !== t.nombre || o.apellido !== t.apellido || o.rut !== t.rut || o.cargo !== t.cargo)
      })

      const actualizada = await db.guardarEdicionCuadrillaTurno(
        cuadrilla.id,
        cambiosTrabajadores.map((t) => ({ id: t.id, nombre: t.nombre, apellido: t.apellido, rut: t.rut, cargo: t.cargo })),
        {
          nombre: nombre.trim(),
          patron_dias_trabajo: diasTrabajo,
          patron_dias_descanso: diasDescanso,
          patron_incluye_subida: incluyeSubida,
          fecha_inicio: fechaInicio,
          color_tema: colorTemaId,
          config_subida_id: configSubidaId || null,
          config_bajada_id: configBajadaId || null,
        }
      )

      onGuardado({ ...actualizada, trabajadores } as CuadrillaTurno)
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

            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-500 uppercase">Funcionarios</label>
                <button
                  type="button"
                  onClick={() => setMostrarPegado((v) => !v)}
                  className={`text-xs px-2 py-1 rounded-lg transition-colors ${mostrarPegado ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                >
                  ⚡ Pegar lista
                </button>
              </div>

              {mostrarPegado && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 mt-2 space-y-2">
                  <textarea
                    value={textoMasivo}
                    onChange={(e) => setTextoMasivo(e.target.value)}
                    rows={5}
                    placeholder={'Pega desde Excel, una persona por línea — Nombre completo, RUT, Cargo:\n\nJuan Pérez González\t12.345.678-9\tCapataz'}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs font-mono focus:outline-none focus:border-blue-600"
                  />
                  {textoMasivo.trim() && masivoErrores.length > 0 && (
                    <div className="text-xs bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 space-y-0.5">
                      {masivoErrores.map((e) => (
                        <p key={e.linea} className="text-red-700">Línea {e.linea}: {e.mensaje}</p>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={agregarDesdePegado}
                      disabled={agregandoMasivo || masivoValidos.length === 0 || masivoErrores.length > 0}
                      className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                    >
                      {agregandoMasivo ? 'Agregando…' : masivoValidos.length > 0 ? `Agregar ${masivoValidos.length}` : 'Agregar'}
                    </button>
                  </div>
                </div>
              )}

              {trabajadores.length === 0 && <p className="text-xs text-slate-400 mt-1">Este turno no tiene funcionarios asignados.</p>}

              <div className="space-y-2 mt-2">
                {trabajadores.map((t) => (
                  <div key={t.id} className="bg-slate-50 border border-slate-200 rounded-lg p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase text-slate-400">Funcionario</span>
                      <button type="button" onClick={() => eliminarTrabajador(t.id)} className="text-red-600 hover:text-red-700 text-xs">🗑</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" value={t.nombre} onChange={(e) => actualizarTrabajadorLocal(t.id, 'nombre', e.target.value)} placeholder="Nombre" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                      <input type="text" value={t.apellido} onChange={(e) => actualizarTrabajadorLocal(t.id, 'apellido', e.target.value)} placeholder="Apellido" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" value={t.rut} onChange={(e) => actualizarTrabajadorLocal(t.id, 'rut', e.target.value)} placeholder="RUT" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                      <input type="text" value={t.cargo} onChange={(e) => actualizarTrabajadorLocal(t.id, 'cargo', e.target.value)} placeholder="Cargo" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-slate-50 border border-dashed border-slate-300 rounded-lg p-2 space-y-2 mt-2">
                <span className="text-[10px] uppercase text-slate-400">Agregar nuevo funcionario</span>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="Nombre" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                  <input type="text" value={nuevoApellido} onChange={(e) => setNuevoApellido(e.target.value)} placeholder="Apellido" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={nuevoRut} onChange={(e) => setNuevoRut(formatearRut(e.target.value))} placeholder="RUT (12.345.678-9)" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                  <input type="text" value={nuevoCargo} onChange={(e) => setNuevoCargo(e.target.value)} placeholder="Cargo" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                </div>
                <button type="button" onClick={agregarTrabajadorNuevo} className="text-xs px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700">
                  + Agregar a la lista
                </button>
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
