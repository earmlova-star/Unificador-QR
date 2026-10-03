import { describe, it, expect } from 'vitest'
import { formatearNumeroReporte } from './numeroReporte'

describe('formatearNumeroReporte', () => {
  it('rellena con ceros hasta 3 dígitos', () => {
    expect(formatearNumeroReporte(7)).toBe('007')
    expect(formatearNumeroReporte(43)).toBe('043')
    expect(formatearNumeroReporte(120)).toBe('120')
  })

  it('devuelve null para un borrador sin número todavía', () => {
    expect(formatearNumeroReporte(null)).toBeNull()
    expect(formatearNumeroReporte(undefined)).toBeNull()
  })
})
