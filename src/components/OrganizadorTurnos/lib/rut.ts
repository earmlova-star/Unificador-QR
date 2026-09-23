// Validación de RUT chileno con dígito verificador — distinto del
// formateador de Bodega/lib/rut.ts (ese solo normaliza, no valida el DV).
export function validarRut(rut: string): boolean {
  if (!/^[0-9]{1,2}\.[0-9]{3}\.[0-9]{3}-[0-9kK]{1}$/.test(rut)) {
    return false
  }
  const rutLimpio = rut.replace(/\./g, '').replace('-', '')
  const cuerpo = rutLimpio.slice(0, -1)
  const dv = rutLimpio.slice(-1).toUpperCase()

  let suma = 0
  let multiplicador = 2

  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo.charAt(i), 10) * multiplicador
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1
  }

  const dvEsperado = 11 - (suma % 11)
  let dvCalculado = ''
  if (dvEsperado === 11) dvCalculado = '0'
  else if (dvEsperado === 10) dvCalculado = 'K'
  else dvCalculado = dvEsperado.toString()

  return dv === dvCalculado
}

export function formatearRut(rut: string): string {
  const valor = rut.replace(/[^0-9kK]/g, '')
  if (valor.length <= 1) return valor
  const cuerpo = valor.slice(0, -1)
  const dv = valor.slice(-1).toUpperCase()
  const cuerpoFormateado = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${cuerpoFormateado}-${dv}`
}
