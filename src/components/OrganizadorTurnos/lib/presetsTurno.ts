export interface PatronTurno {
  id: string
  nombre: string
  diasTrabajo: number
  diasDescanso: number
  incluyeSubida: boolean
}

export const PRESETS_TURNO: PatronTurno[] = [
  { id: 'p14', nombre: '14x14', diasTrabajo: 14, diasDescanso: 14, incluyeSubida: true },
  { id: 'p7', nombre: '7x7', diasTrabajo: 7, diasDescanso: 7, incluyeSubida: true },
  { id: 'p4', nombre: '4x3', diasTrabajo: 4, diasDescanso: 3, incluyeSubida: true },
]
