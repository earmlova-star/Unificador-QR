import { EventoTransito } from '@/types/index'

// Agrupa Subidas/Bajadas sueltas (eventos_transito) para que la carta
// Gantt las muestre como una sola fila por grupo en vez de una fila por
// fecha — pedido explícito 2026-10-02: "unificar las subidas y bajadas
// sueltas que se creen de diferentes maneras... que en el día se vean
// unificadas". Cada evento_transito sigue siendo su propia fila en la
// base (fecha + copia propia de trabajadores, ver
// add_crear_eventos_transito_multiples_rpc.sql) — esto solo los agrupa
// para pintar la carta, no cambia nada en la base.
//
// Criterio de agrupamiento: mismo tipo (subida/bajada) + mismo conjunto
// de RUTs entre sus trabajadores, sin importar en qué momento ni de qué
// forma se creó cada evento (uno por uno, en lote con fechas múltiples,
// en sesiones distintas) — el RUT es lo único estable entre copias
// independientes de trabajadores de eventos distintos. Se recalcula en
// cada render a partir de `eventosTransito` (no se persiste ningún
// "grupo" en la base), así que si los trabajadores de un evento cambian,
// se reagrupa solo.
export interface GrupoEventoTransito {
  clave: string
  tipo: 'subida' | 'bajada'
  // Trabajadores "representativos" del grupo — por construcción, todos
  // los eventos del grupo tienen el mismo conjunto de RUTs, así que basta
  // mostrar los del primero (más antiguo) para la fila.
  trabajadores: EventoTransito['trabajadores']
  // Eventos del grupo, ordenados por fecha ascendente — eventos[0] es el
  // que usan las acciones "representativas" de la fila (ver trabajadores
  // y +👤 en OrganizadorTurnos.tsx).
  eventos: EventoTransito[]
}

function claveDeTrabajadores(trabajadores: EventoTransito['trabajadores']): string {
  return [...trabajadores.map((t) => t.rut)].sort().join('|')
}

export function agruparEventosTransito(eventosTransito: EventoTransito[]): GrupoEventoTransito[] {
  const mapa = new Map<string, GrupoEventoTransito>()

  for (const evento of eventosTransito) {
    const clave = `${evento.tipo}::${claveDeTrabajadores(evento.trabajadores)}`
    if (!mapa.has(clave)) {
      mapa.set(clave, { clave, tipo: evento.tipo, trabajadores: evento.trabajadores, eventos: [] })
    }
    mapa.get(clave)!.eventos.push(evento)
  }

  const grupos = [...mapa.values()]
  for (const grupo of grupos) {
    grupo.eventos.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))
    grupo.trabajadores = grupo.eventos[0].trabajadores
  }
  grupos.sort((a, b) => {
    const fa = a.eventos[0].fecha
    const fb = b.eventos[0].fecha
    return fa < fb ? -1 : fa > fb ? 1 : 0
  })

  return grupos
}
