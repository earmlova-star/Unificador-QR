import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { DocumentoVencimiento } from '@/types/index'

interface ModalObservacionVencimientoProps {
  documento: DocumentoVencimiento
  etiquetaSujeto: string
  onCerrar: () => void
  onActualizado: (documento: DocumentoVencimiento) => void
}

// Vale tanto para funcionarios como para camionetas — el registro ya trae
// resuelto a cuál de los dos pertenece (documento.funcionario_id /
// camioneta_id), acá solo se edita el texto.
export const ModalObservacionVencimiento = ({ documento, etiquetaSujeto, onCerrar, onActualizado }: ModalObservacionVencimientoProps) => {
  const [observacion, setObservacion] = useState(documento.observacion ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const guardar = async () => {
    setError(null)
    setGuardando(true)
    try {
      const actualizado = await db.actualizarDocumentoVencimiento(documento.id, { observacion: observacion.trim() || null })
      onActualizado(actualizado as DocumentoVencimiento)
    } catch (err) {
      setError(traducirError(err, 'No se pudo guardar la observación'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-white rounded-lg shadow-xl z-50 p-6">
          <Dialog.Title className="text-lg font-bold text-slate-900">Agregar observación</Dialog.Title>
          <p className="text-xs text-slate-500 mt-0.5 mb-4">
            {etiquetaSujeto} — {documento.nombre_documento}
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Detalle</label>
              <textarea
                value={observacion}
                onChange={(e) => setObservacion(e.target.value)}
                rows={3}
                placeholder="Ej: Licencia en trámite de renovación en la municipalidad…"
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
                {guardando ? 'Guardando…' : 'Guardar nota'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
