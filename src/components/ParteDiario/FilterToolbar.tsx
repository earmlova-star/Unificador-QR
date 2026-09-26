interface FilterToolbarProps {
  query: string
  onQueryChange: (query: string) => void
  fechaDesde: string
  onFechaDesdeChange: (fecha: string) => void
  fechaHasta: string
  onFechaHastaChange: (fecha: string) => void
  pagina: number
  totalPaginas: number
  onPaginaChange: (pagina: number) => void
  totalFiltrado: number
}

// Búsqueda por N° de reporte o nombre del creador + rango de fecha +
// paginación, todas client-side sobre los datos ya cargados de la faena
// activa. Sin pestañas de faena aquí: ese control ya vive en el sidebar
// (selector "Faena Activa"), duplicarlo en la página sería confuso.
export const FilterToolbar = ({
  query,
  onQueryChange,
  fechaDesde,
  onFechaDesdeChange,
  fechaHasta,
  onFechaHastaChange,
  pagina,
  totalPaginas,
  onPaginaChange,
  totalFiltrado,
}: FilterToolbarProps) => (
  <div className="flex items-center justify-between gap-3 flex-wrap">
    <div className="flex items-end gap-3 flex-wrap">
      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Buscar por N° de reporte o creador…"
        className="w-full sm:w-72 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
      />
      <div>
        <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
          HH acumuladas — desde
        </label>
        <input
          type="date"
          value={fechaDesde}
          onChange={(e) => onFechaDesdeChange(e.target.value)}
          className="px-2 py-1.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
        />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">hasta</label>
        <input
          type="date"
          value={fechaHasta}
          onChange={(e) => onFechaHastaChange(e.target.value)}
          className="px-2 py-1.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
        />
      </div>
      {(fechaDesde || fechaHasta) && (
        <button
          type="button"
          onClick={() => {
            onFechaDesdeChange('')
            onFechaHastaChange('')
          }}
          className="px-2 py-1.5 text-sm text-slate-500 hover:text-slate-700 underline"
        >
          Limpiar rango
        </button>
      )}
    </div>
    {totalPaginas > 1 && (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <button
          type="button"
          disabled={pagina <= 1}
          onClick={() => onPaginaChange(pagina - 1)}
          className="px-2 py-1 border border-slate-200 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
        >
          Anterior
        </button>
        <span>
          Página {pagina} de {totalPaginas} · {totalFiltrado} reportes
        </span>
        <button
          type="button"
          disabled={pagina >= totalPaginas}
          onClick={() => onPaginaChange(pagina + 1)}
          className="px-2 py-1 border border-slate-200 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
        >
          Siguiente
        </button>
      </div>
    )}
  </div>
)
