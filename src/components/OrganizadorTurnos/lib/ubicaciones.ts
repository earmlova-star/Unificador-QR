// Origen/Destino fijos para Reservas de Pasajes — pedido explícito: un
// solo par para toda la operación, no configurable por cuadrilla. Subida
// va de Terminal a Faena; Bajada es el viaje inverso.
export const UBICACION_TERMINAL = 'Terminal Borja'
export const UBICACION_FAENA = 'Pérez Caldera'

// La subida de las 17:00 no llega directo a la faena, sino al hotel donde
// duermen esa noche — pedido explícito 2026-09-25. La de las 05:30 (y
// cualquier otro horario, incluido "todavía sin horario") sigue yendo
// directo a la faena, igual que antes. Bajada no cambia: siempre
// Faena → Terminal.
const HORARIO_SUBIDA_A_HOTEL = '17:00'
const NOMBRE_HOTEL = 'Hotel Plaza'

export function origenDestino(tipo: 'subida' | 'bajada', terminal: string, faena: string, horario?: string | null) {
  if (tipo === 'bajada') return { origen: faena, destino: terminal }
  const destino = horario?.trim() === HORARIO_SUBIDA_A_HOTEL ? `${faena} - ${NOMBRE_HOTEL}` : faena
  return { origen: terminal, destino }
}
