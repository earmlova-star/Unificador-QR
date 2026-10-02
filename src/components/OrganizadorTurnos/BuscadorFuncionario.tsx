import { useId, useState } from 'react'
import { FuncionarioTurno } from '@/types/index'
import { buscarFuncionarios } from './lib/buscarFuncionario'

interface BuscadorFuncionarioProps {
  funcionarios: FuncionarioTurno[]
  // RUT de los que ya están en la lista donde se agrega — no se ofrecen.
  excluirRuts?: string[]
  onSeleccionar: (funcionario: FuncionarioTurno) => void
  etiqueta?: string
}

// Campo de búsqueda con autocompletado sobre el directorio de funcionarios
// (pedido explícito 2026-10-02): se escribe parte del nombre, apellido o
// RUT y, al elegir una sugerencia, el formulario que lo usa completa solo
// nombre, apellido, RUT y cargo (ver onSeleccionar). Teclado: ↑ ↓ para
// moverse, Enter para elegir. No guarda nada: solo devuelve a quién se
// eligió.
export const BuscadorFuncionario = ({ funcionarios, excluirRuts = [], onSeleccionar, etiqueta = 'Buscar funcionario' }: BuscadorFuncionarioProps) => {
  const [consulta, setConsulta] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo] = useState(0)
  const idLista = useId()

  const resultados = buscarFuncionarios(funcionarios, consulta, excluirRuts)
  const mostrarLista = abierto && consulta.trim().length > 0

  const seleccionar = (f: FuncionarioTurno) => {
    onSeleccionar(f)
    setConsulta('')
    setAbierto(false)
    setActivo(0)
  }

  const alPresionarTecla = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!mostrarLista || resultados.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActivo((i) => Math.min(i + 1, resultados.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActivo((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      seleccionar(resultados[Math.min(activo, resultados.length - 1)])
    }
  }

  return (
    <div className="relative">
      <label className="block text-xs text-slate-500 mb-1">{etiqueta}</label>
      <input
        type="text"
        role="combobox"
        aria-expanded={mostrarLista}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-activedescendant={mostrarLista && resultados.length > 0 ? `${idLista}-${activo}` : undefined}
        autoComplete="off"
        value={consulta}
        onChange={(e) => {
          setConsulta(e.target.value)
          setAbierto(true)
          setActivo(0)
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setAbierto(false)}
        onKeyDown={alPresionarTecla}
        placeholder="Escribe un nombre, apellido o RUT…"
        className="w-full px-3 py-2 border border-blue-300 bg-blue-50/40 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
      />
      {mostrarLista && (
        <ul
          id={idLista}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-50 max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg"
        >
          {resultados.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-400">
              {funcionarios.length === 0
                ? 'El directorio está vacío — agrega funcionarios en la pestaña "Funcionarios".'
                : 'Sin coincidencias — puedes completar los datos a mano.'}
            </li>
          ) : (
            resultados.map((f, i) => (
              <li
                key={f.id}
                id={`${idLista}-${i}`}
                role="option"
                aria-selected={i === activo}
                // mousedown (no click) + preventDefault: así el input no
                // pierde el foco —y cierra la lista— antes de elegir.
                onMouseDown={(e) => {
                  e.preventDefault()
                  seleccionar(f)
                }}
                onMouseEnter={() => setActivo(i)}
                className={`px-3 py-2 cursor-pointer ${i === activo ? 'bg-blue-50' : ''}`}
              >
                <div className="text-sm text-slate-800">
                  {f.nombre} {f.apellido}
                </div>
                <div className="text-[11px] text-slate-500">
                  {f.rut} · {f.cargo}
                  {f.turno ? ` · ${f.turno}` : ''}
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
