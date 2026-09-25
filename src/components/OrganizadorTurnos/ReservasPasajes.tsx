import { useEffect, useMemo, useState } from 'react'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { ConfiguracionViaje, CuadrillaTurno, EventoTransito, ReservaPasaje, Usuario } from '@/types/index'
import { generarLineaTiempoCuadrilla } from './lib/motorTurnos'
import { UBICACION_TERMINAL, UBICACION_FAENA, origenDestino } from './lib/ubicaciones'

interface ReservasPasajesProps {
  cuadrillas: CuadrillaTurno[]
  eventosTransito: EventoTransito[]
  configuraciones: ConfiguracionViaje[]
  inicioVentanaFecha: Date
  diasVentana: number
  usuario: Usuario
}

// Forma mínima que necesita esta pantalla de una persona que viaja — la
// cumplen tanto TrabajadorCuadrilla como EventoTransitoTrabajador
// (estructuralmente, sin necesidad de convertir nada).
interface PersonaViaje {
  id: string
  nombre: string
  apellido: string
  rut: string
  cargo: string
}

interface Candidato {
  clave: string
  trabajador: PersonaViaje
  cuadrillaNombre: string
  fecha: string
  tipo: 'subida' | 'bajada'
  // ConfiguracionViaje asignada al turno para esta dirección (ver
  // CuadrillaTurno.config_subida_id/config_bajada_id) — null si el turno
  // no tiene ninguna asignada, o si el candidato no viene de un turno
  // (Subida/Bajada suelta). Pedido explícito 2026-09-25.
  configuracionId: string | null
}

function claveCandidato(trabajadorId: string, fecha: string, tipo: 'subida' | 'bajada') {
  return `${trabajadorId}|${fecha}|${tipo}`
}

// Candidatos = quién sube/baja y cuándo. La mayoría sale del motor de
// turnos (no se guarda en la base) — cada trabajador de una cuadrilla
// comparte la misma fecha de subida/bajada que su cuadrilla, y la misma
// ConfiguracionViaje asignada a su turno (si tiene una). A eso se suman
// las Subidas/Bajadas sueltas (EventoTransito, pedido explícito
// 2026-09-24): un día fijo, independiente de cualquier cuadrilla, con su
// propia lista de trabajadores — filtradas a la ventana visible igual que
// hace el motor de turnos con las suyas. No pertenecen a ningún turno,
// pero sí pueden tener su propia ConfiguracionViaje asignada directamente
// (evento.configuracion_id, elegida al crearlas — pedido explícito
// 2026-09-25), a diferencia de heredarla de un turno.
function calcularCandidatos(cuadrillas: CuadrillaTurno[], eventosTransito: EventoTransito[], inicioVentana: Date, dias: number): Candidato[] {
  const candidatos: Candidato[] = []
  for (const cuadrilla of cuadrillas) {
    if (cuadrilla.trabajadores.length === 0) continue
    const segmentos = generarLineaTiempoCuadrilla(cuadrilla, inicioVentana, dias)
    for (const seg of segmentos) {
      if (seg.tipo !== 'SUBIDA' && seg.tipo !== 'BAJADA') continue
      const tipo: 'subida' | 'bajada' = seg.tipo === 'SUBIDA' ? 'subida' : 'bajada'
      const configuracionId = (tipo === 'subida' ? cuadrilla.config_subida_id : cuadrilla.config_bajada_id) ?? null
      for (const trabajador of cuadrilla.trabajadores) {
        candidatos.push({
          clave: claveCandidato(trabajador.id, seg.fecha, tipo),
          trabajador,
          cuadrillaNombre: cuadrilla.nombre,
          fecha: seg.fecha,
          tipo,
          configuracionId,
        })
      }
    }
  }

  const fechaDesdeStr = inicioVentana.toISOString().split('T')[0]
  const fechaHastaVentana = new Date(inicioVentana)
  fechaHastaVentana.setDate(fechaHastaVentana.getDate() + dias - 1)
  const fechaHastaStr = fechaHastaVentana.toISOString().split('T')[0]

  for (const evento of eventosTransito) {
    if (evento.fecha < fechaDesdeStr || evento.fecha > fechaHastaStr) continue
    for (const trabajador of evento.trabajadores) {
      candidatos.push({
        clave: claveCandidato(trabajador.id, evento.fecha, evento.tipo),
        trabajador,
        cuadrillaNombre: evento.tipo === 'subida' ? 'Subida suelta' : 'Bajada suelta',
        fecha: evento.fecha,
        tipo: evento.tipo,
        configuracionId: evento.configuracion_id ?? null,
      })
    }
  }

  return candidatos
}

// Resuelve el viaje efectivo de un candidato: si tiene una
// ConfiguracionViaje asignada (por su turno), usa su Origen/Destino/Hora;
// si no, cae al Origen/Destino genérico de siempre (Terminal ↔ Faena),
// sin hora sugerida.
function resolverViaje(
  tipo: 'subida' | 'bajada',
  configuracionId: string | null,
  configuraciones: ConfiguracionViaje[],
  terminal: string,
  faena: string
): { origen: string; destino: string; horaSugerida: string | null } {
  const config = configuracionId ? configuraciones.find((c) => c.id === configuracionId) : undefined
  if (config) return { origen: config.origen, destino: config.destino, horaSugerida: config.hora }
  const { origen, destino } = origenDestino(tipo, terminal, faena)
  return { origen, destino, horaSugerida: null }
}

export const ReservasPasajes = ({ cuadrillas, eventosTransito, configuraciones, inicioVentanaFecha, diasVentana, usuario }: ReservasPasajesProps) => {
  const [reservas, setReservas] = useState<ReservaPasaje[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [terminal, setTerminal] = useState(UBICACION_TERMINAL)
  const [faena, setFaena] = useState(UBICACION_FAENA)

  const fechaDesde = useMemo(() => inicioVentanaFecha.toISOString().split('T')[0], [inicioVentanaFecha])
  const fechaHasta = useMemo(() => {
    const d = new Date(inicioVentanaFecha)
    d.setDate(d.getDate() + diasVentana - 1)
    return d.toISOString().split('T')[0]
  }, [inicioVentanaFecha, diasVentana])

  const cargar = async () => {
    setCargando(true)
    setError(null)
    try {
      const data = await db.obtenerReservasPasaje(fechaDesde, fechaHasta)
      setReservas(data as ReservaPasaje[])
    } catch (err) {
      setError(traducirError(err, 'No se pudieron cargar las reservas'))
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaDesde, fechaHasta])

  const candidatos = useMemo(
    () => calcularCandidatos(cuadrillas, eventosTransito, inicioVentanaFecha, diasVentana),
    [cuadrillas, eventosTransito, inicioVentanaFecha, diasVentana]
  )

  const reservaDe = (c: Candidato) => reservas.find((r) => r.trabajador_id === c.trabajador.id && r.fecha === c.fecha && r.tipo === c.tipo)

  const guardar = async (
    c: Candidato,
    cambios: Partial<
      Pick<ReservaPasaje, 'horario' | 'confirmada' | 'confirmada_por' | 'confirmada_en' | 'encargado_reserva' | 'fecha_reserva' | 'observaciones'>
    >
  ) => {
    const existente = reservaDe(c)
    // Si el turno de este candidato tiene una ConfiguracionViaje asignada
    // para esta dirección, su Origen/Destino/Hora son el default al
    // guardar la reserva por primera vez (ver resolverViaje) — si no,
    // cae al Origen/Destino genérico de siempre.
    const { origen, destino, horaSugerida } = resolverViaje(c.tipo, c.configuracionId, configuraciones, terminal, faena)
    setError(null)
    try {
      const guardada = await db.guardarReservaPasaje({
        trabajador_id: c.trabajador.id,
        fecha: c.fecha,
        tipo: c.tipo,
        origen: existente?.origen ?? origen,
        destino: existente?.destino ?? destino,
        horario: existente?.horario ?? horaSugerida ?? null,
        confirmada: existente?.confirmada ?? false,
        confirmada_por: existente?.confirmada_por ?? null,
        confirmada_en: existente?.confirmada_en ?? null,
        encargado_reserva: existente?.encargado_reserva ?? null,
        fecha_reserva: existente?.fecha_reserva ?? null,
        observaciones: existente?.observaciones ?? null,
        creado_por: existente?.creado_por ?? usuario.id,
        ...cambios,
      })
      setReservas((prev) => {
        const idx = prev.findIndex((r) => r.id === guardada.id)
        if (idx === -1) return [...prev, guardada as ReservaPasaje]
        const copia = [...prev]
        copia[idx] = guardada as ReservaPasaje
        return copia
      })
    } catch (err) {
      setError(traducirError(err, 'No se pudo guardar la reserva'))
    }
  }

  // Clave de agrupamiento de un candidato: su Fecha de Reserva si ya tiene
  // una asignada, o su fecha de viaje (subida/bajada) mientras no la tenga
  // — pedido explícito 2026-09-25: la pantalla se organiza por Fecha de
  // Reserva (la de la "cinta" del encabezado), no por fecha de viaje. Ver
  // porFecha más abajo.
  const claveGrupoDe = (c: Candidato) => reservaDe(c)?.fecha_reserva ?? c.fecha

  // Encargado y Fecha de Reserva se editan una sola vez por grupo (en el
  // encabezado), no por trabajador — pedido explícito 2026-09-24. Se
  // aplican a TODOS los candidatos de ESE grupo (suben + bajan, sin
  // importar su fecha de viaje real) en paralelo, reusando el mismo
  // guardar() de cada fila. Cambiar la Fecha de Reserva del grupo los
  // reagrupa solos en el siguiente render (porFecha se recalcula desde
  // `reservas`), no hace falta moverlos a mano.
  const candidatosDeGrupo = (claveGrupo: string) => candidatos.filter((c) => claveGrupoDe(c) === claveGrupo)

  const valorGrupoFecha = (claveGrupo: string, campo: 'encargado_reserva' | 'fecha_reserva'): string => {
    const conValor = candidatosDeGrupo(claveGrupo)
      .map(reservaDe)
      .find((r) => r && r[campo])
    return conValor?.[campo] ?? ''
  }

  const guardarGrupoFecha = (claveGrupo: string, cambios: Partial<Pick<ReservaPasaje, 'encargado_reserva' | 'fecha_reserva'>>) =>
    Promise.all(candidatosDeGrupo(claveGrupo).map((c) => guardar(c, cambios)))

  const alternarConfirmada = (c: Candidato) => {
    const confirmadaActual = reservaDe(c)?.confirmada ?? false
    const nueva = !confirmadaActual
    guardar(c, {
      confirmada: nueva,
      confirmada_por: nueva ? usuario.id : null,
      confirmada_en: nueva ? new Date().toISOString() : null,
    })
  }

  // Agrupa por Fecha de Reserva (con fallback a la fecha de viaje — ver
  // claveGrupoDe), y dentro de cada grupo por tipo (mismo orden que la
  // planilla de referencia: subida y bajada como sub-bloques separados).
  // Como la clave depende de `reservas` (de ahí sale la Fecha de Reserva
  // ya guardada de cada candidato), hay que recalcular también cuando
  // cambia, no solo cuando cambian los candidatos.
  const porFecha = useMemo(() => {
    const mapa = new Map<string, { subida: Candidato[]; bajada: Candidato[] }>()
    for (const c of candidatos) {
      const claveGrupo = claveGrupoDe(c)
      if (!mapa.has(claveGrupo)) mapa.set(claveGrupo, { subida: [], bajada: [] })
      mapa.get(claveGrupo)![c.tipo].push(c)
    }
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidatos, reservas])

  const formatearFecha = (fechaISO: string) =>
    new Date(`${fechaISO}T00:00:00`).toLocaleDateString('es-CL', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase()

  const formatearFechaCorta = (fechaISO: string) =>
    new Date(`${fechaISO}T00:00:00`).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })

  const renderGrupo = (c: Candidato) => {
    const reserva = reservaDe(c)
    const { origen, destino, horaSugerida } = resolverViaje(c.tipo, c.configuracionId, configuraciones, terminal, faena)
    return (
      <tr key={c.clave} className={reserva?.confirmada ? 'bg-green-50/40' : ''}>
        <td className="px-3 py-1.5 text-slate-800 whitespace-nowrap">{c.trabajador.nombre} {c.trabajador.apellido}</td>
        <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{c.trabajador.rut}</td>
        <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{c.cuadrillaNombre}</td>
        <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap" title={`Fecha de viaje: ${c.fecha}`}>{formatearFechaCorta(c.fecha)}</td>
        <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{reserva?.origen ?? origen} → {reserva?.destino ?? destino}</td>
        <td className="px-3 py-1.5">
          <input
            type="text"
            defaultValue={reserva?.horario ?? horaSugerida ?? ''}
            placeholder="17:00"
            onBlur={(e) => { if (e.target.value !== (reserva?.horario ?? '')) guardar(c, { horario: e.target.value || null }) }}
            className="w-20 px-2 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600"
          />
        </td>
        <td className="px-3 py-1.5">
          <input
            type="text"
            defaultValue={reserva?.observaciones ?? ''}
            placeholder="—"
            onBlur={(e) => { if (e.target.value !== (reserva?.observaciones ?? '')) guardar(c, { observaciones: e.target.value || null }) }}
            className="w-40 px-2 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600"
          />
        </td>
        <td className="px-3 py-1.5 text-center">
          <input type="checkbox" checked={reserva?.confirmada ?? false} onChange={() => alternarConfirmada(c)} className="w-4 h-4" />
        </td>
      </tr>
    )
  }

  const tablaCabecera = (
    <thead>
      <tr className="text-slate-400 uppercase text-[10px] border-b border-slate-200">
        <th className="text-left font-semibold px-3 pb-1">Trabajador</th>
        <th className="text-left font-semibold px-3 pb-1">RUT</th>
        <th className="text-left font-semibold px-3 pb-1">Turno</th>
        <th className="text-left font-semibold px-3 pb-1">Viaje</th>
        <th className="text-left font-semibold px-3 pb-1">Origen → Destino</th>
        <th className="text-left font-semibold px-3 pb-1">Horario</th>
        <th className="text-left font-semibold px-3 pb-1">Observaciones</th>
        <th className="text-center font-semibold px-3 pb-1">Confirmada</th>
      </tr>
    </thead>
  )

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 px-4 sm:px-6 py-3 bg-slate-50 border-b border-slate-200">
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Terminal</label>
          <input
            type="text"
            value={terminal}
            onChange={(e) => setTerminal(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600"
          />
        </div>
        <span className="text-slate-400 pb-1.5">↔</span>
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Faena</label>
          <input
            type="text"
            value={faena}
            onChange={(e) => setFaena(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600"
          />
        </div>
        <p className="text-[11px] text-slate-400 pb-1.5">
          Origen/Destino de las reservas nuevas de esta sesión — las ya guardadas no cambian solas.
        </p>
      </div>

      {error && <p className="text-sm text-red-700 bg-red-50 border-b border-red-200 px-4 sm:px-6 py-3">{error}</p>}

      {cargando ? (
        <p className="text-sm text-slate-500 py-12 text-center">Cargando…</p>
      ) : porFecha.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-slate-500">No hay subidas ni bajadas programadas en este rango de fechas.</p>
          <p className="text-xs text-slate-400 mt-1">Crea turnos con fecha de inicio en este rango, o navega a otro rango con "Anterior" / "Siguiente".</p>
        </div>
      ) : (
        <div className="px-4 sm:px-6 py-4 space-y-6 overflow-x-auto">
          {porFecha.map(([claveGrupo, grupos]) => (
            <div key={claveGrupo} className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-100 px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="text-xs font-bold text-slate-700">{formatearFecha(claveGrupo)}</p>
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase">Encargado</label>
                  <input
                    type="text"
                    defaultValue={valorGrupoFecha(claveGrupo, 'encargado_reserva')}
                    placeholder="—"
                    onBlur={(e) => {
                      if (e.target.value !== valorGrupoFecha(claveGrupo, 'encargado_reserva'))
                        guardarGrupoFecha(claveGrupo, { encargado_reserva: e.target.value || null })
                    }}
                    className="w-40 px-2 py-1 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase" title="Cambiarla mueve a todo este grupo junto a la fecha nueva">Fecha de reserva</label>
                  <input
                    type="date"
                    defaultValue={valorGrupoFecha(claveGrupo, 'fecha_reserva')}
                    onBlur={(e) => {
                      if (e.target.value !== valorGrupoFecha(claveGrupo, 'fecha_reserva'))
                        guardarGrupoFecha(claveGrupo, { fecha_reserva: e.target.value || null })
                    }}
                    className="px-2 py-1 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              {grupos.subida.length > 0 && (
                <div className="px-3 py-2 border-b border-slate-100 last:border-b-0">
                  <p className="text-[10px] font-semibold text-emerald-700 uppercase mb-1">▲ Suben ({grupos.subida.length})</p>
                  <table className="min-w-full text-xs">
                    {tablaCabecera}
                    <tbody className="divide-y divide-slate-100">{grupos.subida.map(renderGrupo)}</tbody>
                  </table>
                </div>
              )}

              {grupos.bajada.length > 0 && (
                <div className="px-3 py-2">
                  <p className="text-[10px] font-semibold text-amber-700 uppercase mb-1">▼ Bajan ({grupos.bajada.length})</p>
                  <table className="min-w-full text-xs">
                    {tablaCabecera}
                    <tbody className="divide-y divide-slate-100">{grupos.bajada.map(renderGrupo)}</tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
