import { describe, it, expect } from 'vitest'
import { MOTIVOS_BAJA_POR_DEFECTO, buscarMotivo, limpiarMotivo, unirMotivo } from './motivosBaja'

describe('MOTIVOS_BAJA_POR_DEFECTO', () => {
  it('son los tres pedidos, en ese orden', () => {
    expect(MOTIVOS_BAJA_POR_DEFECTO).toEqual(['Renuncia Voluntaria', 'Despido Directo', 'Traslado'])
  })
})

describe('limpiarMotivo', () => {
  it('quita espacios de más, afuera y adentro', () => {
    expect(limpiarMotivo('  Fin   de  contrato ')).toBe('Fin de contrato')
    expect(limpiarMotivo('   ')).toBe('')
  })
})

describe('buscarMotivo', () => {
  it('encuentra el existente sin distinguir mayúsculas, tildes ni espacios', () => {
    expect(buscarMotivo(MOTIVOS_BAJA_POR_DEFECTO, 'traslado ')).toBe('Traslado')
    expect(buscarMotivo(MOTIVOS_BAJA_POR_DEFECTO, 'DESPIDO   directo')).toBe('Despido Directo')
    expect(buscarMotivo(['Licencia médica'], 'licencia medica')).toBe('Licencia médica')
  })

  it('devuelve undefined si no existe o el texto está vacío', () => {
    expect(buscarMotivo(MOTIVOS_BAJA_POR_DEFECTO, 'Fallecimiento')).toBeUndefined()
    expect(buscarMotivo(MOTIVOS_BAJA_POR_DEFECTO, '  ')).toBeUndefined()
  })
})

describe('unirMotivo', () => {
  it('agrega uno nuevo al final, limpio', () => {
    expect(unirMotivo(['Traslado'], '  Fin  de contrato ')).toEqual(['Traslado', 'Fin de contrato'])
  })

  it('no duplica uno que ya está (devuelve la misma lista)', () => {
    const lista = ['Traslado']
    expect(unirMotivo(lista, 'TRASLADO')).toBe(lista)
  })

  it('ignora un texto vacío', () => {
    const lista = ['Traslado']
    expect(unirMotivo(lista, '   ')).toBe(lista)
  })
})
