// Origen/Destino genéricos para Reservas de Pasajes — se usan cuando el
// turno de la reserva no tiene una ConfiguracionViaje propia asignada
// (ver config_subida_id/config_bajada_id en CuadrillaTurno). Subida va de
// Terminal a Faena; Bajada es el viaje inverso.
//
// Hasta el 2026-09-25 esta función tenía además una regla fija (subida
// 17:00 → hotel); se sacó de acá porque pasó a ser una ConfiguracionViaje
// más, asignable por turno — ver ModalConfiguracionesViaje.tsx.
export const UBICACION_TERMINAL = 'Terminal Borja'
export const UBICACION_FAENA = 'Pérez Caldera'

export function origenDestino(tipo: 'subida' | 'bajada', terminal: string, faena: string) {
  return tipo === 'subida' ? { origen: terminal, destino: faena } : { origen: faena, destino: terminal }
}
