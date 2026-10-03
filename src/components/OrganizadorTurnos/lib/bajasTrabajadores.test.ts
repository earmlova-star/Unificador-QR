import { describe, it, expect } from 'vitest'
import { contarVigentes, fechaCorta, fechaLocalISO, trabajadorActivoEn } from './bajasTrabajadores'

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

describe('contarVigentes', () => {
  it('no cuenta a nadie con baja registrada, sea cual sea su fecha (pasada, de hoy o futura)', () => {
    const equipo = [{}, { fecha_baja: null }, { fecha_baja: '2000-01-01' }, { fecha_baja: '2026-10-03' }, { fecha_baja: '2099-12-31' }]
    expect(contarVigentes(equipo)).toBe(2)
  })

  it('al dar de baja a alguien el turno pasa a tener uno menos, aunque el último día sea hoy', () => {
    const antes = [{ fecha_baja: null }, { fecha_baja: null }, { fecha_baja: null }]
    const despues = [{ fecha_baja: null }, { fecha_baja: null }, { fecha_baja: '2026-10-03' }]
    expect(contarVigentes(antes)).toBe(3)
    expect(contarVigentes(despues)).toBe(2)
  })

  it('un equipo vacío tiene 0', () => {
    expect(contarVigentes([])).toBe(0)
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

describe('fechaCorta', () => {
  it('muestra la fecha como DD-MM-YYYY', () => {
    expect(fechaCorta('2026-10-03')).toBe('03-10-2026')
    expect(fechaCorta('2027-01-31')).toBe('31-01-2027')
  })

  it('devuelve tal cual lo que no es una fecha ISO', () => {
    expect(fechaCorta('')).toBe('')
    expect(fechaCorta('hoy')).toBe('hoy')
  })
})
