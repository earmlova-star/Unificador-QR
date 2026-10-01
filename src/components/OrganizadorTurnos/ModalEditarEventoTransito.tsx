import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { ConfiguracionViaje, EventoTransito, Usuario } from '@/types/index'
import { CALENDARIO_INICIO, CALENDARIO_FIN } from './lib/rangoFechas'

interface ModalEditarEventoTransitoProps {
  // Grupo completo (ver agruparEventos.ts) — todas sus fechas comparten
  // tipo y trabajadores, así que se editan juntas.
  eventos: EventoTransito[]
  configuraciones: ConfiguracionViaje[]
  usuario: Usuario
  onCerrar: () => void
  onGuardado: (resultado: { actualizados: EventoTransito[]; creados: EventoTransito[]; eliminadosIds: string[] }) => void
}

// Edita un grupo de Subidas/Bajadas sueltas — pedido explícito
// 2026-10-02: "que se puedan editar al igual que los turnos
// predefinidos" (ver ModalEditarTurno.tsx). A diferencia de un turno, un
// evento suelto no tiene patrón/nombre/color — lo editable acá es la
// lista de fechas (como la fecha_inicio de un turno, pero puede ser más
// de una) y la Configuración de viaje asignada. Los trabajadores del
// grupo se gestionan aparte (enlace "N trabajadores" de la fila, mismo
// ModalTrabajadores que usan los turnos) para no duplicar esa lógica acá.
export const ModalEditarEventoTransito = ({ eventos, configuraciones, usuario, onCerrar, onGuardado }: ModalEditarEventoTransitoProps) => {
  const tipo = eventos[0].tipo
  const etiquetaTipo = tipo === 'subida' ? 'Subida' : 'Bajada'
  const trabajadores = eventos[0].trabajadores
  const fechasOriginales = eventos.map((e) => e.fecha)
  const configuracionOriginal = eventos[0].configuracion_id ?? ''

  const [fechas, setFechas] = useState<string[]>(fechasOriginales)
  const [fechaNueva, setFechaNueva] = useState(CALENDARIO_INICIO)
  const [configuracionId, setConfiguracionId] = useState(configuracionOriginal)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const agregarFecha = () => {
    setError(null)
    if (fechaNueva < CALENDARIO_INICIO || fechaNueva > CALENDARIO_FIN) {
      return setError(`La fecha debe estar entre ${CALENDARIO_INICIO} y ${CALENDARIO_FIN}.`)
    }
    if (fechas.includes(fechaNueva)) return setError('Esa fecha ya está en la lista.')
    setFechas((prev) => [...prev, fechaNueva].sort())
  }

  const quitarFecha = (fecha: string) => {
    setFechas((prev) => prev.filter((f) => f !== fecha))
  }

  const guardar = async () => {
    setError(null)
    if (fechas.length === 0) return setError('Debe quedar al menos una fecha.')

    const idPorFecha = new Map(eventos.map((e) => [e.fecha, e.id]))
    const fechasAEliminar = fechasOriginales.filter((f) => !fechas.includes(f))
    const fechasNuevas = fechas.filter((f) => !fechasOriginales.includes(f))
    const fechasQueQuedan = fechasOriginales.filter((f) => fechas.includes(f))
    const configuracionCambio = configuracionId !== configuracionOriginal

    setGuardando(true)
    try {
      const eliminadosIds = fechasAEliminar.map((f) => idPorFecha.get(f)!)
      if (eliminadosIds.length > 0) await db.eliminarEventosTransito(eliminadosIds)

      let creados: EventoTransito[] = []
      if (fechasNuevas.length > 0) {
        creados = (await db.crearEventosTransitoMultiples({
          tipo,
          fechas: fechasNuevas,
          configuracion_id: configuracionId || null,
          trabajadores: trabajadores.map((t) => ({ nombre: t.nombre, apellido: t.apellido, rut: t.rut, cargo: t.cargo })),
          creado_por: usuario.id,
        })) as EventoTransito[]
      }

      let actualizados: EventoTransito[] = []
      const idsQueQuedan = fechasQueQuedan.map((f) => idPorFecha.get(f)!)
      if (idsQueQuedan.length > 0 && configuracionCambio) {
        await db.actualizarConfiguracionEventosTransito(idsQueQuedan, configuracionId || null)
        actualizados = eventos.filter((e) => idsQueQuedan.includes(e.id)).map((e) => ({ ...e, configuracion_id: configuracionId || null }))
      }

      onGuardado({ actualizados, creados, eliminadosIds })
    } catch (err) {
      setError(traducirError(err, 'No se pudo guardar la edición'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white rounded-lg shadow-xl z-50 p-6 max-h-[85vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-bold text-slate-900 mb-1">Editar {etiquetaTipo} suelta</Dialog.Title>
          <p className="text-xs text-slate-500 mb-4">
            {trabajadores.length} {trabajadores.length === 1 ? 'funcionario' : 'funcionarios'} — para agregar, editar o eliminar
            funcionarios, usa el enlace "trabajadores" de la fila.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
                Fecha{fechas.length > 0 ? `s (${fechas.length})` : ''}
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  min={CALENDARIO_INICIO}
                  max={CALENDARIO_FIN}
                  value={fechaNueva}
                  onChange={(e) => setFechaNueva(e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={agregarFecha}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-md"
                >
                  + Agregar
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {fechas.map((f) => (
                  <span
                    key={f}
                    className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"
                  >
                    {f}
                    <button
                      type="button"
                      onClick={() => quitarFecha(f)}
                      aria-label={`Quitar fecha ${f}`}
                      className="text-blue-400 hover:text-blue-700 leading-none"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Configuración de viaje</label>
              <select
                value={configuracionId}
                onChange={(e) => setConfiguracionId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              >
                <option value="">Sin asignar (Origen/Destino genérico)</option>
                {configuraciones
                  .filter((c) => c.tipo === tipo)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.hora} — {c.origen} → {c.destino}
                    </option>
                  ))}
              </select>
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
