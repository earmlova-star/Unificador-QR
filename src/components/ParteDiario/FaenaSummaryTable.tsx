import { Faena, FAENA_LABELS, ParteDiario } from '@/types/index'
import { calcularHHReales } from '@lib/calculosHH'

interface FaenaSummaryTableProps {
  partes: ParteDiario[]
}

// Tabla comparativa "HH acumuladas por faena" — a propósito NO se filtra
// por faena activa (a diferencia de ReportsHistoryTable): su función es
// comparar Las Tórtolas contra Los Bronces, así que siempre muestra ambas.
export const FaenaSummaryTable = ({ partes }: FaenaSummaryTableProps) => {
  // Pedido explícito 2026-10-02: acá va el HH reportado por CADA faena de
  // forma independiente, sumando el HH real (calcularHHReales) de todos
  // sus propios reportes — no el campo *_acumuladas del último reporte de
  // cada una. Antes sí se podía leer ese snapshot directo (cada faena
  // corría su propia cadena de acumulados, así que el último reporte de
  // una faena ya traía el corrido completo de esa faena), pero desde que
  // recalcularAcumuladosContrato (supabase.ts) pasó a llevar una sola
  // cadena combinada para todo el contrato, *_acumuladas de un reporte de
  // LB incluye lo acumulado hasta ahí por LT también — ya no sirve para
  // aislar el total de una faena sola.
  const sumarFaena = (faena: Faena) => {
    const reales = partes.filter((p) => p.faena === faena).map((p) => calcularHHReales(p, faena))
    return {
      directas: reales.reduce((acc, r) => acc + r.directas, 0),
      hm: reales.reduce((acc, r) => acc + r.hm, 0),
      indirectas: reales.reduce((acc, r) => acc + r.indirectas, 0),
    }
  }
  const hayLT = partes.some((p) => p.faena === Faena.LT)
  const hayLB = partes.some((p) => p.faena === Faena.LB)
  const totalLT = sumarFaena(Faena.LT)
  const totalLB = sumarFaena(Faena.LB)
  const filas = [
    { faena: Faena.LT, etiqueta: FAENA_LABELS[Faena.LT], hay: hayLT, total: totalLT },
    { faena: Faena.LB, etiqueta: FAENA_LABELS[Faena.LB], hay: hayLB, total: totalLB },
  ]
  const totalGeneral = {
    directas: totalLT.directas + totalLB.directas,
    hm: totalLT.hm + totalLB.hm,
    indirectas: totalLT.indirectas + totalLB.indirectas,
  }
  const totalHH = totalGeneral.directas + totalGeneral.hm + totalGeneral.indirectas

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">HH acumuladas por faena</h3>
        <span className="text-xs text-slate-400">{partes.length} Daily Report{partes.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">Faena</th>
              <th className="text-right px-4 py-2">HH Directas</th>
              <th className="text-right px-4 py-2">HM Maquinaria</th>
              <th className="text-right px-4 py-2">HH Indirectas</th>
              <th className="text-right px-4 py-2">Total HH</th>
              <th className="text-left px-4 py-2 w-40">% Aporte</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filas.map(({ faena, etiqueta, hay, total: totalFaena }) => {
              if (!hay) {
                return (
                  <tr key={faena}>
                    <td className="px-4 py-2 text-slate-700">{etiqueta}</td>
                    <td colSpan={5} className="px-4 py-2 text-slate-400 italic">En Movilización</td>
                  </tr>
                )
              }
              const { directas, hm, indirectas } = totalFaena
              const total = directas + hm + indirectas
              const aporte = totalHH > 0 ? (total / totalHH) * 100 : 0
              return (
                <tr key={faena}>
                  <td className="px-4 py-2 text-slate-700">{etiqueta}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-900">{directas}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-900">{hm}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-900">{indirectas}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900">{total}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-600 rounded-full" style={{ width: `${aporte}%` }} />
                      </div>
                      <span className="text-xs font-mono text-slate-500 w-10 text-right">{aporte.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
            <tr className="bg-slate-50 font-semibold">
              <td className="px-4 py-2 text-slate-900">Total general</td>
              <td className="px-4 py-2 text-right font-mono text-slate-900">{totalGeneral.directas}</td>
              <td className="px-4 py-2 text-right font-mono text-slate-900">{totalGeneral.hm}</td>
              <td className="px-4 py-2 text-right font-mono text-slate-900">{totalGeneral.indirectas}</td>
              <td className="px-4 py-2 text-right font-mono text-slate-900">{totalHH}</td>
              <td className="px-4 py-2"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
