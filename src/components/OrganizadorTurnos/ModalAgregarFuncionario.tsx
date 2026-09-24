import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { CuadrillaTurno, TrabajadorCuadrilla } from '@/types/index'
import { validarRut, formatearRut } from './lib/rut'
import { parsearTrabajadoresMasivo } from './lib/parseoMasivo'

interface ModalAgregarFuncionarioProps {
  cuadrillas: CuadrillaTurno[]
  cuadrillaIdInicial?: string
  onCerrar: () => void
  onAgregados: (cuadrillaId: string, trabajadores: TrabajadorCuadrilla[]) => void
}

const EJEMPLO_MASIVO = 'Juan Pérez González\t12.345.678-9\tCapataz\nMaría López Soto\t9.876.543-2\tSoldador'

export const ModalAgregarFuncionario = ({ cuadrillas, cuadrillaIdInicial, onCerrar, onAgregados }: ModalAgregarFuncionarioProps) => {
  const [modo, setModo] = useState<'uno' | 'masivo'>('uno')
  const [cuadrillaId, setCuadrillaId] = useState(cuadrillaIdInicial ?? cuadrillas[0]?.id ?? '')
  const [nombre, setNombre] = useState('')
  const [apellido, setApellido] = useState('')
  const [rut, setRut] = useState('')
  const [cargo, setCargo] = useState('')
  const [textoMasivo, setTextoMasivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { validos: masivoValidos, errores: masivoErrores } = parsearTrabajadoresMasivo(textoMasivo)

  const guardarUno = async () => {
    setError(null)
    if (!cuadrillaId) return setError('Debes seleccionar un turno.')
    if (!nombre.trim() || !apellido.trim() || !cargo.trim()) return setError('Completa nombre, apellido y cargo.')
    if (!validarRut(rut)) return setError('RUT inválido. Formato esperado XX.XXX.XXX-X.')

    setGuardando(true)
    try {
      const trabajador = await db.agregarTrabajadorCuadrilla({
        cuadrilla_id: cuadrillaId,
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        rut,
        cargo: cargo.trim(),
      })
      onAgregados(cuadrillaId, [trabajador as TrabajadorCuadrilla])
    } catch (err) {
      setError(traducirError(err, 'No se pudo agregar el funcionario'))
    } finally {
      setGuardando(false)
    }
  }

  const guardarMasivo = async () => {
    setError(null)
    if (!cuadrillaId) return setError('Debes seleccionar un turno.')
    if (masivoValidos.length === 0) return setError('Pega al menos una línea válida.')
    if (masivoErrores.length > 0) return setError(`Hay ${masivoErrores.length} línea(s) con error — corrígelas antes de agregar (ver detalle abajo).`)

    setGuardando(true)
    try {
      const trabajadores = await db.agregarTrabajadoresCuadrilla(
        masivoValidos.map((t) => ({ cuadrilla_id: cuadrillaId, ...t }))
      )
      onAgregados(cuadrillaId, trabajadores as TrabajadorCuadrilla[])
    } catch (err) {
      setError(traducirError(err, 'No se pudieron agregar los funcionarios'))
    } finally {
      setGuardando(false)
    }
  }

  if (cuadrillas.length === 0) {
    return (
      <Dialog.Root open onOpenChange={(abierto) => !abierto && onCerrar()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-white rounded-lg shadow-xl z-50 p-6 text-center">
            <Dialog.Title className="text-lg font-bold text-slate-900 mb-2">Agregar Funcionario</Dialog.Title>
            <p className="text-sm text-slate-500 mb-4">Primero debes crear al menos un turno antes de agregar funcionarios.</p>
            <Dialog.Close asChild>
              <button type="button" className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700">
                Entendido
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    )
  }

  return (
    <Dialog.Root open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white rounded-lg shadow-xl z-50 p-6 max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-bold text-slate-900">Agregar Funcionario</Dialog.Title>
            <div className="flex bg-slate-100 rounded-lg p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setModo('uno')}
                className={`px-3 py-1 rounded-md transition-colors ${modo === 'uno' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
              >
                Uno por uno
              </button>
              <button
                type="button"
                onClick={() => setModo('masivo')}
                className={`px-3 py-1 rounded-md transition-colors ${modo === 'masivo' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
              >
                ⚡ Masivo
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Turno / cuadrilla</label>
              <select
                value={cuadrillaId}
                onChange={(e) => setCuadrillaId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              >
                {cuadrillas.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>

            {modo === 'uno' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Nombre</label>
                    <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Apellido</label>
                    <input type="text" value={apellido} onChange={(e) => setApellido(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-500 mb-1">RUT</label>
                  <input type="text" placeholder="12.345.678-9" value={rut} onChange={(e) => setRut(formatearRut(e.target.value))} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600" />
                </div>

                <div>
                  <label className="block text-xs text-slate-500 mb-1">Cargo</label>
                  <input type="text" value={cargo} onChange={(e) => setCargo(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600" />
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs text-slate-500">Una persona por línea: Nombre completo, RUT, Cargo</label>
                    <button type="button" onClick={() => setTextoMasivo(EJEMPLO_MASIVO)} className="text-[11px] text-blue-600 hover:underline">
                      Ver ejemplo
                    </button>
                  </div>
                  <textarea
                    value={textoMasivo}
                    onChange={(e) => setTextoMasivo(e.target.value)}
                    rows={8}
                    placeholder={'Pega directamente desde Excel (3 columnas: Nombre completo, RUT, Cargo)…\n\n' + EJEMPLO_MASIVO}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs font-mono focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 resize-y"
                  />
                </div>

                {textoMasivo.trim() && (
                  <div className="text-xs space-y-1">
                    {masivoValidos.length > 0 && (
                      <p className="text-green-700">✓ {masivoValidos.length} funcionario(s) listos para agregar.</p>
                    )}
                    {masivoErrores.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-0.5">
                        {masivoErrores.map((e) => (
                          <p key={e.linea} className="text-red-700">Línea {e.linea}: {e.mensaje}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <Dialog.Close asChild>
                <button type="button" className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">
                  Cancelar
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={modo === 'uno' ? guardarUno : guardarMasivo}
                disabled={guardando || (modo === 'masivo' && (masivoValidos.length === 0 || masivoErrores.length > 0))}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                {guardando
                  ? 'Agregando…'
                  : modo === 'masivo' && masivoValidos.length > 0
                  ? `Agregar ${masivoValidos.length} funcionario(s)`
                  : 'Agregar'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
