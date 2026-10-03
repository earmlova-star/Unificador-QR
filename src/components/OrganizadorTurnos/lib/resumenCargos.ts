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

// numeric: orden "natural" — "Turno A - 7x7" va antes que "Turno A - 14x14"
// (comparando 7 con 14 como números, no como texto).
const COLLATOR = new Intl.Collator('es', { sensitivity: 'base', numeric: true })

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

// Etiqueta de las bajas que no tienen motivo registrado (las hechas antes de
// que se pidiera el motivo).
export const SIN_MOTIVO = 'Sin motivo registrado'

export interface ConteoMotivo {
  motivo: string
  total: number
}

export interface ResumenDesvinculados {
  total: number
  porMotivo: ConteoMotivo[]
  porCargo: ConteoCargo[]
}

// Desvinculado = tiene fecha de baja (aunque sea futura, igual que "Dados de
// baja" en el modal de trabajadores). Pedido explícito 2026-10-03: los
// desvinculados salen de la contabilidad de cargos vigentes y pasan a su
// propio grupo.
export function separarDesvinculados(funcionarios: FuncionarioTurno[]): {
  vigentes: FuncionarioTurno[]
  desvinculados: FuncionarioTurno[]
} {
  const vigentes: FuncionarioTurno[] = []
  const desvinculados: FuncionarioTurno[] = []
  for (const f of funcionarios) (f.fecha_baja ? desvinculados : vigentes).push(f)
  return { vigentes, desvinculados }
}

// Cuántos desvinculados hay en total, por motivo y por cargo (ambos de
// mayor a menor). Los motivos se agrupan igual que los cargos: sin
// distinguir mayúsculas, tildes ni espacios de más.
export function resumirDesvinculados(desvinculados: FuncionarioTurno[]): ResumenDesvinculados {
  return {
    total: desvinculados.length,
    porMotivo: contar(desvinculados.map((f) => limpiar(f.motivo_baja) || SIN_MOTIVO)).map(({ cargo, total }) => ({
      motivo: cargo,
      total,
    })),
    porCargo: contar(desvinculados.map((f) => limpiar(f.cargo) || 'Sin cargo')),
  }
}

export interface GrupoTurnos {
  // Ej. "Turno A" — agrupa "Turno A - 7x7", "Turno A - 14x14", etc.
  grupo: string
  total: number
  turnos: ResumenTurno[]
}

// "Turno A - 14x14" → grupo "Turno A". Solo cuando lo que sigue a "Turno"
// es UNA letra seguida de guion: "Turno 5x2 - Administrativo", "Turno AB"
// o "Turno H" no pertenecen a ningún grupo.
const PATRON_GRUPO = /^\s*turno\s+([a-z])\s*-\s*\S/i

// Separa los turnos del resumen en grupos por letra (Turno A, Turno B…) y
// los que no encajan en ninguno (pedido explícito 2026-10-02). Grupos y
// turnos de cada grupo en orden natural (7x7 antes que 14x14); los sueltos
// conservan el orden de entrada (ya viene "sin turno" al final).
export function agruparTurnosPorGrupo(turnos: ResumenTurno[]): { grupos: GrupoTurnos[]; sueltos: ResumenTurno[] } {
  const porGrupo = new Map<string, GrupoTurnos>()
  const sueltos: ResumenTurno[] = []

  for (const t of turnos) {
    const letra = t.turno === null ? undefined : PATRON_GRUPO.exec(t.turno)?.[1]
    if (!letra) {
      sueltos.push(t)
      continue
    }
    const nombre = `Turno ${letra.toUpperCase()}`
    let grupo = porGrupo.get(nombre)
    if (!grupo) {
      grupo = { grupo: nombre, total: 0, turnos: [] }
      porGrupo.set(nombre, grupo)
    }
    grupo.total += t.total
    grupo.turnos.push(t)
  }

  const grupos = [...porGrupo.values()].sort((a, b) => COLLATOR.compare(a.grupo, b.grupo))
  for (const g of grupos) g.turnos.sort((a, b) => COLLATOR.compare(a.turno ?? '', b.turno ?? ''))
  return { grupos, sueltos }
}

// Resumen de cargos del directorio de funcionarios (pedido explícito
// 2026-10-02): total por cargo de todo el directorio, y el mismo conteo
// por cada turno. Los turnos van en orden natural (alfabético, con los
// números comparados como números) y "sin turno" (null) al final.
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
