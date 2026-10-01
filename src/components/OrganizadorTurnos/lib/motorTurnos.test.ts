import { describe, it, expect } from 'vitest'
import { generarLineaTiempoCuadrilla } from './motorTurnos'
import { CuadrillaTurno } from '@/types/index'

const cuadrilla = (overrides: Partial<CuadrillaTurno>): CuadrillaTurno => ({
  id: 'c1',
  nombre: 'Cuadrilla test',
  patron_dias_trabajo: 7,
  patron_dias_descanso: 7,
  patron_incluye_subida: true,
  patron_traslado_diario: false,
  fecha_inicio: '2026-09-28',
  color_tema: 'amber',
  orden: 0,
  config_subida_id: null,
  config_bajada_id: null,
  creado_por: 'u1',
  created_at: '2026-09-25T00:00:00Z',
  updated_at: '2026-09-25T00:00:00Z',
  trabajadores: [],
  ...overrides,
})

const tipos = (cuadrilla: CuadrillaTurno, dias: number) =>
  generarLineaTiempoCuadrilla(cuadrilla, new Date(`${cuadrilla.fecha_inicio}T00:00:00`), dias).map((s) => s.tipo)

describe('generarLineaTiempoCuadrilla — turnos normales (sin cambios)', () => {
  it('7x7 sigue con un solo tránsito de subida y uno de bajada por ciclo', () => {
    // fecha_inicio = 2026-09-28 (lunes), ventana arranca ahí mismo —
    // diffDias=-1 nunca ocurre, así que la subida sale del "esDiaTransito"
    // del ciclo anterior (no visible acá, ventana empieza en Día 1).
    const c = cuadrilla({ patron_dias_trabajo: 7, patron_dias_descanso: 7 })
    expect(tipos(c, 15)).toEqual([
      'TURNO', 'TURNO', 'TURNO', 'TURNO', 'TURNO', 'TURNO', 'BAJADA', // Día 1..7
      'DESCANSO', 'DESCANSO', 'DESCANSO', 'DESCANSO', 'DESCANSO', 'DESCANSO', 'SUBIDA', // descanso 1..6, día 7 = subida del próximo ciclo
      'TURNO', // Día 1 del ciclo siguiente
    ])
  })

  it('el día antes de fecha_inicio es Subida si incluye_subida, o SIN_INICIO si no', () => {
    // tipos() usa fecha_inicio como arranque de la ventana, así que acá hay
    // que llamar generarLineaTiempoCuadrilla directo con una ventana que
    // empiece un día ANTES de fecha_inicio para ver ese caso.
    const unDiaAntes = new Date('2026-09-25T00:00:00')

    const conSubida = cuadrilla({ fecha_inicio: '2026-09-26', patron_incluye_subida: true })
    const segsCon = generarLineaTiempoCuadrilla(conSubida, unDiaAntes, 2)
    expect(segsCon[0].tipo).toBe('SUBIDA')
    expect(segsCon[1].tipo).toBe('TURNO')

    const sinSubida = cuadrilla({ fecha_inicio: '2026-09-26', patron_incluye_subida: false })
    const segsSin = generarLineaTiempoCuadrilla(sinSubida, unDiaAntes, 2)
    expect(segsSin[0].tipo).toBe('SIN_INICIO')
    expect(segsSin[1].tipo).toBe('TURNO')
  })
})

describe('generarLineaTiempoCuadrilla — traslado diario (turno 5x2, pedido explícito 2026-10-02)', () => {
  it('cada día de trabajo es SUBIDA_BAJADA, sin "día antes" ni última-día-distinto', () => {
    const c = cuadrilla({ patron_dias_trabajo: 5, patron_dias_descanso: 2, patron_traslado_diario: true })
    expect(tipos(c, 7)).toEqual([
      'SUBIDA_BAJADA', 'SUBIDA_BAJADA', 'SUBIDA_BAJADA', 'SUBIDA_BAJADA', 'SUBIDA_BAJADA', // lunes..viernes
      'DESCANSO', 'DESCANSO', // sábado, domingo
    ])
  })

  it('se repite igual en el ciclo siguiente', () => {
    const c = cuadrilla({ patron_dias_trabajo: 5, patron_dias_descanso: 2, patron_traslado_diario: true })
    expect(tipos(c, 14).slice(7)).toEqual([
      'SUBIDA_BAJADA', 'SUBIDA_BAJADA', 'SUBIDA_BAJADA', 'SUBIDA_BAJADA', 'SUBIDA_BAJADA',
      'DESCANSO', 'DESCANSO',
    ])
  })

  it('las fechas antes de fecha_inicio quedan SIN_INICIO — no hay "día antes" especial en traslado diario', () => {
    const c = cuadrilla({ fecha_inicio: '2026-09-28', patron_dias_trabajo: 5, patron_dias_descanso: 2, patron_traslado_diario: true })
    const segs = generarLineaTiempoCuadrilla(c, new Date('2026-09-27T00:00:00'), 2)
    expect(segs[0].tipo).toBe('SIN_INICIO')
    expect(segs[1].tipo).toBe('SUBIDA_BAJADA')
  })

  it('ignora patron_incluye_subida — el traslado diario manda', () => {
    const c = cuadrilla({ patron_dias_trabajo: 5, patron_dias_descanso: 2, patron_traslado_diario: true, patron_incluye_subida: false })
    expect(tipos(c, 5)).toEqual(['SUBIDA_BAJADA', 'SUBIDA_BAJADA', 'SUBIDA_BAJADA', 'SUBIDA_BAJADA', 'SUBIDA_BAJADA'])
  })
})
