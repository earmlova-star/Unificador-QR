import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { ConfiguracionViaje, Usuario } from '@/types/index'

interface ModalConfiguracionesViajeProps {
  configuraciones: ConfiguracionViaje[]
  usuario: Usuario
  onCerrar: () => void
  onCreada: (config: ConfiguracionViaje) => void
  onActualizada: (config: ConfiguracionViaje) => void
  onEliminada: (id: string) => void
}

// Administra las ConfiguracionViaje (presets reusables de Origen/Destino/
// Hora para Reservas de Pasajes) — crear y borrar acá; la asignación a
// cada turno se hace en ModalEditarTurno.tsx (config_subida_id /
// config_bajada_id), no en este modal.
export const ModalConfiguracionesViaje = ({ configuraciones, usuario, onCerrar, onCreada, onActualizada, onEliminada }: ModalConfiguracionesViajeProps) => {
  const [tipo, setTipo] = useState<'subida' | 'bajada'>('subida')
  const [origen, setOrigen] = useState('')
  const [destino, setDestino] = useState('')
  const [hora, setHora] = useState('')
  // Horario al que hay que reservar en Webcontrol — pedido explícito
  // 2026-10-02, distinto de `hora` (el horario real de viaje). Se guarda
  // como texto libre (no "time"): en Webcontrol puede anotarse con
  // minutos, AM/PM, etc. según cómo lo maneje cada coordinador.
  const [horarioWebcontrol, setHorarioWebcontrol] = useState('')
  // Nombre del grupo Webcontrol (ej. "Turno H") — pedido explícito
  // 2026-10-02: varias configuraciones (subida y bajada de un mismo
  // turno operativo) comparten el mismo nombre para agruparse juntas en
  // el nivel más externo de Reservas de Pasajes.
  const [grupoWebcontrol, setGrupoWebcontrol] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [eliminandoId, setEliminandoId] = useState<string | null>(null)
  const [guardandoWebcontrolId, setGuardandoWebcontrolId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const subidas = configuraciones.filter((c) => c.tipo === 'subida')
  const bajadas = configuraciones.filter((c) => c.tipo === 'bajada')

  const crear = async () => {
    setError(null)
    if (!origen.trim() || !destino.trim()) return setError('Completa origen y destino.')
    if (!hora) return setError('Completa la hora.')

    setGuardando(true)
    try {
      const config = await db.crearConfiguracionViaje({
        tipo,
        origen: origen.trim(),
        destino: destino.trim(),
        hora,
        horario_reserva_webcontrol: horarioWebcontrol.trim() || null,
        grupo_webcontrol: grupoWebcontrol.trim() || null,
        creado_por: usuario.id,
      })
      onCreada(config as ConfiguracionViaje)
      setOrigen('')
      setDestino('')
      setHora('')
      setHorarioWebcontrol('')
      setGrupoWebcontrol('')
    } catch (err) {
      setError(traducirError(err, 'No se pudo crear la configuración'))
    } finally {
      setGuardando(false)
    }
  }

  const guardarHorarioWebcontrol = async (config: ConfiguracionViaje, valor: string) => {
    if (valor === (config.horario_reserva_webcontrol ?? '')) return
    setError(null)
    setGuardandoWebcontrolId(config.id)
    try {
      const actualizada = await db.actualizarConfiguracionViaje(config.id, { horario_reserva_webcontrol: valor || null })
      onActualizada(actualizada as ConfiguracionViaje)
    } catch (err) {
      setError(traducirError(err, 'No se pudo guardar el horario de reserva Webcontrol'))
    } finally {
      setGuardandoWebcontrolId(null)
    }
  }

  const guardarGrupoWebcontrol = async (config: ConfiguracionViaje, valor: string) => {
    if (valor === (config.grupo_webcontrol ?? '')) return
    setError(null)
    setGuardandoWebcontrolId(config.id)
    try {
      const actualizada = await db.actualizarConfiguracionViaje(config.id, { grupo_webcontrol: valor || null })
      onActualizada(actualizada as ConfiguracionViaje)
    } catch (err) {
      setError(traducirError(err, 'No se pudo guardar el grupo Webcontrol'))
    } finally {
      setGuardandoWebcontrolId(null)
    }
  }

  const eliminar = async (config: ConfiguracionViaje) => {
    const ok = window.confirm(
      `¿Eliminar la configuración "${config.hora} — ${config.origen} → ${config.destino}"? Los turnos que la tengan asignada quedan sin configuración (vuelven al Origen/Destino genérico).`
    )
    if (!ok) return
    setError(null)
    setEliminandoId(config.id)
    try {
      await db.eliminarConfiguracionViaje(config.id)
      onEliminada(config.id)
    } catch (err) {
      setError(traducirError(err, 'No se pudo eliminar la configuración'))
    } finally {
      setEliminandoId(null)
    }
  }

  const listaConfig = (lista: ConfiguracionViaje[], vacioTexto: string) =>
    lista.length === 0 ? (
      <p className="text-xs text-slate-400">{vacioTexto}</p>
    ) : (
      <div className="space-y-1.5">
        {lista.map((c) => (
          <div key={c.id} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-slate-700 min-w-0">
                <span className="font-semibold">{c.hora}</span> — <span className="truncate">{c.origen} → {c.destino}</span>
              </div>
              <button
                type="button"
                onClick={() => eliminar(c)}
                disabled={eliminandoId === c.id}
                title="Eliminar configuración"
                className="text-red-600 hover:text-red-700 text-xs flex-shrink-0 disabled:opacity-50"
              >
                🗑
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-slate-500 flex-shrink-0">Horario Reserva Webcontrol</label>
              <input
                type="text"
                defaultValue={c.horario_reserva_webcontrol ?? ''}
                placeholder="—"
                disabled={guardandoWebcontrolId === c.id}
                onBlur={(e) => guardarHorarioWebcontrol(c, e.target.value)}
                className="flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-blue-600 disabled:opacity-50"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-slate-500 flex-shrink-0" title="Varias configuraciones con el mismo nombre se agrupan juntas en el nivel más externo de Reservas de Pasajes">
                Grupo Webcontrol
              </label>
              <input
                type="text"
                defaultValue={c.grupo_webcontrol ?? ''}
                placeholder="Turno H"
                disabled={guardandoWebcontrolId === c.id}
                onBlur={(e) => guardarGrupoWebcontrol(c, e.target.value)}
                className="flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-blue-600 disabled:opacity-50"
              />
            </div>
          </div>
        ))}
      </div>
    )

  return (
    <Dialog.Root open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white rounded-lg shadow-xl z-50 p-6 max-h-[85vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-bold text-slate-900 mb-1">Configuraciones de Viaje</Dialog.Title>
          <p className="text-xs text-slate-500 mb-4">
            Presets de Origen/Destino/Hora para Reservas de Pasajes. Una vez creadas, se asignan a cada turno (uno para su
            subida, otro para su bajada) desde "Editar turno".
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">▲ Subidas</label>
              {listaConfig(subidas, 'Sin configuraciones de subida todavía.')}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">▼ Bajadas</label>
              {listaConfig(bajadas, 'Sin configuraciones de bajada todavía.')}
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
              <span className="text-xs font-semibold text-blue-800 uppercase">+ Agregar configuración</span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Tipo</label>
                  <select
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value as 'subida' | 'bajada')}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-blue-600"
                  >
                    <option value="subida">Subida</option>
                    <option value="bajada">Bajada</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Hora</label>
                  <input
                    type="time"
                    value={hora}
                    onChange={(e) => setHora(e.target.value)}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Origen</label>
                  <input
                    type="text"
                    value={origen}
                    onChange={(e) => setOrigen(e.target.value)}
                    placeholder="Terminal Borja"
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Destino</label>
                  <input
                    type="text"
                    value={destino}
                    onChange={(e) => setDestino(e.target.value)}
                    placeholder="Pérez Caldera - Hotel Plaza"
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Horario Reserva Webcontrol</label>
                  <input
                    type="text"
                    value={horarioWebcontrol}
                    onChange={(e) => setHorarioWebcontrol(e.target.value)}
                    placeholder="11:00"
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Grupo Webcontrol</label>
                  <input
                    type="text"
                    value={grupoWebcontrol}
                    onChange={(e) => setGrupoWebcontrol(e.target.value)}
                    placeholder="Turno H"
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={crear}
                  disabled={guardando}
                  className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                >
                  {guardando ? 'Creando…' : '+ Agregar configuración'}
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex justify-end pt-2 border-t border-slate-200">
              <Dialog.Close asChild>
                <button type="button" className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">
                  Cerrar
                </button>
              </Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
