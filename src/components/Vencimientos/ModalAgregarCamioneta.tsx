import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { Camioneta, Usuario } from '@/types/index'
import { formatearPatente, validarPatente } from './lib/patente'

interface ModalAgregarCamionetaProps {
  usuario: Usuario
  onCerrar: () => void
  onCreada: (camioneta: Camioneta) => void
}

export const ModalAgregarCamioneta = ({ usuario, onCerrar, onCreada }: ModalAgregarCamionetaProps) => {
  const [patente, setPatente] = useState('')
  const [modelo, setModelo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const guardar = async () => {
    setError(null)
    if (!validarPatente(patente)) {
      return setError('Patente inválida. Formato esperado AAAA00 (4 letras + 2 números).')
    }

    setGuardando(true)
    try {
      const camioneta = await db.crearCamioneta({ patente, modelo: modelo.trim() || null, creado_por: usuario.id })
      onCreada(camioneta as Camioneta)
    } catch (err) {
      setError(traducirError(err, 'No se pudo agregar la camioneta'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-white rounded-lg shadow-xl z-50 p-6">
          <Dialog.Title className="text-lg font-bold text-slate-900 mb-4">Agregar camioneta</Dialog.Title>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Patente</label>
              <input
                type="text"
                placeholder="AAAA00"
                value={patente}
                onChange={(e) => setPatente(formatearPatente(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Modelo (opcional)</label>
              <input
                type="text"
                value={modelo}
                onChange={(e) => setModelo(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              />
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
                {guardando ? 'Creando…' : 'Crear camioneta'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
