import { describe, it, expect } from 'vitest'
import { agruparEventosTransito } from './agruparEventos'
import { EventoTransito } from '@/types/index'

const trabajador = (rut: string) => ({
  id: `t-${rut}`,
  evento_id: 'e1',
  nombre: 'Nombre',
  apellido: 'Apellido',
  rut,
  cargo: 'Cargo',
  created_at: '2026-09-25T00:00:00Z',
})

const evento = (overrides: Partial<EventoTransito> & { ruts: string[] }): EventoTransito => ({
  id: overrides.id ?? `e-${overrides.fecha}-${overrides.tipo}`,
  tipo: overrides.tipo ?? 'subida',
  fecha: overrides.fecha!,
  configuracion_id: overrides.configuracion_id ?? null,
  creado_por: 'u1',
  created_at: '2026-09-25T00:00:00Z',
  updated_at: '2026-09-25T00:00:00Z',
  trabajadores: overrides.ruts.map(trabajador),
})

describe('agruparEventosTransito', () => {
  it('agrupa eventos del mismo tipo que comparten exactamente el mismo conjunto de RUTs', () => {
    const eventos = [
      evento({ fecha: '2026-10-06', tipo: 'subida', ruts: ['11.111.111-1', '22.222.222-2'] }),
      evento({ fecha: '2026-10-07', tipo: 'subida', ruts: ['11.111.111-1', '22.222.222-2'] }),
      evento({ fecha: '2026-10-08', tipo: 'subida', ruts: ['11.111.111-1', '22.222.222-2'] }),
    ]
    const grupos = agruparEventosTransito(eventos)
    expect(grupos).toHaveLength(1)
    expect(grupos[0].eventos.map((e) => e.fecha)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08'])
  })

  it('el orden de los RUTs dentro de un evento no importa para agrupar', () => {
    const eventos = [
      evento({ fecha: '2026-10-06', ruts: ['11.111.111-1', '22.222.222-2'] }),
      evento({ fecha: '2026-10-07', ruts: ['22.222.222-2', '11.111.111-1'] }), // mismo conjunto, otro orden
    ]
    expect(agruparEventosTransito(eventos)).toHaveLength(1)
  })

  it('NO agrupa subida con bajada aunque compartan los mismos trabajadores', () => {
    const eventos = [
      evento({ fecha: '2026-10-06', tipo: 'subida', ruts: ['11.111.111-1'] }),
      evento({ fecha: '2026-10-06', tipo: 'bajada', ruts: ['11.111.111-1'] }),
    ]
    const grupos = agruparEventosTransito(eventos)
    expect(grupos).toHaveLength(2)
  })

  it('NO agrupa eventos con conjuntos de trabajadores distintos, aunque se superpongan', () => {
    const eventos = [
      evento({ fecha: '2026-10-06', ruts: ['11.111.111-1', '22.222.222-2'] }),
      evento({ fecha: '2026-10-07', ruts: ['11.111.111-1', '33.333.333-3'] }), // uno en común, no es el mismo grupo
    ]
    expect(agruparEventosTransito(eventos)).toHaveLength(2)
  })

  it('un evento sin trabajadores forma su propio grupo (clave vacía, pero sigue siendo una fila)', () => {
    const eventos = [evento({ fecha: '2026-10-06', ruts: [] })]
    const grupos = agruparEventosTransito(eventos)
    expect(grupos).toHaveLength(1)
    expect(grupos[0].trabajadores).toEqual([])
  })

  it('los grupos quedan ordenados por la fecha de su evento más antiguo', () => {
    const eventos = [
      evento({ fecha: '2026-10-10', ruts: ['99.999.999-9'] }),
      evento({ fecha: '2026-10-05', ruts: ['11.111.111-1'] }),
    ]
    const grupos = agruparEventosTransito(eventos)
    expect(grupos.map((g) => g.eventos[0].fecha)).toEqual(['2026-10-05', '2026-10-10'])
  })
})
