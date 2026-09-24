import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { CuadrillaTurno, Usuario } from '@/types/index'
import { PRESETS_TURNO, PatronTurno } from './lib/presetsTurno'
import { siguienteTema } from './lib/coloresTurno'
import { CALENDARIO_INICIO, CALENDARIO_FIN } from './lib/rangoFechas'
import { validarRut, formatearRut } from './lib/rut'
import { parsearTrabajadoresMasivo } from './lib/parseoMasivo'

interface ModalAgregarTurnoProps {
  patronInicial: PatronTurno | null
  cantidadCuadrillas: number
  usuario: Usuario
  onCerrar: () => void
  onCreado: (cuadrilla: CuadrillaTurno) => void
}

interface FuncionarioBorrador {
  key: string
  nombre: string
  apellido: string
  rut: string
  cargo: string
}

function funcionarioVacio(): FuncionarioBorrador {
  return { key: crypto.randomUUID(), nombre: '', apellido: '', rut: '', cargo: '' }
}

export const ModalAgregarTurno = ({ patronInicial, cantidadCuadrillas, usuario, onCerrar, onCreado }: ModalAgregarTurnoProps) => {
  const [nombre, setNombre] = useState('')
  const [presetId, setPresetId] = useState<string>(patronInicial?.id ?? 'custom')
  const [diasTrabajo, setDiasTrabajo] = useState(patronInicial?.diasTrabajo ?? 14)
  const [diasDescanso, setDiasDescanso] = useState(patronInicial?.diasDescanso ?? 14)
  const [incluyeSubida, setIncluyeSubida] = useState(true)
  const [fechaInicio, setFechaInicio] = useState(CALENDARIO_INICIO)
  const [funcionarios, setFuncionarios] = useState<FuncionarioBorrador[]>([])
  const [mostrarPegado, setMostrarPegado] = useState(false)
  const [textoMasivo, setTextoMasivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { validos: masivoValidos, errores: masivoErrores } = parsearTrabajadoresMasivo(textoMasivo)

  const agregarDesdePegado = () => {
    if (masivoValidos.length === 0) return
    setFuncionarios((prev) => [
      ...prev,
      ...masivoValidos.map((t) => ({ key: crypto.randomUUID(), ...t })),
    ])
    setTextoMasivo('')
    setMostrarPegado(false)
  }

  const elegirPreset = (preset: PatronTurno) => {
    setPresetId(preset.id)
    setDiasTrabajo(preset.diasTrabajo)
    setDiasDescanso(preset.diasDescanso)
  }

  const actualizarFuncionario = (key: string, campo: keyof Omit<FuncionarioBorrador, 'key'>, valor: string) => {
    setFuncionarios((prev) => prev.map((f) => (f.key === key ? { ...f, [campo]: campo === 'rut' ? formatearRut(valor) : valor } : f)))
  }

  const guardar = async () => {
    setError(null)

    if (!nombre.trim()) return setError('El nombre del turno es obligatorio.')
    if (diasTrabajo < 1 || diasDescanso < 1) return setError('Los días de trabajo y descanso deben ser al menos 1.')
    if (fechaInicio < CALENDARIO_INICIO || fechaInicio > CALENDARIO_FIN) {
      return setError(`La fecha de inicio debe estar entre ${CALENDARIO_INICIO} y ${CALENDARIO_FIN}.`)
    }
    for (const f of funcionarios) {
      if (!f.nombre.trim() || !f.apellido.trim() || !f.cargo.trim()) {
        return setError('Completa nombre, apellido y cargo de cada funcionario agregado.')
      }
      if (!validarRut(f.rut)) {
        return setError(`RUT inválido: ${f.rut || '(vacío)'}. Formato esperado XX.XXX.XXX-X.`)
      }
    }

    setGuardando(true)
    try {
      const cuadrilla = await db.crearCuadrillaTurno({
        nombre: nombre.trim(),
        patron_dias_trabajo: diasTrabajo,
        patron_dias_descanso: diasDescanso,
        patron_incluye_subida: incluyeSubida,
        fecha_inicio: fechaInicio,
        color_tema: siguienteTema(cantidadCuadrillas).id,
        orden: cantidadCuadrillas,
        creado_por: usuario.id,
      })

      const trabajadoresCreados = funcionarios.length
        ? await db.agregarTrabajadoresCuadrilla(
            funcionarios.map((f) => ({
              cuadrilla_id: cuadrilla.id,
              nombre: f.nombre.trim(),
              apellido: f.apellido.trim(),
              rut: f.rut,
              cargo: f.cargo.trim(),
            }))
          )
        : []

      onCreado({ ...cuadrilla, trabajadores: trabajadoresCreados } as CuadrillaTurno)
    } catch (err) {
      setError(traducirError(err, 'No se pudo crear el turno'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white rounded-lg shadow-xl z-50 p-6 max-h-[85vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-bold text-slate-900 mb-4">Agregar Turno</Dialog.Title>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Nombre del turno / cuadrilla</label>
              <input
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Cuadrilla 7 (14x14 - Grupo D)"
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              />
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
                  <input
                    type="number"
                    min={1}
                    value={diasTrabajo}
                    onChange={(e) => { setPresetId('custom'); setDiasTrabajo(Number(e.target.value)) }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Días de descanso</label>
                  <input
                    type="number"
                    min={1}
                    value={diasDescanso}
                    onChange={(e) => { setPresetId('custom'); setDiasDescanso(Number(e.target.value)) }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 mt-3 text-sm text-slate-600">
                <input type="checkbox" checked={incluyeSubida} onChange={(e) => setIncluyeSubida(e.target.checked)} />
                Incluir día de subida (tránsito)
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Fecha de inicio</label>
              <input
                type="date"
                min={CALENDARIO_INICIO}
                max={CALENDARIO_FIN}
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">Funcionarios a incluir</label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setMostrarPegado((v) => !v)}
                    className={`text-xs px-2 py-1 rounded-lg transition-colors ${mostrarPegado ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                  >
                    ⚡ Pegar lista
                  </button>
                  <button
                    type="button"
                    onClick={() => setFuncionarios((prev) => [...prev, funcionarioVacio()])}
                    className="text-xs px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"
                  >
                    + Agregar funcionario
                  </button>
                </div>
              </div>

              {mostrarPegado && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 mb-2 space-y-2">
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
                      disabled={masivoValidos.length === 0 || masivoErrores.length > 0}
                      className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                    >
                      {masivoValidos.length > 0 ? `Agregar ${masivoValidos.length} a la lista` : 'Agregar a la lista'}
                    </button>
                  </div>
                </div>
              )}

              {funcionarios.length === 0 && (
                <p className="text-xs text-slate-400">Puedes crear el turno sin funcionarios y agregarlos después, o incluirlos ahora.</p>
              )}

              <div className="space-y-2">
                {funcionarios.map((f) => (
                  <div key={f.key} className="bg-slate-50 border border-slate-200 rounded-lg p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase text-slate-400">Funcionario</span>
                      <button
                        type="button"
                        onClick={() => setFuncionarios((prev) => prev.filter((x) => x.key !== f.key))}
                        className="text-red-600 hover:text-red-700 text-xs"
                      >
                        🗑
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" placeholder="Nombre" value={f.nombre} onChange={(e) => actualizarFuncionario(f.key, 'nombre', e.target.value)} className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                      <input type="text" placeholder="Apellido" value={f.apellido} onChange={(e) => actualizarFuncionario(f.key, 'apellido', e.target.value)} className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" placeholder="RUT (12.345.678-9)" value={f.rut} onChange={(e) => actualizarFuncionario(f.key, 'rut', e.target.value)} className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                      <input type="text" placeholder="Cargo" value={f.cargo} onChange={(e) => actualizarFuncionario(f.key, 'cargo', e.target.value)} className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                    </div>
                  </div>
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
                {guardando ? 'Creando…' : 'Crear turno'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
