// N° de reporte del Daily Report con 3 dígitos ("043"), o null si todavía no
// tiene: desde 2026-10-03 el número se asigna recién al ENVIAR el reporte
// (ver fix_numero_parte_al_enviar.sql), así que un borrador no tiene N°.
// Cada pantalla decide qué texto muestra en ese caso.
export function formatearNumeroReporte(numero: number | null | undefined): string | null {
  return numero == null ? null : String(numero).padStart(3, '0')
}
