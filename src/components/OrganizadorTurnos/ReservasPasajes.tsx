import { useEffect, useMemo, useState } from 'react'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { CuadrillaTurno, ReservaPasaje, TrabajadorCuadrilla, Usuario } from '@/types/index'
import { generarLineaTiempoCuadrilla } from './lib/motorTurnos'
import { UBICACION_TERMINAL, UBICACION_FAENA, origenDestino } from './lib/ubicaciones'

interface ReservasPasajesProps {
  cuadrillas: CuadrillaTurno[]
  inicioVentanaFecha: Date
  diasVentana: number
  usuario: Usuario
}

interface Candidato {
  clave: string
  trabajador: TrabajadorCuadrilla
  cuadrillaNombre: string
  fecha: string
  tipo: 'subida' | 'bajada'
}

function claveCandidato(trabajadorId: string, fecha: string, tipo: 'subida' | 'bajada') {
  return `${trabajadorId}|${fecha}|${tipo}`
}

// Candidatos = quién sube/baja y cuándo, calculado desde el motor de
// turnos (no se guarda en la base). Cada trabajador de una cuadrilla
// comparte la misma fecha de subida/bajada que su cuadrilla.
function calcularCandidatos(cuadrillas: CuadrillaTurno[], inicioVentana: Date, dias: number): Candidato[] {
  const candidatos: Candidato[] = []
  for (const cuadrilla of cuadrillas) {
    if (cuadrilla.trabajadores.length === 0) continue
    const segmentos = generarLineaTiempoCuadrilla(cuadrilla, inicioVentana, dias)
    for (const seg of segmentos) {
      if (seg.tipo !== 'SUBIDA' && seg.tipo !== 'BAJADA') continue
      const tipo: 'subida' | 'bajada' = seg.tipo === 'SUBIDA' ? 'subida' : 'bajada'
      for (const trabajador of cuadrilla.trabajadores) {
        candidatos.push({
          clave: claveCandidato(trabajador.id, seg.fecha, tipo),
          trabajador,
          cuadrillaNombre: cuadrilla.nombre,
          fecha: seg.fecha,
          tipo,
        })
      }
    }
  }
  return candidatos
}

export const ReservasPasajes = ({ cuadrillas, inicioVentanaFecha, diasVentana, usuario }: ReservasPasajesProps) => {
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
    () => calcularCandidatos(cuadrillas, inicioVentanaFecha, diasVentana),
    [cuadrillas, inicioVentanaFecha, diasVentana]
  )

  const reservaDe = (c: Candidato) => reservas.find((r) => r.trabajador_id === c.trabajador.id && r.fecha === c.fecha && r.tipo === c.tipo)

  const guardar = async (
    c: Candidato,
    cambios: Partial<Pick<ReservaPasaje, 'horario' | 'confirmada' | 'confirmada_por' | 'confirmada_en' | 'encargado_reserva' | 'observaciones'>>
  ) => {
    const existente = reservaDe(c)
    const { origen, destino } = origenDestino(c.tipo, terminal, faena)
    setError(null)
    try {
      const guardada = await db.guardarReservaPasaje({
        trabajador_id: c.trabajador.id,
        fecha: c.fecha,
        tipo: c.tipo,
        origen: existente?.origen ?? origen,
        destino: existente?.destino ?? destino,
        horario: existente?.horario ?? null,
        confirmada: existente?.confirmada ?? false,
        confirmada_por: existente?.confirmada_por ?? null,
        confirmada_en: existente?.confirmada_en ?? null,
        encargado_reserva: existente?.encargado_reserva ?? null,
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

  const alternarConfirmada = (c: Candidato) => {
    const confirmadaActual = reservaDe(c)?.confirmada ?? false
    const nueva = !confirmadaActual
    guardar(c, {
      confirmada: nueva,
      confirmada_por: nueva ? usuario.id : null,
      confirmada_en: nueva ? new Date().toISOString() : null,
    })
  }

  // Agrupa por fecha, y dentro de cada fecha por tipo (mismo orden que la
  // planilla de referencia: subida y bajada como sub-bloques separados).
  const porFecha = useMemo(() => {
    const mapa = new Map<string, { subida: Candidato[]; bajada: Candidato[] }>()
    for (const c of candidatos) {
      if (!mapa.has(c.fecha)) mapa.set(c.fecha, { subida: [], bajada: [] })
      mapa.get(c.fecha)![c.tipo].push(c)
    }
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [candidatos])

  const formatearFecha = (fechaISO: string) =>
    new Date(`${fechaISO}T00:00:00`).toLocaleDateString('es-CL', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase()

  const renderGrupo = (c: Candidato) => {
    const reserva = reservaDe(c)
    const { origen, destino } = origenDestino(c.tipo, terminal, faena)
    return (
      <tr key={c.clave} className={reserva?.confirmada ? 'bg-green-50/40' : ''}>
        <td className="px-3 py-1.5 text-slate-800 whitespace-nowrap">{c.trabajador.nombre} {c.trabajador.apellido}</td>
        <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{c.trabajador.rut}</td>
        <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{c.cuadrillaNombre}</td>
        <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{reserva?.origen ?? origen} → {reserva?.destino ?? destino}</td>
        <td className="px-3 py-1.5">
          <input
            type="text"
            defaultValue={reserva?.horario ?? ''}
            placeholder="17:00"
            onBlur={(e) => { if (e.target.value !== (reserva?.horario ?? '')) guardar(c, { horario: e.target.value || null }) }}
            className="w-20 px-2 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600"
          />
        </td>
        <td className="px-3 py-1.5">
          <input
            type="text"
            defaultValue={reserva?.encargado_reserva ?? ''}
            placeholder="—"
            onBlur={(e) => { if (e.target.value !== (reserva?.encargado_reserva ?? '')) guardar(c, { encargado_reserva: e.target.value || null }) }}
            className="w-32 px-2 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600"
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
        <th className="text-left font-semibold px-3 pb-1">Origen → Destino</th>
        <th className="text-left font-semibold px-3 pb-1">Horario</th>
        <th className="text-left font-semibold px-3 pb-1">Encargado</th>
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
          {porFecha.map(([fecha, grupos]) => (
            <div key={fecha} className="border border-slate-200 rounded-lg overflow-hidden">
              <p className="bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{formatearFecha(fecha)}</p>

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
