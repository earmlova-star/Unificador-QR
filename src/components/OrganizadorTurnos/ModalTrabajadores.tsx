import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { traducirError } from '@lib/errores'
import { FuncionarioTurno } from '@/types/index'
import { validarRut, formatearRut } from './lib/rut'
import { parsearTrabajadoresMasivo } from './lib/parseoMasivo'
import { fechaLocalISO } from './lib/bajasTrabajadores'
import { BuscadorFuncionario } from './BuscadorFuncionario'

export interface PersonaViajeEditable {
  id: string
  nombre: string
  apellido: string
  rut: string
  cargo: string
  // Solo los trabajadores de un turno la tienen (baja con fecha, pedido
  // explícito 2026-10-03): último día que siguen en el turno.
  fecha_baja?: string | null
}

interface ModalTrabajadoresProps {
  titulo: string
  trabajadores: PersonaViajeEditable[]
  // Si viene, "Agregar nuevo funcionario" suma un buscador con
  // autocompletado sobre este directorio (pedido explícito 2026-10-02,
  // por ahora solo lo pasan las subidas/bajadas sueltas).
  funcionariosDirectorio?: FuncionarioTurno[]
  onCerrar: () => void
  onAgregarUno: (datos: Omit<PersonaViajeEditable, 'id'>) => Promise<PersonaViajeEditable>
  onAgregarMasivo: (lista: Omit<PersonaViajeEditable, 'id'>[]) => Promise<PersonaViajeEditable[]>
  onGuardarEdiciones: (cambiados: PersonaViajeEditable[]) => Promise<void>
  // Borra al trabajador para siempre (y, en turnos, sus reservas de pasajes
  // y vencimientos — ver darDeBajaTrabajadorCuadrilla en supabase.ts).
  onEliminar: (id: string) => Promise<void>
  // Baja con fecha (pedido explícito 2026-10-03): si vienen, el botón
  // principal de cada trabajador pasa a ser "Dar de baja" (conserva sus
  // reservas anteriores) y "Eliminar definitivamente" queda en la sección
  // "Dados de baja". Solo las pasan los turnos; las subidas/bajadas sueltas
  // siguen eliminando directo, como antes.
  onDarDeBaja?: (id: string, fechaISO: string) => Promise<void>
  onReintegrar?: (id: string) => Promise<void>
}

function trabajadorCambio(a: PersonaViajeEditable, b: PersonaViajeEditable): boolean {
  return a.nombre !== b.nombre || a.apellido !== b.apellido || a.rut !== b.rut || a.cargo !== b.cargo
}

// Modal genérico de trabajadores — pedido explícito 2026-09-30: al abrirlo
// se ve primero una lista de solo lectura de todos los trabajadores; el
// botón "Editar" recién ahí muestra la edición en línea + alta + baja +
// pegado masivo (igual que tenía antes ModalEditarTurno para cuadrillas,
// ahora compartido también con las subidas/bajadas sueltas, que no tenían
// nada de esto — solo alta). Agregar/eliminar es inmediato contra la base;
// los cambios de texto en filas existentes quedan solo en este estado
// local hasta "Guardar cambios", para no golpear la base con un request
// por cada tecla.
export const ModalTrabajadores = ({
  titulo,
  trabajadores,
  funcionariosDirectorio,
  onCerrar,
  onAgregarUno,
  onAgregarMasivo,
  onGuardarEdiciones,
  onEliminar,
  onDarDeBaja,
  onReintegrar,
}: ModalTrabajadoresProps) => {
  const [modoEdicion, setModoEdicion] = useState(false)
  const [trabajadoresLocal, setTrabajadoresLocal] = useState(trabajadores)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoApellido, setNuevoApellido] = useState('')
  const [nuevoRut, setNuevoRut] = useState('')
  const [nuevoCargo, setNuevoCargo] = useState('')
  const [mostrarPegado, setMostrarPegado] = useState(false)
  const [textoMasivo, setTextoMasivo] = useState('')
  const [agregandoMasivo, setAgregandoMasivo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [eliminandoId, setEliminandoId] = useState<string | null>(null)
  // Baja con fecha: a quién se le está pidiendo la fecha, y qué fecha.
  const [bajaEnCursoId, setBajaEnCursoId] = useState<string | null>(null)
  const [fechaBaja, setFechaBaja] = useState(() => fechaLocalISO())
  const [procesandoBajaId, setProcesandoBajaId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { validos: masivoValidos, errores: masivoErrores } = parsearTrabajadoresMasivo(textoMasivo)

  const soportaBaja = Boolean(onDarDeBaja)
  const hoy = fechaLocalISO()
  // Con baja = tiene fecha_baja (aunque sea futura: "se va el viernes").
  const activos = trabajadoresLocal.filter((t) => !t.fecha_baja)
  const dadosDeBaja = trabajadoresLocal.filter((t) => t.fecha_baja)
  const activosLectura = trabajadores.filter((t) => !t.fecha_baja)
  const dadosDeBajaLectura = trabajadores.filter((t) => t.fecha_baja)

  const entrarAEditar = () => {
    setTrabajadoresLocal(trabajadores)
    setModoEdicion(true)
  }

  const cancelarEdicion = () => {
    setTrabajadoresLocal(trabajadores)
    setError(null)
    setModoEdicion(false)
  }

  const actualizarLocal = (id: string, campo: 'nombre' | 'apellido' | 'rut' | 'cargo', valor: string) => {
    setTrabajadoresLocal((prev) => prev.map((t) => (t.id === id ? { ...t, [campo]: campo === 'rut' ? formatearRut(valor) : valor } : t)))
  }

  const eliminar = async (id: string) => {
    setError(null)
    setEliminandoId(id)
    try {
      await onEliminar(id)
      setTrabajadoresLocal((prev) => prev.filter((t) => t.id !== id))
    } catch (err) {
      setError(traducirError(err, 'No se pudo eliminar el funcionario'))
    } finally {
      setEliminandoId(null)
    }
  }

  const abrirBaja = (id: string) => {
    setError(null)
    setFechaBaja(fechaLocalISO())
    setBajaEnCursoId(id)
  }

  const confirmarBaja = async (id: string) => {
    if (!onDarDeBaja) return
    if (!fechaBaja) return setError('Elige la fecha de baja.')
    setError(null)
    setProcesandoBajaId(id)
    try {
      await onDarDeBaja(id, fechaBaja)
      setTrabajadoresLocal((prev) => prev.map((t) => (t.id === id ? { ...t, fecha_baja: fechaBaja } : t)))
      setBajaEnCursoId(null)
    } catch (err) {
      setError(traducirError(err, 'No se pudo dar de baja al funcionario'))
    } finally {
      setProcesandoBajaId(null)
    }
  }

  const reintegrar = async (id: string) => {
    if (!onReintegrar) return
    setError(null)
    setProcesandoBajaId(id)
    try {
      await onReintegrar(id)
      setTrabajadoresLocal((prev) => prev.map((t) => (t.id === id ? { ...t, fecha_baja: null } : t)))
    } catch (err) {
      setError(traducirError(err, 'No se pudo reintegrar al funcionario'))
    } finally {
      setProcesandoBajaId(null)
    }
  }

  const eliminarDefinitivamente = async (t: PersonaViajeEditable) => {
    const ok = window.confirm(
      `¿Eliminar definitivamente a ${t.nombre} ${t.apellido}? Se borran también todas sus reservas de pasajes y sus vencimientos, y no se puede deshacer. Si solo salió del turno, déjalo dado de baja: así sus reservas anteriores se conservan.`
    )
    if (!ok) return
    await eliminar(t.id)
  }

  const agregarUno = async () => {
    setError(null)
    if (!nuevoNombre.trim() || !nuevoApellido.trim() || !nuevoCargo.trim()) return setError('Completa nombre, apellido y cargo del nuevo funcionario.')
    if (!validarRut(nuevoRut)) return setError('RUT inválido. Formato esperado XX.XXX.XXX-X.')

    try {
      const t = await onAgregarUno({ nombre: nuevoNombre.trim(), apellido: nuevoApellido.trim(), rut: nuevoRut, cargo: nuevoCargo.trim() })
      setTrabajadoresLocal((prev) => [...prev, t])
      setNuevoNombre(''); setNuevoApellido(''); setNuevoRut(''); setNuevoCargo('')
    } catch (err) {
      setError(traducirError(err, 'No se pudo agregar el funcionario'))
    }
  }

  const agregarDesdePegado = async () => {
    if (masivoValidos.length === 0 || masivoErrores.length > 0) return
    setError(null)
    setAgregandoMasivo(true)
    try {
      const nuevos = await onAgregarMasivo(masivoValidos)
      setTrabajadoresLocal((prev) => [...prev, ...nuevos])
      setTextoMasivo('')
      setMostrarPegado(false)
    } catch (err) {
      setError(traducirError(err, 'No se pudieron agregar los funcionarios'))
    } finally {
      setAgregandoMasivo(false)
    }
  }

  const guardarEdiciones = async () => {
    setError(null)
    // Los dados de baja no se editan (ni se validan): solo los activos.
    for (const t of activos) {
      if (!t.nombre.trim() || !t.apellido.trim() || !t.cargo.trim()) return setError('Completa nombre, apellido y cargo de cada funcionario.')
      if (!validarRut(t.rut)) return setError(`RUT inválido: ${t.rut}.`)
    }
    const cambiados = activos.filter((t) => {
      const original = trabajadores.find((o) => o.id === t.id)
      return original && trabajadorCambio(original, t)
    })
    setGuardando(true)
    try {
      if (cambiados.length > 0) await onGuardarEdiciones(cambiados)
      setModoEdicion(false)
    } catch (err) {
      setError(traducirError(err, 'No se pudieron guardar los cambios'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white rounded-lg shadow-xl z-50 p-6 max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-1">
            <Dialog.Title className="text-lg font-bold text-slate-900">{titulo}</Dialog.Title>
            {!modoEdicion && (
              <button
                type="button"
                onClick={entrarAEditar}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold flex-shrink-0"
              >
                ✎ Editar
              </button>
            )}
          </div>

          {!modoEdicion ? (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                {activosLectura.length} trabajador{activosLectura.length === 1 ? '' : 'es'}
                {dadosDeBajaLectura.length > 0 && ` · ${dadosDeBajaLectura.length} con baja`}
              </p>
              {trabajadores.length === 0 ? (
                <p className="text-sm text-slate-400">Sin trabajadores asignados todavía.</p>
              ) : (
                <>
                  {activosLectura.length === 0 ? (
                    <p className="text-sm text-slate-400">Ningún trabajador activo.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="text-slate-400 uppercase text-[10px] border-b border-slate-200">
                            <th className="font-semibold pr-4 pb-1.5">Nombre</th>
                            <th className="font-semibold pr-4 pb-1.5">RUT</th>
                            <th className="font-semibold pb-1.5">Cargo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {activosLectura.map((t) => (
                            <tr key={t.id}>
                              <td className="pr-4 py-1.5 text-slate-800">{t.nombre} {t.apellido}</td>
                              <td className="pr-4 py-1.5 text-slate-600">{t.rut}</td>
                              <td className="py-1.5 text-slate-600">{t.cargo}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {dadosDeBajaLectura.length > 0 && (
                    <div className="overflow-x-auto">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Con baja</p>
                      <table className="w-full text-xs text-left">
                        <tbody className="divide-y divide-slate-100">
                          {dadosDeBajaLectura.map((t) => (
                            <tr key={t.id} className="text-slate-500">
                              <td className="pr-4 py-1.5">{t.nombre} {t.apellido}</td>
                              <td className="pr-4 py-1.5">{t.rut}</td>
                              <td className="py-1.5 whitespace-nowrap">Baja el {t.fecha_baja}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              <div className="flex justify-end pt-2 border-t border-slate-200">
                <Dialog.Close asChild>
                  <button type="button" className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">
                    Cerrar
                  </button>
                </Dialog.Close>
              </div>
            </div>
          ) : (
            <div className="space-y-4 mt-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-500 uppercase">Funcionarios</label>
                <button
                  type="button"
                  onClick={() => setMostrarPegado((v) => !v)}
                  className={`text-xs px-2 py-1 rounded-lg transition-colors ${mostrarPegado ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                >
                  ⚡ Pegar lista
                </button>
              </div>

              {mostrarPegado && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 space-y-2">
                  <textarea
                    value={textoMasivo}
                    onChange={(e) => setTextoMasivo(e.target.value)}
                    rows={5}
                    placeholder={'Pega desde Excel, una persona por línea — Nombre completo, RUT, Cargo:\n\nJuan Pérez González\t12.345.678-9\tCapataz'}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs font-mono focus:outline-none focus:border-blue-600"
                  />
                  {textoMasivo.trim() && masivoErrores.length > 0 && (
                    <div className="text-xs bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 space-y-0.5">
                      {masivoErrores.map((e) => (
                        <p key={e.linea} className="text-red-700">Línea {e.linea}: {e.mensaje}</p>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={agregarDesdePegado}
                      disabled={agregandoMasivo || masivoValidos.length === 0 || masivoErrores.length > 0}
                      className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                    >
                      {agregandoMasivo ? 'Agregando…' : masivoValidos.length > 0 ? `Agregar ${masivoValidos.length}` : 'Agregar'}
                    </button>
                  </div>
                </div>
              )}

              {activos.length === 0 && (
                <p className="text-xs text-slate-400">
                  {dadosDeBaja.length > 0 ? 'Ningún funcionario activo.' : 'Todavía no hay funcionarios asignados.'}
                </p>
              )}

              <div className="space-y-2">
                {activos.map((t) => (
                  <div key={t.id} className="bg-slate-50 border border-slate-200 rounded-lg p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase text-slate-400">Funcionario</span>
                      {soportaBaja ? (
                        <button
                          type="button"
                          onClick={() => (bajaEnCursoId === t.id ? setBajaEnCursoId(null) : abrirBaja(t.id))}
                          title="Sale del turno desde una fecha; sus reservas anteriores se conservan"
                          className="text-xs px-2 py-0.5 rounded border border-amber-300 text-amber-800 hover:bg-amber-50"
                        >
                          Dar de baja
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => eliminar(t.id)}
                          disabled={eliminandoId === t.id}
                          className="text-red-600 hover:text-red-700 text-xs disabled:opacity-50"
                        >
                          🗑
                        </button>
                      )}
                    </div>
                    {soportaBaja && bajaEnCursoId === t.id && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-2">
                        <label className="block text-[11px] text-amber-800">
                          Último día en el turno — sus reservas hasta esa fecha (inclusive) se conservan; después ya no aparece.
                        </label>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="date"
                            value={fechaBaja}
                            onChange={(e) => setFechaBaja(e.target.value)}
                            className="px-2 py-1 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-blue-600"
                          />
                          <button
                            type="button"
                            onClick={() => confirmarBaja(t.id)}
                            disabled={procesandoBajaId === t.id}
                            className="text-xs px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
                          >
                            {procesandoBajaId === t.id ? 'Guardando…' : 'Confirmar baja'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setBajaEnCursoId(null)}
                            className="text-xs px-2.5 py-1 rounded-lg border border-slate-300 text-slate-600 hover:bg-white"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" value={t.nombre} onChange={(e) => actualizarLocal(t.id, 'nombre', e.target.value)} placeholder="Nombre" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                      <input type="text" value={t.apellido} onChange={(e) => actualizarLocal(t.id, 'apellido', e.target.value)} placeholder="Apellido" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" value={t.rut} onChange={(e) => actualizarLocal(t.id, 'rut', e.target.value)} placeholder="RUT" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                      <input type="text" value={t.cargo} onChange={(e) => actualizarLocal(t.id, 'cargo', e.target.value)} placeholder="Cargo" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                    </div>
                  </div>
                ))}
              </div>

              {soportaBaja && dadosDeBaja.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-500 uppercase">Dados de baja ({dadosDeBaja.length})</label>
                  {dadosDeBaja.map((t) => (
                    <div key={t.id} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs min-w-0">
                        <div className="text-slate-700">
                          {t.nombre} {t.apellido} <span className="text-slate-400">· {t.rut}</span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Baja el {t.fecha_baja}
                          {(t.fecha_baja ?? '') >= hoy ? ' (sigue en el turno hasta esa fecha)' : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => reintegrar(t.id)}
                          disabled={procesandoBajaId === t.id}
                          className="text-xs px-2 py-0.5 rounded border border-slate-300 text-slate-700 hover:bg-white disabled:opacity-50"
                        >
                          Reintegrar
                        </button>
                        <button
                          type="button"
                          onClick={() => eliminarDefinitivamente(t)}
                          disabled={eliminandoId === t.id}
                          title="Borra al trabajador y también todas sus reservas de pasajes y vencimientos"
                          className="text-xs px-2 py-0.5 rounded text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Eliminar definitivamente
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-slate-50 border border-dashed border-slate-300 rounded-lg p-2 space-y-2">
                <span className="text-[10px] uppercase text-slate-400">Agregar nuevo funcionario</span>
                {funcionariosDirectorio && (
                  <BuscadorFuncionario
                    funcionarios={funcionariosDirectorio}
                    excluirRuts={trabajadoresLocal.map((t) => t.rut)}
                    onSeleccionar={(f) => {
                      setNuevoNombre(f.nombre)
                      setNuevoApellido(f.apellido)
                      setNuevoRut(formatearRut(f.rut))
                      setNuevoCargo(f.cargo)
                    }}
                  />
                )}
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="Nombre" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                  <input type="text" value={nuevoApellido} onChange={(e) => setNuevoApellido(e.target.value)} placeholder="Apellido" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={nuevoRut} onChange={(e) => setNuevoRut(formatearRut(e.target.value))} placeholder="RUT (12.345.678-9)" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                  <input type="text" value={nuevoCargo} onChange={(e) => setNuevoCargo(e.target.value)} placeholder="Cargo" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600" />
                </div>
                <button type="button" onClick={agregarUno} className="text-xs px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700">
                  + Agregar a la lista
                </button>
              </div>

              {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button type="button" onClick={cancelarEdicion} className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={guardarEdiciones}
                  disabled={guardando}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
                >
                  {guardando ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
