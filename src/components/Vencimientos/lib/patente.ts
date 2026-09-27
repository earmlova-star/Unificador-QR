// Patente chilena formato actual (2007+): 4 letras + 2 números, sin puntos
// ni guion (ej. BBBB12). No valida dígito verificador — a diferencia del
// RUT, la patente no tiene uno.
export function formatearPatente(patente: string): string {
  const valor = patente.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  return valor.slice(0, 6)
}

export function validarPatente(patente: string): boolean {
  return /^[A-Z]{4}[0-9]{2}$/.test(patente)
}
