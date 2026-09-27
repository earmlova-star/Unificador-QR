import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { DocumentoVencimiento, Usuario } from '@/types/index'

interface ModalEditarFechaVencimientoProps {
  documento: DocumentoVencimiento
  etiquetaSujeto: string
  usuario: Usuario
  onCerrar: () => void
  onActualizado: (documento: DocumentoVencimiento) => void
}

// Cambiar la fecha de un vencimiento borra su observación automáticamente
// (trigger en la base, ver add_observacion_documentos_vencimiento.sql) —
// una nota vieja ("trámite en curso, vence el 2/9") deja de tener sentido
// si la fecha ya cambió a otro mes. Quién hizo el cambio se guarda
// explícito desde acá (mismo patrón que comentarComoMandante en
// partes_diarios — ver add_auditoria_documentos_vencimiento.sql).
export const ModalEditarFechaVencimiento = ({ documento, etiquetaSujeto, usuario, onCerrar, onActualizado }: ModalEditarFechaVencimientoProps) => {
  const [fecha, setFecha] = useState(documento.fecha_vencimiento.slice(0, 10))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const guardar = async () => {
    setError(null)
    if (!fecha) return setError('La fecha de vencimiento es obligatoria.')

    setGuardando(true)
    try {
      const actualizado = await db.actualizarDocumentoVencimiento(documento.id, {
        fecha_vencimiento: fecha,
        vencimiento_actualizado_autor: usuario.nombre,
        vencimiento_actualizado_por: usuario.id,
        vencimiento_actualizado_en: new Date().toISOString(),
      })
      onActualizado(actualizado as DocumentoVencimiento)
    } catch (err) {
      setError(traducirError(err, 'No se pudo actualizar la fecha de vencimiento'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-white rounded-lg shadow-xl z-50 p-6">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-lg font-bold text-slate-900">Editar vencimiento</Dialog.Title>
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              👤 {usuario.nombre}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 mb-4">
            {etiquetaSujeto} — {documento.nombre_documento}
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Nueva fecha</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              />
            </div>

            {documento.observacion && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Nota: al actualizar la fecha, la observación registrada se elimina automáticamente.
              </p>
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
                onClick={guardar}
                disabled={guardando}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                {guardando ? 'Actualizando…' : 'Actualizar'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
