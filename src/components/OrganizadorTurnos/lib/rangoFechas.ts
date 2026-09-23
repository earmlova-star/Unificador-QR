// Rango fijo del calendario (pedido explícito): 25-sep-2026 a 31-mar-2027.
// La ventana visible se desplaza dentro de este rango, nunca fuera.
export const CALENDARIO_INICIO = '2026-09-25'
export const CALENDARIO_FIN = '2027-03-31'
export const TAMANO_VENTANA = 30

function aFecha(fechaStr: string): Date {
  return new Date(`${fechaStr}T00:00:00`)
}

function aTexto(fecha: Date): string {
  return fecha.toISOString().split('T')[0]
}

function diferenciaDias(a: string, b: string): number {
  const diffMs = aFecha(a).getTime() - aFecha(b).getTime()
  return Math.round(diffMs / (1000 * 3600 * 24))
}

export function sumarDias(fechaStr: string, dias: number): string {
  const d = aFecha(fechaStr)
  d.setDate(d.getDate() + dias)
  return aTexto(d)
}

export function limitarInicioVentana(candidato: string): string {
  const maxInicio = sumarDias(CALENDARIO_FIN, -(TAMANO_VENTANA - 1))
  if (diferenciaDias(candidato, CALENDARIO_INICIO) < 0) return CALENDARIO_INICIO
  if (diferenciaDias(candidato, maxInicio) > 0) return maxInicio
  return candidato
}

export function enInicioDeRango(inicioVentana: string): boolean {
  return diferenciaDias(inicioVentana, CALENDARIO_INICIO) <= 0
}

export function enFinDeRango(inicioVentana: string): boolean {
  const maxInicio = sumarDias(CALENDARIO_FIN, -(TAMANO_VENTANA - 1))
  return diferenciaDias(inicioVentana, maxInicio) >= 0
}
