import { normalizarBusqueda } from '@lib/buscar'

// Motivos de baja de siempre (pedido explícito 2026-10-03). Son los mismos
// que siembra add_motivo_baja_y_desvinculados.sql en motivos_baja; acá sirven
// de respaldo mientras la lista no se carga (o la migración no se ha corrido).
export const MOTIVOS_BAJA_POR_DEFECTO = ['Renuncia Voluntaria', 'Despido Directo', 'Traslado']

// Espacios de más afuera y adentro fuera: "  Fin   de contrato " → "Fin de contrato".
export function limpiarMotivo(texto: string): string {
  return texto.trim().replace(/\s+/g, ' ')
}

// El motivo ya existente que equivale a `nombre` sin distinguir mayúsculas,
// tildes ni espacios de más ("traslado " = "Traslado"); undefined si no hay.
export function buscarMotivo(motivos: string[], nombre: string): string | undefined {
  const clave = normalizarBusqueda(limpiarMotivo(nombre))
  if (!clave) return undefined
  return motivos.find((m) => normalizarBusqueda(limpiarMotivo(m)) === clave)
}

// Suma `nombre` al final de la lista salvo que ya esté (mismo criterio que
// buscarMotivo, igual que el índice único de la tabla).
export function unirMotivo(motivos: string[], nombre: string): string[] {
  const limpio = limpiarMotivo(nombre)
  if (!limpio || buscarMotivo(motivos, limpio)) return motivos
  return [...motivos, limpio]
}
