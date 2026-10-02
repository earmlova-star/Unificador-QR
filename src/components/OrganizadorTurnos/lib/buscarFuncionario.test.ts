import { describe, it, expect } from 'vitest'
import { buscarFuncionarios, normalizarRut } from './buscarFuncionario'
import { FuncionarioTurno } from '@/types/index'

const f = (nombre: string, apellido: string, rut: string, cargo = 'Operador', turno: string | null = null): FuncionarioTurno => ({
  id: `f-${rut}`,
  nombre,
  apellido,
  rut,
  cargo,
  turno,
  created_at: '2026-10-02T00:00:00Z',
  updated_at: '2026-10-02T00:00:00Z',
})

const directorio = [
  f('José', 'Rojas Pérez', '12.345.678-5', 'Capataz', 'Turno A - 14x14'),
  f('Juan', 'Pérez González', '9.876.543-3', 'Soldador', 'Turno H'),
  f('María', 'López Soto', '15.111.222-K', 'Administrativo'),
]

describe('buscarFuncionarios', () => {
  it('no devuelve nada con la consulta vacía', () => {
    expect(buscarFuncionarios(directorio, '')).toEqual([])
    expect(buscarFuncionarios(directorio, '   ')).toEqual([])
  })

  it('no distingue mayúsculas ni tildes', () => {
    expect(buscarFuncionarios(directorio, 'jose').map((x) => x.nombre)).toEqual(['José'])
    expect(buscarFuncionarios(directorio, 'MARIA').map((x) => x.nombre)).toEqual(['María'])
  })

  it('exige que coincidan todas las palabras escritas, en cualquier orden', () => {
    expect(buscarFuncionarios(directorio, 'perez ju').map((x) => x.nombre)).toEqual(['Juan'])
    expect(buscarFuncionarios(directorio, 'juan lopez')).toEqual([])
  })

  it('encuentra por RUT con o sin puntos y guion', () => {
    expect(buscarFuncionarios(directorio, '12.345').map((x) => x.nombre)).toEqual(['José'])
    expect(buscarFuncionarios(directorio, '12345678').map((x) => x.nombre)).toEqual(['José'])
    expect(buscarFuncionarios(directorio, '15111222k').map((x) => x.nombre)).toEqual(['María'])
  })

  it('encuentra por cargo y por turno', () => {
    expect(buscarFuncionarios(directorio, 'soldador').map((x) => x.nombre)).toEqual(['Juan'])
    expect(buscarFuncionarios(directorio, '14x14').map((x) => x.nombre)).toEqual(['José'])
  })

  it('pone primero a quien empieza con lo escrito antes que a quien solo lo contiene', () => {
    // "pe" empieza el nombre de Pedro; en Ana solo aparece en el medio de
    // su cargo ("O-pe-rador"). Ana va primero en el directorio, así que
    // si el orden no se corrigiera, saldría antes que Pedro.
    const resultado = buscarFuncionarios(
      [f('Ana', 'Lopez', '2.222.222-2', 'Operador'), f('Pedro', 'Aguilera', '1.111.111-1')],
      'pe'
    )
    expect(resultado.map((x) => x.nombre)).toEqual(['Pedro', 'Ana'])
  })

  it('excluye a los RUT que ya están en la lista, sin importar el formato', () => {
    expect(buscarFuncionarios(directorio, 'jose', ['12345678-5']).map((x) => x.nombre)).toEqual([])
  })

  it('respeta el límite de resultados', () => {
    const muchos = Array.from({ length: 20 }, (_, i) => f(`Pedro${i}`, 'Soto', `${i + 1}.000.000-0`))
    expect(buscarFuncionarios(muchos, 'pedro', [], 5)).toHaveLength(5)
  })
})

describe('normalizarRut', () => {
  it('deja solo dígitos y K en mayúscula', () => {
    expect(normalizarRut('15.111.222-k')).toBe('15111222K')
  })
})
