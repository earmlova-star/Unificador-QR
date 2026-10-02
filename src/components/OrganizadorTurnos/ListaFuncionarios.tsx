import { useMemo, useState } from 'react'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { FuncionarioTurno, Usuario } from '@/types/index'
import { validarRut, formatearRut } from './lib/rut'
import { filtrarFuncionarios, normalizarRut } from './lib/buscarFuncionario'
import { ConteoCargo, resumirCargos } from './lib/resumenCargos'

interface ListaFuncionariosProps {
  funcionarios: FuncionarioTurno[]
  // Nombres de los turnos existentes, solo como sugerencia para el campo
  // "Turno" (sigue siendo texto libre).
  turnosSugeridos: string[]
  usuario: Usuario
  cargando: boolean
  onCreado: (funcionario: FuncionarioTurno) => void
  onActualizado: (funcionario: FuncionarioTurno) => void
  onEliminado: (id: string) => void
}

interface FormFuncionario {
  nombre: string
  apellido: string
  rut: string
  cargo: string
  turno: string
}

const FORM_VACIO: FormFuncionario = { nombre: '', apellido: '', rut: '', cargo: '', turno: '' }

const COLLATOR = new Intl.Collator('es', { sensitivity: 'base' })

const CLASE_INPUT =
  'w-full px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600'

// Tarjeta del resumen de cargos (pedido explícito 2026-10-02): lista cada
// cargo con su cantidad y una barra proporcional al que más tiene dentro de
// ESTA tarjeta.
const TarjetaCargos = ({ titulo, total, cargos, destacada = false }: { titulo: string; total: number; cargos: ConteoCargo[]; destacada?: boolean }) => {
  const maximo = Math.max(1, ...cargos.map((c) => c.total))
  return (
    <div className={`border rounded-lg bg-white ${destacada ? 'border-blue-300' : 'border-slate-200'}`}>
      <div className={`flex items-center justify-between gap-2 px-3 py-2 border-b rounded-t-lg ${destacada ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
        <span className="text-xs font-bold text-slate-700 truncate" title={titulo}>
          {titulo}
        </span>
        <span className="text-[10px] font-medium text-slate-500 bg-white border border-slate-200 rounded-full px-2 py-0.5 flex-shrink-0">
          {total} {total === 1 ? 'funcionario' : 'funcionarios'}
        </span>
      </div>
      <ul className="px-3 py-2 space-y-1 max-h-64 overflow-y-auto">
        {cargos.map((c) => (
          <li key={c.cargo} className="flex items-center gap-2 text-xs">
            <span className="w-2/5 truncate text-slate-700" title={c.cargo}>
              {c.cargo}
            </span>
            <span className="flex-1 h-1.5 bg-slate-100 rounded">
              <span className="block h-1.5 bg-blue-400 rounded" style={{ width: `${(c.total / maximo) * 100}%` }} />
            </span>
            <span className="w-6 text-right font-semibold text-slate-800">{c.total}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Pestaña "Funcionarios" del Organizador de Turnos (pedido explícito
// 2026-10-02): el directorio que alimenta el autocompletado al agregar un
// funcionario a una Subida/Bajada suelta. Agregar, editar o borrar acá NO
// toca a los funcionarios ya asignados a un turno o evento — cada uno
// conserva su propia copia.
export const ListaFuncionarios = ({ funcionarios, turnosSugeridos, usuario, cargando, onCreado, onActualizado, onEliminado }: ListaFuncionariosProps) => {
  const [busqueda, setBusqueda] = useState('')
  const [agregando, setAgregando] = useState(false)
  const [form, setForm] = useState<FormFuncionario>(FORM_VACIO)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [formEdicion, setFormEdicion] = useState<FormFuncionario>(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)
  const [eliminandoId, setEliminandoId] = useState<string | null>(null)
  const [mostrarResumen, setMostrarResumen] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Resumen de todo el directorio, no del filtro de la búsqueda.
  const resumen = useMemo(() => resumirCargos(funcionarios), [funcionarios])
  // "Sin turno" aparece como una tarjeta más, pero no es un turno.
  const cantidadTurnos = resumen.porTurno.filter((t) => t.turno !== null).length

  const ordenados = useMemo(
    () => [...funcionarios].sort((a, b) => COLLATOR.compare(a.apellido, b.apellido) || COLLATOR.compare(a.nombre, b.nombre)),
    [funcionarios]
  )
  const visibles = useMemo(
    () => (busqueda.trim() ? filtrarFuncionarios(ordenados, busqueda) : ordenados),
    [ordenados, busqueda]
  )
  const opcionesTurno = useMemo(() => {
    const todos = new Set<string>(turnosSugeridos)
    for (const f of funcionarios) if (f.turno) todos.add(f.turno)
    return [...todos].sort((a, b) => COLLATOR.compare(a, b))
  }, [turnosSugeridos, funcionarios])

  // Devuelve el mensaje de error, o null si los datos están bien.
  // `idActual` = el que se está editando (para no marcarlo como duplicado
  // de sí mismo).
  const validar = (datos: FormFuncionario, idActual: string | null): string | null => {
    if (!datos.nombre.trim() || !datos.apellido.trim() || !datos.cargo.trim()) return 'Completa nombres, apellidos y cargo.'
    if (!validarRut(datos.rut)) return 'RUT inválido. Formato esperado XX.XXX.XXX-X.'
    const duplicado = funcionarios.find((f) => f.id !== idActual && normalizarRut(f.rut) === normalizarRut(datos.rut))
    if (duplicado) return `Ya existe un funcionario con ese RUT: ${duplicado.nombre} ${duplicado.apellido}.`
    return null
  }

  const datosLimpios = (datos: FormFuncionario) => ({
    nombre: datos.nombre.trim(),
    apellido: datos.apellido.trim(),
    rut: datos.rut,
    cargo: datos.cargo.trim(),
    turno: datos.turno.trim() || null,
  })

  const agregar = async () => {
    setError(null)
    const mensaje = validar(form, null)
    if (mensaje) return setError(mensaje)

    setGuardando(true)
    try {
      const creado = await db.crearFuncionarioTurno({ ...datosLimpios(form), creado_por: usuario.id })
      onCreado(creado as FuncionarioTurno)
      setForm(FORM_VACIO)
    } catch (err) {
      setError(traducirError(err, 'No se pudo agregar el funcionario'))
    } finally {
      setGuardando(false)
    }
  }

  const empezarEdicion = (f: FuncionarioTurno) => {
    setError(null)
    setEditandoId(f.id)
    setFormEdicion({ nombre: f.nombre, apellido: f.apellido, rut: f.rut, cargo: f.cargo, turno: f.turno ?? '' })
  }

  const guardarEdicion = async () => {
    if (!editandoId) return
    setError(null)
    const mensaje = validar(formEdicion, editandoId)
    if (mensaje) return setError(mensaje)

    setGuardando(true)
    try {
      const actualizado = await db.actualizarFuncionarioTurno(editandoId, datosLimpios(formEdicion))
      onActualizado(actualizado as FuncionarioTurno)
      setEditandoId(null)
    } catch (err) {
      setError(traducirError(err, 'No se pudo guardar el funcionario'))
    } finally {
      setGuardando(false)
    }
  }

  const eliminar = async (f: FuncionarioTurno) => {
    const ok = window.confirm(
      `¿Eliminar a ${f.nombre} ${f.apellido} del directorio? No afecta a los turnos ni a las subidas/bajadas donde ya está asignado.`
    )
    if (!ok) return
    setError(null)
    setEliminandoId(f.id)
    try {
      await db.eliminarFuncionarioTurno(f.id)
      onEliminado(f.id)
    } catch (err) {
      setError(traducirError(err, 'No se pudo eliminar el funcionario'))
    } finally {
      setEliminandoId(null)
    }
  }

  const campoForm = (
    etiqueta: string,
    valor: string,
    alCambiar: (v: string) => void,
    opciones?: { placeholder?: string; lista?: string }
  ) => (
    <div>
      <label className="block text-[11px] text-slate-500 mb-1">{etiqueta}</label>
      <input
        type="text"
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        placeholder={opciones?.placeholder}
        list={opciones?.lista}
        className={CLASE_INPUT}
      />
    </div>
  )

  return (
    <div className="px-4 sm:px-6 py-4 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex-1 min-w-[220px] max-w-md">
          <label className="block text-[11px] text-slate-500 mb-1">Buscar en el directorio</label>
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Nombre, apellido, RUT, cargo o turno…"
            className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {busqueda.trim() ? `${visibles.length} de ${funcionarios.length}` : funcionarios.length} funcionario{funcionarios.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            onClick={() => {
              setAgregando((v) => !v)
              setError(null)
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            {agregando ? 'Cerrar' : '+ Agregar funcionario'}
          </button>
        </div>
      </div>

      {agregando && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-3">
          <span className="text-xs font-semibold text-blue-800 uppercase">Nuevo funcionario</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {campoForm('Nombres', form.nombre, (v) => setForm((p) => ({ ...p, nombre: v })))}
            {campoForm('Apellidos', form.apellido, (v) => setForm((p) => ({ ...p, apellido: v })))}
            {campoForm('RUT', form.rut, (v) => setForm((p) => ({ ...p, rut: formatearRut(v) })), { placeholder: '12.345.678-9' })}
            {campoForm('Cargo', form.cargo, (v) => setForm((p) => ({ ...p, cargo: v })))}
            {campoForm('Turno', form.turno, (v) => setForm((p) => ({ ...p, turno: v })), { placeholder: 'Opcional', lista: 'turnos-sugeridos-funcionarios' })}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={agregar}
              disabled={guardando}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
            >
              {guardando && editandoId === null ? 'Agregando…' : 'Agregar al directorio'}
            </button>
          </div>
        </div>
      )}

      {funcionarios.length > 0 && (
        <div className="border border-slate-200 rounded-lg">
          <button
            type="button"
            onClick={() => setMostrarResumen((v) => !v)}
            aria-expanded={mostrarResumen}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 w-full px-3 py-2 bg-slate-50 hover:bg-slate-100 text-left rounded-lg select-none"
          >
            <span className="text-slate-400 text-xs w-3 flex-shrink-0">{mostrarResumen ? '▾' : '▸'}</span>
            <span className="text-xs font-bold text-slate-700">📊 Resumen de cargos</span>
            <span className="text-[10px] font-medium text-slate-500 bg-white border border-slate-200 rounded-full px-2 py-0.5">
              {resumen.porCargo.length} {resumen.porCargo.length === 1 ? 'cargo' : 'cargos'} · {cantidadTurnos}{' '}
              {cantidadTurnos === 1 ? 'turno' : 'turnos'}
            </span>
          </button>
          {mostrarResumen && (
            <div className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              <TarjetaCargos titulo="Total por cargo" total={resumen.total} cargos={resumen.porCargo} destacada />
              {resumen.porTurno.map((t) => (
                <TarjetaCargos key={t.turno ?? 'sin-turno'} titulo={t.turno ?? 'Sin turno'} total={t.total} cargos={t.cargos} />
              ))}
            </div>
          )}
        </div>
      )}

      <datalist id="turnos-sugeridos-funcionarios">
        {opcionesTurno.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      {cargando && funcionarios.length === 0 ? (
        <p className="text-sm text-slate-500 py-10 text-center">Cargando…</p>
      ) : funcionarios.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-slate-500">El directorio está vacío.</p>
          <p className="text-xs text-slate-400 mt-1">Agrega funcionarios con "+ Agregar funcionario" (o corre add_funcionarios_turno.sql para cargar los que ya existen en los turnos).</p>
        </div>
      ) : visibles.length === 0 ? (
        <p className="text-sm text-slate-500 py-10 text-center">Ningún funcionario coincide con "{busqueda}".</p>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-slate-400 uppercase text-[10px] border-b border-slate-200 bg-slate-50">
                <th className="text-left font-semibold px-3 py-2">Nombres</th>
                <th className="text-left font-semibold px-3 py-2">Apellidos</th>
                <th className="text-left font-semibold px-3 py-2">RUT</th>
                <th className="text-left font-semibold px-3 py-2">Cargo</th>
                <th className="text-left font-semibold px-3 py-2">Turno</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibles.map((f) =>
                editandoId === f.id ? (
                  <tr key={f.id} className="bg-blue-50/40">
                    <td className="px-3 py-1.5">
                      <input type="text" value={formEdicion.nombre} onChange={(e) => setFormEdicion((p) => ({ ...p, nombre: e.target.value }))} className={CLASE_INPUT} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="text" value={formEdicion.apellido} onChange={(e) => setFormEdicion((p) => ({ ...p, apellido: e.target.value }))} className={CLASE_INPUT} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="text" value={formEdicion.rut} onChange={(e) => setFormEdicion((p) => ({ ...p, rut: formatearRut(e.target.value) }))} className={CLASE_INPUT} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="text" value={formEdicion.cargo} onChange={(e) => setFormEdicion((p) => ({ ...p, cargo: e.target.value }))} className={CLASE_INPUT} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={formEdicion.turno}
                        list="turnos-sugeridos-funcionarios"
                        onChange={(e) => setFormEdicion((p) => ({ ...p, turno: e.target.value }))}
                        className={CLASE_INPUT}
                      />
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={guardarEdicion}
                        disabled={guardando}
                        className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                      >
                        {guardando ? '…' : 'Guardar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditandoId(null)
                          setError(null)
                        }}
                        className="ml-1 px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
                      >
                        Cancelar
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={f.id}>
                    <td className="px-3 py-1.5 text-slate-800 whitespace-nowrap">{f.nombre}</td>
                    <td className="px-3 py-1.5 text-slate-800 whitespace-nowrap">{f.apellido}</td>
                    <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{f.rut}</td>
                    <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{f.cargo}</td>
                    <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{f.turno || '—'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-right">
                      <button type="button" onClick={() => empezarEdicion(f)} title="Editar" className="p-1 hover:bg-slate-100 rounded text-blue-600">
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => eliminar(f)}
                        disabled={eliminandoId === f.id}
                        title="Eliminar del directorio"
                        className="p-1 hover:bg-slate-100 rounded text-red-600 disabled:opacity-50"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
