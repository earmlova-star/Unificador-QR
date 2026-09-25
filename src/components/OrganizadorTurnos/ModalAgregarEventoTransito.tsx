import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { EventoTransito, Usuario } from '@/types/index'
import { CALENDARIO_INICIO, CALENDARIO_FIN } from './lib/rangoFechas'
import { validarRut, formatearRut } from './lib/rut'
import { parsearTrabajadoresMasivo } from './lib/parseoMasivo'

interface ModalAgregarEventoTransitoProps {
  tipo: 'subida' | 'bajada'
  usuario: Usuario
  onCerrar: () => void
  onCreado: (evento: EventoTransito) => void
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

// Crea una Subida o Bajada suelta: un día de tránsito independiente de
// cualquier Turno/cuadrilla, sin patrón ni ciclo — ver EventoTransito en
// types/index.ts. Misma estructura que ModalAgregarTurno.tsx (fecha +
// funcionarios uno por uno o pegado masivo), sin los campos de patrón que
// acá no aplican.
export const ModalAgregarEventoTransito = ({ tipo, usuario, onCerrar, onCreado }: ModalAgregarEventoTransitoProps) => {
  const [fecha, setFecha] = useState(CALENDARIO_INICIO)
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

  const actualizarFuncionario = (key: string, campo: keyof Omit<FuncionarioBorrador, 'key'>, valor: string) => {
    setFuncionarios((prev) => prev.map((f) => (f.key === key ? { ...f, [campo]: campo === 'rut' ? formatearRut(valor) : valor } : f)))
  }

  const etiquetaTipo = tipo === 'subida' ? 'Subida' : 'Bajada'

  const guardar = async () => {
    setError(null)

    if (fecha < CALENDARIO_INICIO || fecha > CALENDARIO_FIN) {
      return setError(`La fecha debe estar entre ${CALENDARIO_INICIO} y ${CALENDARIO_FIN}.`)
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
      const evento = await db.crearEventoTransito({ tipo, fecha, creado_por: usuario.id })

      const trabajadoresCreados = funcionarios.length
        ? await db.agregarTrabajadoresEventoTransito(
            funcionarios.map((f) => ({
              evento_id: evento.id,
              nombre: f.nombre.trim(),
              apellido: f.apellido.trim(),
              rut: f.rut,
              cargo: f.cargo.trim(),
            }))
          )
        : []

      onCreado({ ...evento, trabajadores: trabajadoresCreados } as EventoTransito)
    } catch (err) {
      setError(traducirError(err, `No se pudo crear la ${etiquetaTipo.toLowerCase()}`))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white rounded-lg shadow-xl z-50 p-6 max-h-[85vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-bold text-slate-900 mb-1">Agregar {etiquetaTipo}</Dialog.Title>
          <p className="text-xs text-slate-500 mb-4">
            Un día suelto de {etiquetaTipo.toLowerCase()}, independiente de cualquier turno — no repite ningún ciclo.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Fecha</label>
              <input
                type="date"
                min={CALENDARIO_INICIO}
                max={CALENDARIO_FIN}
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">Funcionarios</label>
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
                <p className="text-xs text-slate-400">
                  Puedes crear la {etiquetaTipo.toLowerCase()} sin funcionarios y agregarlos después, o incluirlos ahora.
                </p>
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
                {guardando ? 'Creando…' : `Crear ${etiquetaTipo.toLowerCase()}`}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
