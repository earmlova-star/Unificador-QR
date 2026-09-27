import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { Camioneta, DocumentoVencimiento, Usuario } from '@/types/index'

export interface FuncionarioOption {
  id: string
  nombre: string
  apellido: string
  rut: string
}

interface ModalAgregarVencimientoProps {
  usuario: Usuario
  funcionarios: FuncionarioOption[]
  camionetas: Camioneta[]
  onCerrar: () => void
  onCreado: (documento: DocumentoVencimiento) => void
}

type TipoEntidad = 'funcionario' | 'camioneta'

export const ModalAgregarVencimiento = ({ usuario, funcionarios, camionetas, onCerrar, onCreado }: ModalAgregarVencimientoProps) => {
  const [tipo, setTipo] = useState<TipoEntidad>('funcionario')
  const [entidadId, setEntidadId] = useState('')
  const [nombreDocumento, setNombreDocumento] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cambiarTipo = (nuevoTipo: TipoEntidad) => {
    setTipo(nuevoTipo)
    setEntidadId('')
  }

  const guardar = async () => {
    setError(null)
    if (!entidadId) {
      return setError(tipo === 'funcionario' ? 'Selecciona un funcionario.' : 'Selecciona una camioneta.')
    }
    if (!nombreDocumento.trim()) {
      return setError('El nombre del documento es obligatorio.')
    }
    if (!fechaVencimiento) {
      return setError('La fecha de vencimiento es obligatoria.')
    }

    setGuardando(true)
    try {
      const documento = await db.crearDocumentoVencimiento({
        funcionario_id: tipo === 'funcionario' ? entidadId : null,
        camioneta_id: tipo === 'camioneta' ? entidadId : null,
        nombre_documento: nombreDocumento.trim(),
        fecha_vencimiento: fechaVencimiento,
        creado_por: usuario.id,
      })
      onCreado(documento as DocumentoVencimiento)
    } catch (err) {
      setError(traducirError(err, 'No se pudo agregar el vencimiento'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-lg shadow-xl z-50 p-6">
          <Dialog.Title className="text-lg font-bold text-slate-900 mb-4">Agregar vencimiento</Dialog.Title>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Tipo</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => cambiarTipo('funcionario')}
                  className={`flex-1 px-3 py-2 rounded-md text-sm font-medium border ${
                    tipo === 'funcionario' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  Funcionario
                </button>
                <button
                  type="button"
                  onClick={() => cambiarTipo('camioneta')}
                  className={`flex-1 px-3 py-2 rounded-md text-sm font-medium border ${
                    tipo === 'camioneta' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  Camioneta
                </button>
              </div>
            </div>

            {tipo === 'funcionario' ? (
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Funcionario</label>
                <select
                  value={entidadId}
                  onChange={(e) => setEntidadId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                >
                  <option value="">Selecciona…</option>
                  {funcionarios.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nombre} {f.apellido} — {f.rut}
                    </option>
                  ))}
                </select>
                {funcionarios.length === 0 && (
                  <p className="text-xs text-slate-400 mt-1">
                    No hay funcionarios cargados todavía — agrégalos primero en Organizador de Turnos.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Camioneta</label>
                <select
                  value={entidadId}
                  onChange={(e) => setEntidadId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                >
                  <option value="">Selecciona…</option>
                  {camionetas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.patente}
                      {c.modelo ? ` — ${c.modelo}` : ''}
                    </option>
                  ))}
                </select>
                {camionetas.length === 0 && <p className="text-xs text-slate-400 mt-1">No hay camionetas cargadas todavía.</p>}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Documento</label>
              <input
                type="text"
                placeholder="Ej: Licencia de conducir, SOAP, Revisión técnica…"
                value={nombreDocumento}
                onChange={(e) => setNombreDocumento(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Fecha de vencimiento</label>
              <input
                type="date"
                value={fechaVencimiento}
                onChange={(e) => setFechaVencimiento(e.target.value)}
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
                {guardando ? 'Creando…' : 'Crear vencimiento'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
