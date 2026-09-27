import { useEffect, useMemo, useState } from 'react'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { formatearFechaCorta } from '@lib/formato'
import { Camioneta, DocumentoVencimiento, Usuario } from '@/types/index'
import { agruparVencimientosPorMes, VencimientoConUrgencia } from './lib/urgencia'
import { ModalAgregarCamioneta } from './ModalAgregarCamioneta'
import { ModalAgregarVencimiento, FuncionarioOption } from './ModalAgregarVencimiento'

interface VencimientosProps {
  usuario: Usuario
}

type FiltroTipo = 'todos' | 'funcionario' | 'camioneta'

const OPCIONES_FILTRO: { valor: FiltroTipo; etiqueta: string }[] = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'funcionario', etiqueta: 'Funcionario' },
  { valor: 'camioneta', etiqueta: 'Camioneta' },
]

const ESTILO_URGENCIA: Record<VencimientoConUrgencia['urgencia'], { punto: string; texto: string }> = {
  critico: { punto: 'bg-rose-500', texto: 'text-rose-600' },
  alerta: { punto: 'bg-amber-500', texto: 'text-amber-600' },
  normal: { punto: 'bg-blue-500', texto: 'text-slate-500' },
}

function etiquetaDias(dias: number): string {
  if (dias < 0) return `Vencido hace ${Math.abs(dias)} día${Math.abs(dias) === 1 ? '' : 's'}`
  if (dias === 0) return 'Vence hoy'
  return `Vence en ${dias} día${dias === 1 ? '' : 's'}`
}

// Módulo "Control de Vencimientos" — pedido explícito 2026-09-27. Rastrea
// documentos con fecha de vencimiento (licencia, examen ocupacional,
// revisión técnica, SOAP…) de dos tipos de entidad: funcionarios (mismo
// listado que Organizador de Turnos — ver ModalAgregarVencimiento) y
// camionetas (CRUD propio de este módulo). Solo coordinador.
export const Vencimientos = ({ usuario }: VencimientosProps) => {
  const [documentos, setDocumentos] = useState<DocumentoVencimiento[]>([])
  const [camionetas, setCamionetas] = useState<Camioneta[]>([])
  const [funcionarios, setFuncionarios] = useState<FuncionarioOption[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [mostrarModalCamioneta, setMostrarModalCamioneta] = useState(false)
  const [mostrarModalVencimiento, setMostrarModalVencimiento] = useState(false)
  const [eliminandoId, setEliminandoId] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<FiltroTipo>('todos')

  const cargar = async () => {
    setCargando(true)
    setError(null)
    try {
      const [documentosData, camionetasData, cuadrillasData] = await Promise.all([
        db.obtenerDocumentosVencimiento(),
        db.obtenerCamionetas(),
        db.obtenerCuadrillasTurno(),
      ])
      setDocumentos(documentosData as DocumentoVencimiento[])
      setCamionetas(camionetasData as Camioneta[])
      setFuncionarios(
        (cuadrillasData as any[]).flatMap((c) =>
          (c.trabajadores ?? []).map((t: any) => ({ id: t.id, nombre: t.nombre, apellido: t.apellido, rut: t.rut }))
        )
      )
    } catch (err) {
      setError(traducirError(err, 'No se pudieron cargar los vencimientos'))
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  const documentosFiltrados = useMemo(() => {
    if (filtro === 'funcionario') return documentos.filter((d) => d.funcionario_id !== null)
    if (filtro === 'camioneta') return documentos.filter((d) => d.camioneta_id !== null)
    return documentos
  }, [documentos, filtro])

  const grupos = useMemo(() => agruparVencimientosPorMes(documentosFiltrados), [documentosFiltrados])
  const criticos = useMemo(() => grupos.reduce((acc, g) => acc + g.items.filter((i) => i.urgencia === 'critico').length, 0), [grupos])

  const eliminarVencimiento = async (id: string) => {
    if (!window.confirm('¿Eliminar este vencimiento? Esta acción no se puede deshacer.')) return
    setEliminandoId(id)
    try {
      await db.eliminarDocumentoVencimiento(id)
      setDocumentos((prev) => prev.filter((d) => d.id !== id))
    } catch (err) {
      setError(traducirError(err, 'No se pudo eliminar el vencimiento'))
    } finally {
      setEliminandoId(null)
    }
  }

  const eliminarCamioneta = async (id: string) => {
    if (!window.confirm('¿Eliminar esta camioneta? También se eliminan sus vencimientos registrados.')) return
    try {
      await db.eliminarCamioneta(id)
      setCamionetas((prev) => prev.filter((c) => c.id !== id))
      setDocumentos((prev) => prev.filter((d) => d.camioneta_id !== id))
    } catch (err) {
      setError(traducirError(err, 'No se pudo eliminar la camioneta'))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Control de Vencimientos</h2>
          <p className="text-sm text-slate-500">Licencias, exámenes y documentos de funcionarios y camionetas.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setMostrarModalCamioneta(true)}
            className="px-3 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50"
          >
            + Camioneta
          </button>
          <button
            onClick={() => setMostrarModalVencimiento(true)}
            className="px-3 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700"
          >
            + Vencimiento
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

      {!cargando && documentos.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-4 flex items-center gap-3">
          <span className="text-2xl">🔴</span>
          <div>
            <p className="text-2xl font-bold text-slate-900">{criticos}</p>
            <p className="text-sm text-slate-500">vencido{criticos === 1 ? '' : 's'} o por vencer en los próximos 7 días</p>
          </div>
        </div>
      )}

      {camionetas.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Camionetas</h3>
          <div className="flex flex-wrap gap-2">
            {camionetas.map((c) => (
              <div key={c.id} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
                <span className="font-mono font-semibold text-slate-700">{c.patente}</span>
                {c.modelo && <span className="text-slate-500">{c.modelo}</span>}
                <button type="button" onClick={() => eliminarCamioneta(c.id)} className="text-red-600 hover:text-red-700 text-xs" title="Eliminar camioneta">
                  🗑
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!cargando && documentos.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h3 className="text-base font-semibold text-slate-900 tracking-tight">Vencimientos</h3>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600">
              {documentosFiltrados.length} registro{documentosFiltrados.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200/60 text-xs self-start sm:self-auto">
            {OPCIONES_FILTRO.map((opcion) => (
              <button
                key={opcion.valor}
                type="button"
                onClick={() => setFiltro(opcion.valor)}
                className={`px-3 py-1 rounded-md font-medium text-xs transition-all ${
                  filtro === opcion.valor ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opcion.etiqueta}
              </button>
            ))}
          </div>
        </div>
      )}

      {cargando ? (
        <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">Cargando…</div>
      ) : grupos.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
          {documentos.length === 0 ? 'No hay vencimientos registrados todavía.' : 'No hay vencimientos para este filtro.'}
        </div>
      ) : (
        <div className="space-y-4">
          {grupos.map((grupo) => (
            <div key={grupo.mesAnio} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <h3 className="text-base font-semibold text-slate-900 tracking-tight">{grupo.etiqueta}</h3>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                  {grupo.items.length} registro{grupo.items.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-rose-50/50 text-[11px] font-semibold text-slate-500 tracking-wider uppercase border-b border-rose-100/60">
                      <th scope="col" className="py-2.5 pl-4 pr-1 w-6"></th>
                      <th scope="col" className="py-2.5 px-3">Sujeto / Identificador</th>
                      <th scope="col" className="py-2.5 px-3">Trámite</th>
                      <th scope="col" className="py-2.5 px-3">Vencimiento</th>
                      <th scope="col" className="py-2.5 pr-4 pl-1 text-right w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rose-100/40 bg-white">
                    {grupo.items.map((item) => {
                      const estilo = ESTILO_URGENCIA[item.urgencia]
                      return (
                        <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3 pl-4 pr-1 align-top">
                            <span className={`inline-block w-2.5 h-2.5 rounded-full shadow-sm mt-1 ${estilo.punto}`} />
                          </td>
                          <td className="py-3 px-3 align-top">
                            {item.funcionario ? (
                              <>
                                <div className="font-semibold text-slate-900 leading-snug">
                                  {item.funcionario.nombre} {item.funcionario.apellido}
                                </div>
                                <div className="text-[11px] text-slate-500 mt-0.5">{item.funcionario.rut}</div>
                              </>
                            ) : (
                              <div className="font-semibold text-slate-900 tracking-wide font-mono text-xs">
                                {item.camioneta?.patente}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 align-top">
                            <span className="inline-block px-2 py-0.5 rounded border border-slate-200 bg-white text-slate-700 text-[11px] font-medium">
                              {item.nombre_documento}
                            </span>
                          </td>
                          <td className="py-3 px-3 align-top whitespace-nowrap">
                            <div className="text-slate-700 font-medium">{formatearFechaCorta(item.fecha_vencimiento)}</div>
                            <div className={`text-[11px] font-medium ${estilo.texto}`}>{etiquetaDias(item.dias)}</div>
                          </td>
                          <td className="py-3 pr-4 pl-1 align-top text-right">
                            <button
                              type="button"
                              onClick={() => eliminarVencimiento(item.id)}
                              disabled={eliminandoId === item.id}
                              className="text-rose-400 hover:text-rose-600 p-1 transition-colors disabled:opacity-50"
                              title="Eliminar vencimiento"
                            >
                              🗑
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {mostrarModalCamioneta && (
        <ModalAgregarCamioneta
          usuario={usuario}
          onCerrar={() => setMostrarModalCamioneta(false)}
          onCreada={(camioneta) => {
            setCamionetas((prev) => [...prev, camioneta].sort((a, b) => a.patente.localeCompare(b.patente)))
            setMostrarModalCamioneta(false)
          }}
        />
      )}

      {mostrarModalVencimiento && (
        <ModalAgregarVencimiento
          usuario={usuario}
          funcionarios={funcionarios}
          camionetas={camionetas}
          onCerrar={() => setMostrarModalVencimiento(false)}
          onCreado={() => {
            setMostrarModalVencimiento(false)
            cargar()
          }}
        />
      )}
    </div>
  )
}
