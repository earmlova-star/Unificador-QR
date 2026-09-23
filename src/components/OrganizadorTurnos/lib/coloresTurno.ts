export interface TemaColorTurno {
  id: string
  etiqueta: string
  tema: {
    subida: string
    turno: string
    bajada: string
    descanso: string
  }
}

export const TEMAS_COLOR: TemaColorTurno[] = [
  { id: 'amber', etiqueta: 'Ámbar', tema: { subida: 'bg-amber-800 text-white', turno: 'bg-amber-400 text-amber-950', bajada: 'bg-amber-800 text-white', descanso: 'bg-slate-200 text-slate-700' } },
  { id: 'blue', etiqueta: 'Azul', tema: { subida: 'bg-blue-800 text-white', turno: 'bg-blue-400 text-blue-950', bajada: 'bg-blue-800 text-white', descanso: 'bg-slate-200 text-slate-700' } },
  { id: 'emerald', etiqueta: 'Esmeralda', tema: { subida: 'bg-emerald-800 text-white', turno: 'bg-emerald-400 text-emerald-950', bajada: 'bg-emerald-800 text-white', descanso: 'bg-slate-200 text-slate-700' } },
  { id: 'purple', etiqueta: 'Púrpura', tema: { subida: 'bg-purple-800 text-white', turno: 'bg-purple-400 text-purple-950', bajada: 'bg-purple-800 text-white', descanso: 'bg-slate-200 text-slate-700' } },
  { id: 'indigo', etiqueta: 'Índigo', tema: { subida: 'bg-indigo-800 text-white', turno: 'bg-indigo-400 text-indigo-950', bajada: 'bg-indigo-800 text-white', descanso: 'bg-slate-200 text-slate-700' } },
  { id: 'rose', etiqueta: 'Rosa', tema: { subida: 'bg-rose-800 text-white', turno: 'bg-rose-400 text-rose-950', bajada: 'bg-rose-800 text-white', descanso: 'bg-slate-200 text-slate-700' } },
  { id: 'teal', etiqueta: 'Verde azulado', tema: { subida: 'bg-teal-800 text-white', turno: 'bg-teal-400 text-teal-950', bajada: 'bg-teal-800 text-white', descanso: 'bg-slate-200 text-slate-700' } },
  { id: 'cyan', etiqueta: 'Cian', tema: { subida: 'bg-cyan-800 text-white', turno: 'bg-cyan-400 text-cyan-950', bajada: 'bg-cyan-800 text-white', descanso: 'bg-slate-200 text-slate-700' } },
]

export function siguienteTema(cantidadUsada: number): TemaColorTurno {
  return TEMAS_COLOR[cantidadUsada % TEMAS_COLOR.length]
}

export function temaPorId(id: string): TemaColorTurno {
  return TEMAS_COLOR.find((t) => t.id === id) ?? TEMAS_COLOR[0]
}
