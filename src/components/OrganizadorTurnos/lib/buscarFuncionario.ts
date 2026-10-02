import { FuncionarioTurno } from '@/types/index'
import { normalizarBusqueda } from '@lib/buscar'

// Solo dígitos y K, en mayúscula: así "12.345.678-k" y "12345678K" son el
// mismo RUT al comparar.
export function normalizarRut(rut: string): string {
  return rut.replace(/[^0-9kK]/g, '').toUpperCase()
}

// Búsqueda de funcionarios (pedido explícito 2026-10-02) — la usan el
// autocompletado y el filtro de la tabla del directorio: sin distinguir
// mayúsculas ni tildes, y cada palabra que se escribe tiene que coincidir
// con el nombre/apellido/cargo/turno o con el RUT (con o sin puntos y
// guion) — así "perez ju" encuentra a "Juan Pérez". Los que tienen una
// palabra del nombre o apellido que EMPIEZA con lo escrito van antes que
// los que solo lo contienen en el medio. `excluirRuts` saca a los que ya
// están en la lista donde se está agregando (para no ofrecer duplicados).
// Con la consulta vacía no devuelve nada.
export function filtrarFuncionarios(
  funcionarios: FuncionarioTurno[],
  consulta: string,
  excluirRuts: string[] = []
): FuncionarioTurno[] {
  const palabras = normalizarBusqueda(consulta).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return []

  const excluidos = new Set(excluirRuts.map(normalizarRut))
  const coincidencias: { funcionario: FuncionarioTurno; alInicio: boolean }[] = []

  for (const f of funcionarios) {
    const rutNormalizado = normalizarRut(f.rut)
    if (excluidos.has(rutNormalizado)) continue
    const rutMinuscula = rutNormalizado.toLowerCase()

    const palabrasNombre = normalizarBusqueda(`${f.nombre} ${f.apellido}`).split(/\s+/)
    const texto = normalizarBusqueda(`${f.nombre} ${f.apellido} ${f.cargo} ${f.turno ?? ''}`)

    const coincide = (p: string) => {
      if (texto.includes(p)) return true
      const soloRut = p.replace(/[.\-]/g, '')
      return soloRut.length > 0 && rutMinuscula.includes(soloRut)
    }
    if (!palabras.every(coincide)) continue

    const alInicio = palabras.every((p) => palabrasNombre.some((n) => n.startsWith(p)) || rutMinuscula.startsWith(p.replace(/[.\-]/g, '')))
    coincidencias.push({ funcionario: f, alInicio })
  }

  // Array.sort es estable: dentro de cada grupo se mantiene el orden del
  // directorio (apellido, nombre).
  coincidencias.sort((a, b) => Number(b.alInicio) - Number(a.alInicio))
  return coincidencias.map((c) => c.funcionario)
}

export function buscarFuncionarios(
  funcionarios: FuncionarioTurno[],
  consulta: string,
  excluirRuts: string[] = [],
  limite = 8
): FuncionarioTurno[] {
  return filtrarFuncionarios(funcionarios, consulta, excluirRuts).slice(0, limite)
}
