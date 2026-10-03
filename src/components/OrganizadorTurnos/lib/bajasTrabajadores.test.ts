import { describe, it, expect } from 'vitest'
import { contarActivos, fechaLocalISO, trabajadorActivoEn } from './bajasTrabajadores'

describe('trabajadorActivoEn', () => {
  it('sin baja está activo en cualquier fecha', () => {
    expect(trabajadorActivoEn({}, '2026-10-05')).toBe(true)
    expect(trabajadorActivoEn({ fecha_baja: null }, '2030-01-01')).toBe(true)
    expect(trabajadorActivoEn({ fecha_baja: undefined }, '2020-01-01')).toBe(true)
  })

  it('con baja está activo hasta la fecha de baja INCLUSIVE, y no después', () => {
    const t = { fecha_baja: '2026-10-07' }
    expect(trabajadorActivoEn(t, '2026-10-05')).toBe(true)
    expect(trabajadorActivoEn(t, '2026-10-07')).toBe(true) // último día en el turno
    expect(trabajadorActivoEn(t, '2026-10-08')).toBe(false)
    expect(trabajadorActivoEn(t, '2027-01-01')).toBe(false)
  })

  it('compara bien entre meses y años (strings YYYY-MM-DD)', () => {
    const t = { fecha_baja: '2026-10-07' }
    expect(trabajadorActivoEn(t, '2026-09-30')).toBe(true)
    expect(trabajadorActivoEn(t, '2025-12-31')).toBe(true)
    expect(trabajadorActivoEn(t, '2026-11-01')).toBe(false)
  })
})

describe('contarActivos', () => {
  const equipo = [{}, { fecha_baja: '2026-10-07' }, { fecha_baja: '2026-10-01' }, { fecha_baja: null }]

  it('cuenta solo a los que siguen activos ese día', () => {
    expect(contarActivos(equipo, '2026-10-03')).toBe(3) // la baja del 01 ya no cuenta
    expect(contarActivos(equipo, '2026-10-07')).toBe(3) // el del 07 aún cuenta ese día
    expect(contarActivos(equipo, '2026-10-08')).toBe(2)
  })

  it('un equipo vacío tiene 0 activos', () => {
    expect(contarActivos([], '2026-10-03')).toBe(0)
  })
})

describe('fechaLocalISO', () => {
  it('formatea con ceros a la izquierda, en hora local', () => {
    expect(fechaLocalISO(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(fechaLocalISO(new Date(2026, 9, 3))).toBe('2026-10-03')
  })

  it('a las 23:30 locales sigue siendo el mismo día (no salta a mañana por UTC)', () => {
    expect(fechaLocalISO(new Date(2026, 9, 3, 23, 30))).toBe('2026-10-03')
  })
})
