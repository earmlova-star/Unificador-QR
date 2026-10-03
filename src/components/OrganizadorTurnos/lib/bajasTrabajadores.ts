// Baja con fecha de los trabajadores de un turno (pedido explícito
// 2026-10-03, ver add_fecha_baja_trabajador_cuadrilla.sql): un trabajador
// dado de baja sigue existiendo, con `fecha_baja` = el ÚLTIMO día que sigue
// en el turno (inclusive). Reservas de Pasajes solo lo calcula hasta esa
// fecha, así que sus reservas anteriores se conservan y se siguen viendo.

export interface ConFechaBaja {
  fecha_baja?: string | null
}

// Fechas como 'YYYY-MM-DD': por ser de ancho fijo con ceros a la izquierda,
// comparar los strings equivale a comparar las fechas (igual que el resto
// del módulo).
export function trabajadorActivoEn(trabajador: ConFechaBaja, fechaISO: string): boolean {
  return !trabajador.fecha_baja || fechaISO <= trabajador.fecha_baja
}

// Cuántas personas "contiene" el turno (pedido explícito 2026-10-03): quien
// ya tiene una baja registrada NO cuenta, aunque su último día en el turno
// sea hoy o más adelante. A diferencia de trabajadorActivoEn (por fecha, para
// calcular reservas), esto no depende del día: es la misma regla de "activos"
// del modal de trabajadores y de Funcionarios.
export function contarVigentes(trabajadores: ConFechaBaja[]): number {
  return trabajadores.filter((t) => !t.fecha_baja).length
}

// Fecha de hoy en la hora local del navegador, como 'YYYY-MM-DD' (no
// toISOString: eso usa UTC y de noche, en Chile, ya marca el día siguiente).
export function fechaLocalISO(fecha: Date = new Date()): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${fecha.getFullYear()}-${mes}-${dia}`
}

// 'YYYY-MM-DD' → 'DD-MM-YYYY' para mostrar (formato chileno); lo que no
// tenga esa forma se devuelve tal cual.
export function fechaCorta(fechaISO: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaISO)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : fechaISO
}
