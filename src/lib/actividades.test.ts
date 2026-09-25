import { describe, it, expect } from 'vitest'
import {
  actividadesValidas,
  horasDirectaPorActividad,
  horasMaquinariaPorActividad,
  indicesActividadesValidas,
  quitarActividad,
} from './actividades'
import { ActividadEjecutada } from '@/types/index'

const act = (area: string, descripcion = '', cantidad: number | null = null): ActividadEjecutada => ({
  area,
  descripcion,
  cantidad,
})
const vacia = (): ActividadEjecutada => act('', '', null)

describe('actividadesValidas / indicesActividadesValidas', () => {
  it('descarta las filas sin área ni descripción', () => {
    const lista = [act('A1'), vacia(), act('A3')]
    expect(actividadesValidas(lista).map((a) => a.area)).toEqual(['A1', 'A3'])
    expect(indicesActividadesValidas(lista)).toEqual([0, 2])
  })

  it('considera válida una fila que solo tiene descripción', () => {
    expect(actividadesValidas([act('', 'solo descripción')])).toHaveLength(1)
  })

  it('no cuenta como contenido los espacios en blanco', () => {
    expect(actividadesValidas([act('   ', '  ')])).toHaveLength(0)
  })

  it('con una cantidad cargada pero sin área ni descripción, la fila igual se descarta', () => {
    expect(actividadesValidas([act('', '', 8)])).toHaveLength(0)
  })
})

describe('horasDirectaPorActividad', () => {
  it('multiplica la cantidad de cada actividad por los operativos del cargo', () => {
    const lista = [act('A1', '', 0.5), act('A2', '', 2)]
    expect(horasDirectaPorActividad(lista, 4)).toEqual([2, 8])
  })

  it('trata la cantidad nula como 0', () => {
    expect(horasDirectaPorActividad([act('A1', '', null)], 4)).toEqual([0])
  })

  it('queda alineado con las actividades filtradas cuando hay una fila en blanco al medio', () => {
    // La fila en blanco del medio no se guarda, así que tampoco debe ocupar
    // una columna de horas: el resultado son 2 valores, no 3.
    const lista = [act('A1', '', 1), vacia(), act('A3', '', 3)]
    expect(horasDirectaPorActividad(lista, 2)).toEqual([2, 6])
  })
})

describe('horasMaquinariaPorActividad', () => {
  it('mantiene las horas cuando todas las actividades son válidas', () => {
    const lista = [act('A1'), act('A2'), act('A3')]
    expect(horasMaquinariaPorActividad(lista, [10, 20, 30])).toEqual([10, 20, 30])
  })

  it('realinea al filtrar una fila en blanco del medio, sin correr las horas', () => {
    // Éste es el bug del hallazgo #5: antes se truncaba (slice) y la hora de
    // A3 (30) terminaba atribuida a A2, perdiéndose el valor real de A2.
    const lista = [act('A1'), vacia(), act('A3')]
    expect(horasMaquinariaPorActividad(lista, [10, 20, 30])).toEqual([10, 30])
  })

  it('rellena con 0 si la fila de maquinaria tiene menos horas que actividades', () => {
    const lista = [act('A1'), act('A2'), act('A3')]
    expect(horasMaquinariaPorActividad(lista, [10])).toEqual([10, 0, 0])
  })

  it('devuelve lista vacía si no hay ninguna actividad válida', () => {
    expect(horasMaquinariaPorActividad([vacia()], [10])).toEqual([])
  })
})

describe('quitarActividad', () => {
  it('saca la actividad y esa misma posición de las horas de cada maquinaria', () => {
    // Quitar la actividad del medio (índice 1) NO debe correr las horas de la
    // actividad 3 a la posición de la 2 — hallazgo #5.
    const lista = [act('A1'), act('A2'), act('A3')]
    const maquinaria = [
      { equipo: 'Camión', horas: [10, 20, 30] },
      { equipo: 'Grúa', horas: [1, 2, 3] },
    ]

    const resultado = quitarActividad(lista, maquinaria, 1)

    expect(resultado.actividades.map((a) => a.area)).toEqual(['A1', 'A3'])
    expect(resultado.maquinaria[0].horas).toEqual([10, 30])
    expect(resultado.maquinaria[1].horas).toEqual([1, 3])
  })

  it('quitar la última actividad se comporta igual que truncar', () => {
    const lista = [act('A1'), act('A2')]
    const maquinaria = [{ equipo: 'Camión', horas: [10, 20] }]
    const resultado = quitarActividad(lista, maquinaria, 1)
    expect(resultado.maquinaria[0].horas).toEqual([10])
  })

  it('no muta los arrays originales', () => {
    const lista = [act('A1'), act('A2')]
    const maquinaria = [{ equipo: 'Camión', horas: [10, 20] }]
    quitarActividad(lista, maquinaria, 0)
    expect(lista).toHaveLength(2)
    expect(maquinaria[0].horas).toEqual([10, 20])
  })

  it('realinea bien cuadrillas/grupos aunque su array de actividades tenga huecos dispersos (hallazgo QA 2026-09-25)', () => {
    // Reproduce el bug tal cual se daba en pantalla: una cuadrilla creada
    // cuando solo había 2 actividades (actividades = [false, false]), y
    // después se marcó solo la Act.6 sin tocar la 3-5 — asignación directa
    // por índice (`arr[5] = true`) en un array de largo 2 deja posiciones
    // 2, 3 y 4 como huecos DISPERSOS de verdad, no `false`.
    const lista = [act('A1'), act('A2'), act('A3'), act('A4'), act('A5'), act('A6')]
    const cuadrillaConHuecos: boolean[] = []
    cuadrillaConHuecos[0] = false
    cuadrillaConHuecos[1] = false
    cuadrillaConHuecos[5] = true // dispara huecos reales en 2, 3 y 4
    const maquinaria = [{ equipo: 'Camión', horas: [1, 2, 3, 4, 5, 6] }]
    const manoObraDirecta = [{ cuadrillas: [{ actividades: cuadrillaConHuecos }] }]

    // Se borra la actividad A1 (índice 0) — con el bug viejo, .filter()
    // nunca visita los huecos y el resultado queda de largo 3 en vez de 5
    // ([false, true] en vez de largo 5 con la Act.6 corrida a su posición
    // real). Las posiciones que ya eran huecos se preservan como
    // `undefined` (equivalente a `false` en todo lugar que las consume,
    // vía `?? false`), lo importante es que NO se pierdan ni se corran.
    const resultado = quitarActividad(lista, maquinaria, 0, manoObraDirecta)
    const actividadesResultado = resultado.manoObraDirecta![0].cuadrillas[0].actividades

    expect(actividadesResultado).toHaveLength(5)
    expect(actividadesResultado.map((v) => v ?? false)).toEqual([false, false, false, false, true])
  })
})
