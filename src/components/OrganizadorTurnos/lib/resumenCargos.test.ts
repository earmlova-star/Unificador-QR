import { describe, it, expect } from 'vitest'
import { agruparTurnosPorGrupo, resumirCargos } from './resumenCargos'
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

// Distribución real descrita en la especificación del módulo Funcionarios
// (35 funcionarios, 5 turnos).
function directorioEspecificacion(): FuncionarioTurno[] {
  const repetir = (n: number, cargo: string, turno: string) => Array.from({ length: n }, () => f(cargo, turno))
  return [
    f('Admin de Contrato', 'Turno 5x2 - Administrativo'),
    f('Jefe de Terreno', 'Turno 5x2 - Administrativo'),
    f('Relaciones Laborales', 'Turno 5x2 - Administrativo'),
    f('Supervisor', 'Turno 5x2 - Administrativo'),
    f('Técnico Proyectista', 'Turno 5x2 - Administrativo'),
    f('APR', 'Turno A - 7x7'),
    f('Coordinador', 'Turno A - 7x7'),
    ...repetir(10, 'Tecnico Montajista', 'Turno A - 14x14'),
    ...repetir(2, 'Supervisor', 'Turno A - 14x14'),
    f('APR', 'Turno B - 7x7'),
    f('Coordinador', 'Turno B - 7x7'),
    ...repetir(12, 'Tecnico Montajista', 'Turno B - 14x14'),
    ...repetir(2, 'Supervisor', 'Turno B - 14x14'),
  ]
}

describe('agruparTurnosPorGrupo', () => {
  it('arma los grupos Turno A y Turno B con 7x7 antes que 14x14, y deja Administrativo suelto', () => {
    const resumen = resumirCargos(directorioEspecificacion())
    expect(resumen.total).toBe(35)
    expect(resumen.porCargo).toEqual([
      { cargo: 'Tecnico Montajista', total: 22 },
      { cargo: 'Supervisor', total: 5 },
      { cargo: 'APR', total: 2 },
      { cargo: 'Coordinador', total: 2 },
      { cargo: 'Admin de Contrato', total: 1 },
      { cargo: 'Jefe de Terreno', total: 1 },
      { cargo: 'Relaciones Laborales', total: 1 },
      { cargo: 'Técnico Proyectista', total: 1 },
    ])

    const { grupos, sueltos } = agruparTurnosPorGrupo(resumen.porTurno)
    expect(grupos.map((g) => [g.grupo, g.total])).toEqual([
      ['Turno A', 14],
      ['Turno B', 16],
    ])
    expect(grupos[0].turnos.map((t) => [t.turno, t.total])).toEqual([
      ['Turno A - 7x7', 2],
      ['Turno A - 14x14', 12],
    ])
    expect(grupos[1].turnos.map((t) => [t.turno, t.total])).toEqual([
      ['Turno B - 7x7', 2],
      ['Turno B - 14x14', 14],
    ])
    expect(grupos[1].turnos[1].cargos).toEqual([
      { cargo: 'Tecnico Montajista', total: 12 },
      { cargo: 'Supervisor', total: 2 },
    ])
    expect(sueltos.map((t) => [t.turno, t.total])).toEqual([['Turno 5x2 - Administrativo', 5]])
  })

  it('solo agrupa cuando después de "Turno" viene UNA letra y un guion; el resto queda suelto, y "sin turno" al final', () => {
    const resumen = resumirCargos([f('X', 'Turno AB'), f('X', 'Turno H'), f('X', 'Turno 5x2 - Admin'), f('X', 'Turno C - 4x3'), f('X', null)])
    const { grupos, sueltos } = agruparTurnosPorGrupo(resumen.porTurno)
    expect(grupos.map((g) => g.grupo)).toEqual(['Turno C'])
    expect(sueltos.map((t) => t.turno)).toEqual(['Turno 5x2 - Admin', 'Turno AB', 'Turno H', null])
  })

  it('sin turnos no hay grupos ni sueltos', () => {
    expect(agruparTurnosPorGrupo([])).toEqual({ grupos: [], sueltos: [] })
  })
})
