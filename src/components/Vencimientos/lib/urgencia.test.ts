import { describe, it, expect } from 'vitest'
import { agruparVencimientosPorMes, calcularUrgencia, diasHastaVencimiento } from './urgencia'
import { DocumentoVencimiento } from '@/types/index'

const HOY = new Date(2026, 8, 27) // 27 de septiembre de 2026 (mes 0-indexado)

const fechaEnDias = (dias: number): string => {
  const f = new Date(HOY)
  f.setDate(f.getDate() + dias)
  return f.toISOString().slice(0, 10)
}

const doc = (id: string, fecha_vencimiento: string): DocumentoVencimiento => ({
  id,
  funcionario_id: null,
  camioneta_id: null,
  nombre_documento: 'Test',
  fecha_vencimiento,
  creado_por: 'u1',
  created_at: '',
  updated_at: '',
})

describe('diasHastaVencimiento', () => {
  it('da 0 para hoy mismo', () => {
    expect(diasHastaVencimiento(fechaEnDias(0), HOY)).toBe(0)
  })

  it('da positivo para una fecha futura', () => {
    expect(diasHastaVencimiento(fechaEnDias(10), HOY)).toBe(10)
  })

  it('da negativo para una fecha ya vencida', () => {
    expect(diasHastaVencimiento(fechaEnDias(-5), HOY)).toBe(-5)
  })
})

describe('calcularUrgencia', () => {
  it('marca como crítico un documento ya vencido', () => {
    expect(calcularUrgencia(fechaEnDias(-1), HOY)).toBe('critico')
  })

  it('marca como crítico exactamente al límite de 7 días', () => {
    expect(calcularUrgencia(fechaEnDias(7), HOY)).toBe('critico')
  })

  it('marca como alerta justo después del límite crítico (8 días)', () => {
    expect(calcularUrgencia(fechaEnDias(8), HOY)).toBe('alerta')
  })

  it('marca como alerta exactamente al límite de 30 días', () => {
    expect(calcularUrgencia(fechaEnDias(30), HOY)).toBe('alerta')
  })

  it('marca como normal después de 30 días', () => {
    expect(calcularUrgencia(fechaEnDias(31), HOY)).toBe('normal')
  })
})

describe('agruparVencimientosPorMes', () => {
  it('agrupa por mes calendario y ordena los meses cronológicamente', () => {
    const vencimientos = [
      doc('a', '2026-11-05'),
      doc('b', '2026-09-10'),
      doc('c', '2026-10-20'),
    ]
    const grupos = agruparVencimientosPorMes(vencimientos, HOY)
    expect(grupos.map((g) => g.mesAnio)).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(grupos[0].etiqueta).toBe('Septiembre 2026')
  })

  it('ordena los ítems dentro de cada mes por fecha ascendente', () => {
    const vencimientos = [doc('a', '2026-09-25'), doc('b', '2026-09-05'), doc('c', '2026-09-15')]
    const grupos = agruparVencimientosPorMes(vencimientos, HOY)
    expect(grupos[0].items.map((i) => i.id)).toEqual(['b', 'c', 'a'])
  })

  it('adjunta la urgencia calculada a cada ítem', () => {
    const vencimientos = [doc('a', fechaEnDias(-1)), doc('b', fechaEnDias(60))]
    const grupos = agruparVencimientosPorMes(vencimientos, HOY)
    const porId = new Map(grupos.flatMap((g) => g.items).map((i) => [i.id, i.urgencia]))
    expect(porId.get('a')).toBe('critico')
    expect(porId.get('b')).toBe('normal')
  })
})
