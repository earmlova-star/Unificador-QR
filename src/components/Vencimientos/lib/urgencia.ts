import { DocumentoVencimiento, UrgenciaVencimiento } from '@/types/index'

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

// Días de calendario entre hoy y la fecha de vencimiento (negativo si ya
// venció). Ambas fechas se comparan sin hora, para que "hoy mismo" cuente
// como 0 días independiente de a qué hora del día se calcule.
export function diasHastaVencimiento(fechaVencimiento: string, hoy: Date = new Date()): number {
  const [anio, mes, dia] = fechaVencimiento.slice(0, 10).split('-').map(Number)
  const fechaVenc = new Date(anio, mes - 1, dia)
  const hoySinHora = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  const msPorDia = 1000 * 60 * 60 * 24
  return Math.round((fechaVenc.getTime() - hoySinHora.getTime()) / msPorDia)
}

// Semáforo: 🔴 vencido o ≤7 días, 🟡 entre 8 y 30 días, 🔵 más de 30 días.
export function calcularUrgencia(fechaVencimiento: string, hoy: Date = new Date()): UrgenciaVencimiento {
  const dias = diasHastaVencimiento(fechaVencimiento, hoy)
  if (dias <= 7) return 'critico'
  if (dias <= 30) return 'alerta'
  return 'normal'
}

export interface VencimientoConUrgencia extends DocumentoVencimiento {
  urgencia: UrgenciaVencimiento
  dias: number
}

export interface GrupoMesVencimientos {
  mesAnio: string // 'YYYY-MM'
  etiqueta: string // 'Septiembre 2026'
  items: VencimientoConUrgencia[]
}

// Agrupa por mes calendario de la fecha de vencimiento, meses en orden
// cronológico y, dentro de cada mes, los ítems ordenados por fecha.
export function agruparVencimientosPorMes(
  vencimientos: DocumentoVencimiento[],
  hoy: Date = new Date()
): GrupoMesVencimientos[] {
  const conUrgencia: VencimientoConUrgencia[] = vencimientos
    .map((v) => ({ ...v, urgencia: calcularUrgencia(v.fecha_vencimiento, hoy), dias: diasHastaVencimiento(v.fecha_vencimiento, hoy) }))
    .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))

  const grupos = new Map<string, GrupoMesVencimientos>()
  for (const v of conUrgencia) {
    const mesAnio = v.fecha_vencimiento.slice(0, 7)
    if (!grupos.has(mesAnio)) {
      const [anio, mes] = mesAnio.split('-').map(Number)
      grupos.set(mesAnio, { mesAnio, etiqueta: `${MESES[mes - 1]} ${anio}`, items: [] })
    }
    grupos.get(mesAnio)!.items.push(v)
  }
  return Array.from(grupos.values()).sort((a, b) => a.mesAnio.localeCompare(b.mesAnio))
}
