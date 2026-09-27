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

const ESTILO_URGENCIA: Record<VencimientoConUrgencia['urgencia'], { punto: string; fila: string; texto: string }> = {
  critico: { punto: '🔴', fila: 'bg-red-50', texto: 'text-red-700' },
  alerta: { punto: '🟡', fila: 'bg-amber-50', texto: 'text-amber-700' },
  normal: { punto: '🔵', fila: 'bg-white', texto: 'text-slate-500' },
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

  const grupos = useMemo(() => agruparVencimientosPorMes(documentos), [documentos])
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

  const nombreEntidad = (item: DocumentoVencimiento) =>
    item.funcionario
      ? `${item.funcionario.nombre} ${item.funcionario.apellido} — ${item.funcionario.rut}`
      : item.camioneta
        ? `${item.camioneta.patente}${item.camioneta.modelo ? ` — ${item.camioneta.modelo}` : ''}`
        : '—'

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

      {cargando ? (
        <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">Cargando…</div>
      ) : grupos.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
          No hay vencimientos registrados todavía.
        </div>
      ) : (
        <div className="space-y-4">
          {grupos.map((grupo) => (
            <div key={grupo.mesAnio} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 border-b border-slate-200 px-4 py-2">
                <h3 className="text-sm font-bold text-slate-700">{grupo.etiqueta}</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {grupo.items.map((item) => {
                  const estilo = ESTILO_URGENCIA[item.urgencia]
                  return (
                    <div key={item.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${estilo.fila}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-lg flex-shrink-0">{estilo.punto}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{item.nombre_documento}</p>
                          <p className="text-xs text-slate-500 truncate">{nombreEntidad(item)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="text-right">
                          <p className="text-sm text-slate-700">{formatearFechaCorta(item.fecha_vencimiento)}</p>
                          <p className={`text-xs font-medium ${estilo.texto}`}>{etiquetaDias(item.dias)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => eliminarVencimiento(item.id)}
                          disabled={eliminandoId === item.id}
                          className="text-red-600 hover:text-red-700 text-sm disabled:opacity-50"
                          title="Eliminar vencimiento"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  )
                })}
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
