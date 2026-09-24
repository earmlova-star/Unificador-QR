import { validarRut, formatearRut } from './rut'

export interface TrabajadorParseado {
  nombre: string
  apellido: string
  rut: string
  cargo: string
}

export interface ErrorParseoLinea {
  linea: number
  texto: string
  mensaje: string
}

// Nombre completo → nombre/apellido. Patrón chileno: 3 palabras = 1 nombre
// + 2 apellidos (el caso más común); 4+ palabras = 2 nombres + el resto de
// apellidos; 2 o menos = una palabra por campo. No es infalible (algunos
// nombres compuestos quedan mal divididos), pero cubre la gran mayoría —
// el resultado queda editable después igual que cualquier otro dato.
function dividirNombreCompleto(nombreCompleto: string): { nombre: string; apellido: string } {
  const partes = nombreCompleto.trim().split(/\s+/).filter(Boolean)
  if (partes.length <= 2) return { nombre: partes[0] ?? '', apellido: partes.slice(1).join(' ') }
  if (partes.length === 3) return { nombre: partes[0], apellido: partes.slice(1).join(' ') }
  return { nombre: partes.slice(0, 2).join(' '), apellido: partes.slice(2).join(' ') }
}

// Una persona por línea, 3 columnas: Nombre completo, RUT, Cargo. Separa
// por TAB si existe (lo natural al pegar un rango de Excel), si no por
// coma, si no por 2+ espacios — para que copiar/pegar funcione sin que el
// usuario tenga que dar formato a nada.
export function parsearTrabajadoresMasivo(texto: string): { validos: TrabajadorParseado[]; errores: ErrorParseoLinea[] } {
  const validos: TrabajadorParseado[] = []
  const errores: ErrorParseoLinea[] = []

  const lineas = texto.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)

  lineas.forEach((linea, idx) => {
    const numeroLinea = idx + 1
    const campos = linea.includes('\t')
      ? linea.split('\t')
      : linea.includes(',')
      ? linea.split(',')
      : linea.split(/\s{2,}/)

    const [nombreCompletoRaw, rutRaw, cargoRaw] = campos.map((c) => (c ?? '').trim())

    if (!nombreCompletoRaw || !rutRaw || !cargoRaw) {
      errores.push({ linea: numeroLinea, texto: linea, mensaje: 'Faltan columnas — se esperan 3: Nombre completo, RUT, Cargo.' })
      return
    }

    const rut = formatearRut(rutRaw)
    if (!validarRut(rut)) {
      errores.push({ linea: numeroLinea, texto: linea, mensaje: `RUT inválido: "${rutRaw}".` })
      return
    }

    const { nombre, apellido } = dividirNombreCompleto(nombreCompletoRaw)
    if (!nombre || !apellido) {
      errores.push({ linea: numeroLinea, texto: linea, mensaje: `No se pudo separar nombre y apellido en "${nombreCompletoRaw}".` })
      return
    }

    validos.push({ nombre, apellido, rut, cargo: cargoRaw })
  })

  return { validos, errores }
}
