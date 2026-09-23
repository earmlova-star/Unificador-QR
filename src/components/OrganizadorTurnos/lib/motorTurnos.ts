import { CuadrillaTurno } from '@/types/index'
import { temaPorId } from './coloresTurno'

export type TipoSegmento = 'SUBIDA' | 'TURNO' | 'BAJADA' | 'DESCANSO' | 'SIN_INICIO'

export interface SegmentoTurno {
  id: string
  tipo: TipoSegmento
  fecha: string
  etiqueta: string
  colorClass: string
}

// Genera el arreglo de segmentos de una cuadrilla para una ventana de
// fechas. Fechas anteriores a `fecha_inicio` quedan en blanco (SIN_INICIO)
// salvo el día inmediatamente anterior, que se marca como Subida (día de
// tránsito previo al primer turno, fuera del conteo del ciclo) — ver
// conversación del Organizador de Turnos original.
export function generarLineaTiempoCuadrilla(
  cuadrilla: CuadrillaTurno,
  inicioVentana: Date,
  totalDias: number
): SegmentoTurno[] {
  const segmentos: SegmentoTurno[] = []
  const diasTrabajo = cuadrilla.patron_dias_trabajo
  const largoCiclo = diasTrabajo + cuadrilla.patron_dias_descanso
  const fechaBase = new Date(`${cuadrilla.fecha_inicio}T00:00:00`)
  const tema = temaPorId(cuadrilla.color_tema).tema

  for (let i = 0; i < totalDias; i++) {
    const fechaActual = new Date(inicioVentana)
    fechaActual.setDate(fechaActual.getDate() + i)
    const fechaStr = fechaActual.toISOString().split('T')[0]

    const diffMs = fechaActual.getTime() - fechaBase.getTime()
    const diffDias = Math.floor(diffMs / (1000 * 3600 * 24))

    let tipo: TipoSegmento
    let etiqueta = ''
    let colorClass = ''

    if (diffDias === -1 && cuadrilla.patron_incluye_subida) {
      tipo = 'SUBIDA'
      etiqueta = 'Subida'
      colorClass = tema.subida
    } else if (diffDias < 0) {
      tipo = 'SIN_INICIO'
    } else {
      const posicionCiclo = diffDias % largoCiclo
      const siguientePosicion = (posicionCiclo + 1) % largoCiclo
      const esDiaTransito = cuadrilla.patron_incluye_subida && siguientePosicion === 0

      if (esDiaTransito) {
        tipo = 'SUBIDA'
        etiqueta = 'Subida'
        colorClass = tema.subida
      } else if (posicionCiclo < diasTrabajo) {
        if (posicionCiclo === diasTrabajo - 1) {
          tipo = 'BAJADA'
          etiqueta = `Día ${posicionCiclo + 1}`
          colorClass = tema.bajada
        } else {
          tipo = 'TURNO'
          etiqueta = `Día ${posicionCiclo + 1}`
          colorClass = tema.turno
        }
      } else {
        tipo = 'DESCANSO'
        etiqueta = `Descanso ${posicionCiclo - diasTrabajo + 1}`
        colorClass = tema.descanso
      }
    }

    segmentos.push({
      id: `${cuadrilla.id}-${fechaStr}`,
      tipo,
      fecha: fechaStr,
      etiqueta,
      colorClass,
    })
  }

  return segmentos
}
