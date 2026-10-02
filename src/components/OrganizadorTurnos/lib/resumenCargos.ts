import { FuncionarioTurno } from '@/types/index'
import { normalizarBusqueda } from '@lib/buscar'

export interface ConteoCargo {
  cargo: string
  total: number
}

export interface ResumenTurno {
  // null = funcionarios sin turno asignado.
  turno: string | null
  total: number
  cargos: ConteoCargo[]
}

export interface ResumenCargos {
  total: number
  porCargo: ConteoCargo[]
  porTurno: ResumenTurno[]
}

const COLLATOR = new Intl.Collator('es', { sensitivity: 'base' })

function limpiar(texto: string | null | undefined): string {
  return (texto ?? '').trim().replace(/\s+/g, ' ')
}

// Cuenta cada valor agrupando sin distinguir mayúsculas, tildes ni espacios
// de más ("Soldador", "soldador " y "SOLDADOR" son el mismo cargo); como
// texto a mostrar usa la variante que más se repite (si empatan, la
// primera que apareció). Devuelve ordenado por cantidad descendente y, a
// igual cantidad, por nombre.
function contar(valores: string[]): ConteoCargo[] {
  const grupos = new Map<string, { variantes: Map<string, number>; total: number }>()
  for (const valor of valores) {
    const clave = normalizarBusqueda(valor)
    let grupo = grupos.get(clave)
    if (!grupo) {
      grupo = { variantes: new Map(), total: 0 }
      grupos.set(clave, grupo)
    }
    grupo.total += 1
    grupo.variantes.set(valor, (grupo.variantes.get(valor) ?? 0) + 1)
  }

  const conteos: ConteoCargo[] = []
  for (const grupo of grupos.values()) {
    let mejor = ''
    let mejorVeces = 0
    for (const [variante, veces] of grupo.variantes) {
      if (veces > mejorVeces) {
        mejor = variante
        mejorVeces = veces
      }
    }
    conteos.push({ cargo: mejor, total: grupo.total })
  }
  return conteos.sort((a, b) => b.total - a.total || COLLATOR.compare(a.cargo, b.cargo))
}

// Resumen de cargos del directorio de funcionarios (pedido explícito
// 2026-10-02): total por cargo de todo el directorio, y el mismo conteo
// por cada turno. Los turnos van en orden alfabético y "sin turno" (null)
// al final.
export function resumirCargos(funcionarios: FuncionarioTurno[]): ResumenCargos {
  const porTurno = new Map<string, { turnos: string[]; cargos: string[] }>()

  for (const f of funcionarios) {
    const turno = limpiar(f.turno)
    const clave = normalizarBusqueda(turno)
    let entrada = porTurno.get(clave)
    if (!entrada) {
      entrada = { turnos: [], cargos: [] }
      porTurno.set(clave, entrada)
    }
    if (turno) entrada.turnos.push(turno)
    entrada.cargos.push(limpiar(f.cargo) || 'Sin cargo')
  }

  const turnos: ResumenTurno[] = [...porTurno.entries()].map(([clave, entrada]) => ({
    turno: clave === '' ? null : contar(entrada.turnos)[0].cargo,
    total: entrada.cargos.length,
    cargos: contar(entrada.cargos),
  }))
  turnos.sort((a, b) => {
    if (a.turno === null) return b.turno === null ? 0 : 1
    if (b.turno === null) return -1
    return COLLATOR.compare(a.turno, b.turno)
  })

  return {
    total: funcionarios.length,
    porCargo: contar(funcionarios.map((f) => limpiar(f.cargo) || 'Sin cargo')),
    porTurno: turnos,
  }
}
