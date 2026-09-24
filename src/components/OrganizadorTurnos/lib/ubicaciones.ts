// Origen/Destino fijos para Reservas de Pasajes — pedido explícito: un
// solo par para toda la operación, no configurable por cuadrilla. Subida
// va de Terminal a Faena; Bajada es el viaje inverso.
export const UBICACION_TERMINAL = 'Terminal Borja'
export const UBICACION_FAENA = 'Pérez Caldera'

export function origenDestino(tipo: 'subida' | 'bajada', terminal: string, faena: string) {
  return tipo === 'subida' ? { origen: terminal, destino: faena } : { origen: faena, destino: terminal }
}
