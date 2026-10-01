export interface PatronTurno {
  id: string
  nombre: string
  diasTrabajo: number
  diasDescanso: number
  incluyeSubida: boolean
  // Traslado diario (pedido explícito 2026-10-02, turno 5x2): sube y baja
  // CADA día de trabajo en vez de una sola vez por bloque — ver
  // patron_traslado_diario en CuadrillaTurno y SegmentoTurno.tipo
  // 'SUBIDA_BAJADA' en motorTurnos.ts. Opcional porque solo 5x2 lo usa.
  trasladoDiario?: boolean
}

export const PRESETS_TURNO: PatronTurno[] = [
  { id: 'p14', nombre: '14x14', diasTrabajo: 14, diasDescanso: 14, incluyeSubida: true },
  { id: 'p7', nombre: '7x7', diasTrabajo: 7, diasDescanso: 7, incluyeSubida: true },
  { id: 'p4', nombre: '4x3', diasTrabajo: 4, diasDescanso: 3, incluyeSubida: true },
  { id: 'p5', nombre: '5x2', diasTrabajo: 5, diasDescanso: 2, incluyeSubida: true, trasladoDiario: true },
]
