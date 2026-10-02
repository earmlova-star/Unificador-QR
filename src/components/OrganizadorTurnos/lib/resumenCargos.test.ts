import { describe, it, expect } from 'vitest'
import { resumirCargos } from './resumenCargos'
import { FuncionarioTurno } from '@/types/index'

let contador = 0
const f = (cargo: string, turno: string | null): FuncionarioTurno => {
  contador += 1
  return {
    id: `f${contador}`,
    nombre: 'N',
    apellido: 'A',
    rut: `${contador}`,
    cargo,
    turno,
    created_at: '',
    updated_at: '',
  }
}

describe('resumirCargos', () => {
  it('cuenta el total por cargo de todo el directorio, de mayor a menor', () => {
    const r = resumirCargos([f('Soldador', 'A'), f('Capataz', 'A'), f('Soldador', 'B'), f('Soldador', null), f('Capataz', 'B'), f('Ayudante', 'B')])
    expect(r.total).toBe(6)
    expect(r.porCargo).toEqual([
      { cargo: 'Soldador', total: 3 },
      { cargo: 'Capataz', total: 2 },
      { cargo: 'Ayudante', total: 1 },
    ])
  })

  it('a igual cantidad ordena los cargos por nombre', () => {
    const r = resumirCargos([f('Operador', 'A'), f('Ayudante', 'A'), f('Capataz', 'A')])
    expect(r.porCargo.map((c) => c.cargo)).toEqual(['Ayudante', 'Capataz', 'Operador'])
  })

  it('agrupa sin distinguir mayúsculas, tildes ni espacios de más, y muestra la variante más repetida', () => {
    const r = resumirCargos([f('Electrico', 'A'), f('Eléctrico', 'A'), f('  eléctrico ', 'A'), f('Eléctrico', 'A')])
    expect(r.porCargo).toEqual([{ cargo: 'Eléctrico', total: 4 }])
  })

  it('cuenta los cargos por turno, con turnos en orden alfabético y "sin turno" al final', () => {
    const r = resumirCargos([f('Soldador', 'Turno H'), f('Capataz', null), f('Soldador', 'Turno A'), f('Soldador', 'Turno H'), f('Ayudante', 'Turno A')])
    expect(r.porTurno.map((t) => t.turno)).toEqual(['Turno A', 'Turno H', null])
    expect(r.porTurno[0]).toEqual({
      turno: 'Turno A',
      total: 2,
      cargos: [
        { cargo: 'Ayudante', total: 1 },
        { cargo: 'Soldador', total: 1 },
      ],
    })
    expect(r.porTurno[1]).toEqual({ turno: 'Turno H', total: 2, cargos: [{ cargo: 'Soldador', total: 2 }] })
    expect(r.porTurno[2]).toEqual({ turno: null, total: 1, cargos: [{ cargo: 'Capataz', total: 1 }] })
  })

  it('trata turno vacío o solo espacios como "sin turno", y turnos que difieren en mayúsculas como uno solo', () => {
    const r = resumirCargos([f('Soldador', ''), f('Soldador', '   '), f('Soldador', 'turno h'), f('Capataz', 'Turno H')])
    expect(r.porTurno.map((t) => t.turno)).toEqual(['turno h', null])
    expect(r.porTurno[0].total).toBe(2)
    expect(r.porTurno[1].total).toBe(2)
  })

  it('con el directorio vacío no devuelve nada', () => {
    expect(resumirCargos([])).toEqual({ total: 0, porCargo: [], porTurno: [] })
  })
})
