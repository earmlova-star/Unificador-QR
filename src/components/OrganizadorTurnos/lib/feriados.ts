// Feriados legales de Chile dentro del rango del calendario (25-sep-2026 a
// 31-mar-2027 — ver rangoFechas.ts). No hay una fuente oficial consultable
// desde acá, así que esta lista es la mejor estimación disponible; las
// fechas marcadas "verificar" dependen de un decreto anual (feriados
// trasladables) o del cálculo de Semana Santa y conviene confirmarlas
// contra el calendario oficial de feriados.cl / Diario Oficial antes de
// usarlas para planificación real.
export const FERIADOS: Record<string, string> = {
  '2026-10-12': 'Encuentro de Dos Mundos', // cae lunes de forma natural
  '2026-10-31': 'Iglesias Evangélicas y Protestantes',
  '2026-11-01': 'Día de Todos los Santos',
  '2026-12-08': 'Inmaculada Concepción',
  '2026-12-25': 'Navidad',
  '2027-01-01': 'Año Nuevo',
  '2027-03-26': 'Viernes Santo', // verificar: depende del cálculo de Semana Santa 2027
  '2027-03-27': 'Sábado Santo', // verificar: depende del cálculo de Semana Santa 2027
}

export function esFeriado(fecha: Date): boolean {
  return aFechaISO(fecha) in FERIADOS
}

export function nombreFeriado(fecha: Date): string | null {
  return FERIADOS[aFechaISO(fecha)] ?? null
}

function aFechaISO(fecha: Date): string {
  return fecha.toISOString().split('T')[0]
}
