import { createClient } from '@supabase/supabase-js'
import { UserRole, UserStatus, SolicitudCompra, Requisicion, OrdenCompra, GuiaDespacho, Faena } from '@/types/index'
import { acumularCadena, calcularHHReales } from './calculosHH'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

// TODO: una vez estabilizado el esquema, generar tipos reales con
// `supabase gen types typescript` y tipar createClient<Database>(...)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export interface FiltrosDocumentos {
  contrato_id?: string
  estado?: string
  tipo?: string
  creado_por?: string
  /** Cuántas filas traer. Sin esto, la consulta no pagina. */
  limite?: number
  /** Desde qué fila, para "cargar más". */
  desde?: number
}

// ============ AUTH HELPERS ============

export const auth = {
  // Auto-registro: el rol NUNCA lo elige quien se registra — siempre queda
  // en Consultor (el rol de menor privilegio), y solo el Coordinador puede
  // subirlo después desde el panel de Usuarios. Esto se refuerza también a
  // nivel de RLS (ver add_registro_usuarios.sql: el "with check" exige
  // rol='consultor' en el insert), así que no basta con cambiar este código
  // para saltárselo.
  //
  // Devuelve `sesionInmediata: false` si el proyecto de Supabase tiene
  // habilitada la confirmación de correo (no hay sesión hasta que el
  // usuario haga clic en el enlace que le llega por email) — la UI debe
  // mostrar un aviso de "revisa tu correo" en ese caso en vez de intentar
  // continuar como si ya hubiera iniciado sesión.
  async signUp(email: string, password: string, nombre: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // Sin esto, el link del correo de confirmación usa la "Site URL" que
      // esté configurada en el proyecto de Supabase (Authentication > URL
      // Configuration) — que suele quedar en el valor por defecto
      // http://localhost:3000 si nunca se cambió. Pasando el origen actual
      // acá, el link apunta a donde sea que se esté usando la app (el
      // dominio publicado o localhost en desarrollo), siempre que ese
      // origen esté en la lista de "Redirect URLs" permitidas del proyecto.
      options: { emailRedirectTo: window.location.origin },
    })

    if (error) throw error

    if (data.user) {
      const { error: profileError } = await supabase
        .from('usuarios')
        .insert([
          {
            id: data.user.id,
            email,
            nombre,
            rol: UserRole.CONSULTOR,
          },
        ])

      if (profileError) throw profileError
    }

    return { user: data.user, sesionInmediata: data.session !== null }
  },

  async signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) throw error
    return data
  },

  async signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  },

  async getCurrentUser() {
    const { data, error } = await supabase.auth.getUser()
    if (error) throw error
    return data.user
  },

  async getUserProfile(userId: string) {
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) throw error
    return data
  },
}

// ============ STORAGE HELPERS ============

export const storage = {
  async uploadFoto(bucket: string, path: string, file: Blob) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false,
      })

    if (error) throw error
    return data
  },

  async getPublicUrl(bucket: string, path: string) {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path)
    return data.publicUrl
  },

  async deleteFoto(bucket: string, path: string) {
    const { error } = await supabase.storage.from(bucket).remove([path])
    if (error) throw error
  },

  async eliminarArchivos(bucket: string, paths: string[]) {
    if (paths.length === 0) return
    const { error } = await supabase.storage.from(bucket).remove(paths)
    if (error) throw error
  },

  // A diferencia de las fotos/PDF individuales (upsert:false, nunca se sobrescriben),
  // el compilado de un día SÍ debe poder regenerarse y reemplazar la versión anterior.
  async subirCompilado(path: string, file: Blob) {
    const { data, error } = await supabase.storage
      .from('documentos')
      .upload(path, file, { cacheControl: '3600', upsert: true, contentType: 'application/pdf' })

    if (error) throw error
    return data
  },

  // Reemplaza un archivo ya subido en su misma ruta (ej. al girar un
  // documento) — a diferencia de uploadFoto, sí sobrescribe lo que había.
  async reemplazarArchivo(bucket: string, path: string, file: Blob, contentType?: string) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, { cacheControl: '3600', upsert: true, contentType })

    if (error) throw error
    return data
  },
}

// ============ DATABASE HELPERS ============

// Hallazgo QA 2026-09-25: recalcularAcumuladosFaenaSinBloqueo (más abajo)
// lee y reescribe la cadena de acumulados de una faena entera sin ningún
// bloqueo — dos guardados casi simultáneos de la misma faena disparaban dos
// recálculos en paralelo que se pisaban entre sí. adquirir_bloqueo_recalculo_faena
// es un upsert atómico con TTL (ver add_bloqueo_recalculo_faena.sql); si ya
// está tomado, se reintenta con backoff antes de rendirse.
async function esperarBloqueoRecalculoFaena(contratoId: string, faena: Faena): Promise<void> {
  const intentosMax = 8
  let esperaMs = 250
  for (let intento = 0; intento < intentosMax; intento++) {
    const { data, error } = await supabase.rpc('adquirir_bloqueo_recalculo_faena', {
      p_contrato_id: contratoId,
      p_faena: faena,
      p_ttl_segundos: 30,
    })
    if (error) throw error
    if (data === true) return
    await new Promise((resolve) => setTimeout(resolve, esperaMs))
    esperaMs = Math.min(esperaMs * 2, 4000)
  }
  throw new Error(
    'No se pudo recalcular los acumulados: otra persona está guardando un Daily Report de esta faena justo ahora. Intenta de nuevo en unos segundos.'
  )
}

async function recalcularAcumuladosFaenaSinBloqueo(contratoId: string, faena: Faena) {
  const { data, error } = await supabase
    .from('partes_diarios')
    .select('id, mano_obra_directa, mano_obra_indirecta, maquinaria, hh_directas_acumuladas, hm_acumuladas, hh_indirectas_acumuladas')
    .eq('contrato_id', contratoId)
    .eq('faena', faena)
    .order('numero_reporte', { ascending: true })

  if (error) throw error
  if (!data || data.length === 0) return

  const reales = data.map((p) => calcularHHReales(p, faena))
  const cadena = acumularCadena(reales)

  for (let i = 0; i < data.length; i++) {
    const p = data[i]
    const acc = cadena[i]
    const sinCambios =
      (p.hh_directas_acumuladas ?? 0) === acc.directas &&
      (p.hm_acumuladas ?? 0) === acc.hm &&
      (p.hh_indirectas_acumuladas ?? 0) === acc.indirectas

    if (sinCambios) continue

    const { error: errorUpdate } = await supabase
      .from('partes_diarios')
      .update({
        hh_directas_acumuladas: acc.directas,
        hm_acumuladas: acc.hm,
        hh_indirectas_acumuladas: acc.indirectas,
      })
      .eq('id', p.id)

    if (errorUpdate) throw errorUpdate
  }
}

export const db = {
  // Devuelve la siguiente secuencia diaria (1, 2, 3...) para nombrar PDFs,
  // única entre TODOS los usuarios que suban documentos ese día para ese contrato.
  // El incremento es atómico en el servidor (ver migración obtener_siguiente_secuencia_pdf).
  async obtenerSiguienteSecuenciaPDF(contratoId: string, fecha: Date): Promise<number> {
    const fechaISO = fecha.toISOString().slice(0, 10) // YYYY-MM-DD

    const { data, error } = await supabase.rpc('obtener_siguiente_secuencia_pdf', {
      p_contrato_id: contratoId,
      p_fecha: fechaISO,
    })

    if (error) throw error
    return data as number
  },

  // Usuarios (gestión de roles, panel del Coordinador — usa las políticas
  // "coordinador_ver_usuarios"/"coordinador_actualizar_usuarios" de RLS)
  async obtenerUsuarios() {
    const { data, error } = await supabase.from('usuarios').select('*').order('nombre')
    if (error) throw error
    return data
  },

  async actualizarRolUsuario(id: string, rol: UserRole) {
    const { data, error } = await supabase
      .from('usuarios')
      .update({ rol })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Hallazgo QA 2026-09-25: `usuario_rol_actual()` devuelve NULL para
  // cualquier usuario con estado != 'activo', lo que bloquea en silencio
  // TODAS las políticas basadas en rol de la app entera — no solo un
  // módulo. Antes no había ninguna forma de reactivar un usuario desde la
  // UI (había que correr SQL a mano, ver activar_jonathan_cayul.sql); esto
  // le da a Gestión de Usuarios el mismo permiso que ya tenía para el rol
  // (RLS "coordinador_actualizar_usuarios" ya permite tocar cualquier
  // columna, incluida `estado` — no hace falta ninguna política nueva).
  async actualizarEstadoUsuario(id: string, estado: UserStatus) {
    const { data, error } = await supabase
      .from('usuarios')
      .update({ estado })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Crea la fila de perfil para un usuario que el Coordinador ya creó en
  // Supabase (Authentication > Users) — Supabase Auth por sí solo no crea
  // esta fila, así que sin este paso ese usuario no puede usar la app. El
  // `id` debe ser el UID que Supabase le asignó a esa cuenta. Usa la
  // política RLS "coordinador_crear_usuarios" ya existente (permite insertar
  // cualquier fila, con cualquier rol, solo si quien llama es Coordinador).
  async crearUsuario(usuario: { id: string; nombre: string; email: string; rol: UserRole }) {
    const { data, error } = await supabase.from('usuarios').insert([usuario]).select().single()
    if (error) throw error
    return data
  },

  // Contratos
  async getContratoActivo() {
    const { data, error } = await supabase
      .from('contratos')
      .select('*')
      .eq('estado', 'activo')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error && error.code !== 'PGRST116') throw error
    return data
  },

  // Documentos
  async crearDocumento(documento: any) {
    const { data, error } = await supabase
      .from('documentos')
      .insert([documento])
      .select()
      .single()

    if (error) throw error
    return data
  },

  async obtenerDocumentos(filtros: FiltrosDocumentos) {
    let query = supabase
      .from('documentos')
      .select('*, usuario_creador:creado_por(nombre, email, rol), usuario_aprobador:aprobado_por(nombre, email, rol)')

    // contrato_id: hoy hay un solo contrato activo, así que omitirlo no se
    // nota. En cuanto exista un segundo, sin este filtro el pasillo de
    // revisión y el compilado del día mezclarían documentos de ambos.
    if (filtros.contrato_id) query = query.eq('contrato_id', filtros.contrato_id)
    if (filtros.estado) query = query.eq('estado', filtros.estado)
    if (filtros.tipo) query = query.eq('tipo', filtros.tipo)
    if (filtros.creado_por) query = query.eq('creado_por', filtros.creado_por)

    query = query.order('fecha_creacion', { ascending: false })

    // Paginación opcional: sin límite, estas listas crecen para siempre.
    if (filtros.limite) {
      const desde = filtros.desde ?? 0
      query = query.range(desde, desde + filtros.limite - 1)
    }

    const { data, error } = await query

    if (error) throw error
    return data
  },

  // PER-4: la pantalla de Inicio solo necesita CONTAR. Antes descargaba las
  // dos tablas completas para hacer .filter().length — y un parte diario
  // pesa entre 8 y 15 kB por fila con sus arreglos jsonb. Con head:true no
  // viaja ninguna fila, solo el número, así que el costo deja de crecer con
  // el tiempo. Es la primera pantalla tras el login, la ve todo el mundo en
  // cada sesión.
  async contarDocumentos(filtros: FiltrosDocumentos) {
    let query = supabase.from('documentos').select('id', { count: 'exact', head: true })

    if (filtros.contrato_id) query = query.eq('contrato_id', filtros.contrato_id)
    if (filtros.estado) query = query.eq('estado', filtros.estado)
    if (filtros.creado_por) query = query.eq('creado_por', filtros.creado_por)

    const { count, error } = await query
    if (error) throw error
    return count ?? 0
  },

  async contarPartesDiarios(contratoId: string, estado?: string) {
    let query = supabase
      .from('partes_diarios')
      .select('id', { count: 'exact', head: true })
      .eq('contrato_id', contratoId)

    if (estado) query = query.eq('estado', estado)

    const { count, error } = await query
    if (error) throw error
    return count ?? 0
  },

  async actualizarDocumento(id: string, updates: any) {
    const { data, error } = await supabase
      .from('documentos')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  async eliminarDocumento(id: string) {
    const { error } = await supabase.from('documentos').delete().eq('id', id)
    if (error) throw error
  },

  // Extrae la ruta dentro del bucket a partir de una URL pública de Storage
  // (https://.../storage/v1/object/public/<bucket>/<ruta>), para poder borrar
  // el archivo real, no solo el registro.
  _pathDesdeUrlPublica(url: string, bucket: string): string | null {
    const marcador = `/object/public/${bucket}/`
    const idx = url.indexOf(marcador)
    if (idx === -1) return null
    return decodeURIComponent(url.slice(idx + marcador.length).split('?')[0])
  },

  // Elimina un documento por completo: la foto y el PDF en Storage, y el
  // registro en la base de datos (el historial de auditoría se borra en
  // cascada). Si falla la limpieza de Storage, igual se borra el registro —
  // no queremos que un archivo huérfano bloquee que el documento desaparezca.
  async eliminarDocumentoCompleto(doc: { id: string; foto_url?: string | null; pdf_url?: string | null }) {
    const bucket = 'documentos'
    const paths = [doc.foto_url, doc.pdf_url]
      .map((u) => (u ? db._pathDesdeUrlPublica(u, bucket) : null))
      .filter((p): p is string => !!p)

    if (paths.length > 0) {
      try {
        await storage.eliminarArchivos(bucket, paths)
      } catch (err) {
        console.error('No se pudieron borrar los archivos en Storage:', err)
      }
    }

    const { error } = await supabase.from('documentos').delete().eq('id', doc.id)
    if (error) throw error
  },

  // Invalida el compilado guardado en caché de un día (se usa cuando se borra
  // algún documento de ese día, para que el próximo QR/PDF se regenere sin
  // el documento eliminado en vez de reusar el compilado desactualizado).
  async invalidarCompiladoDia(contratoId: string, fecha: string) {
    const { error } = await supabase
      .from('compilados_dia')
      .delete()
      .eq('contrato_id', contratoId)
      .eq('fecha', fecha)

    if (error) throw error
  },

  // Historial
  async crearHistorial(entrada: any) {
    const { data, error } = await supabase
      .from('historial')
      .insert([entrada])
      .select()
      .single()

    if (error) throw error
    return data
  },

  async obtenerHistorial(documento_id: string) {
    const { data, error } = await supabase
      .from('historial')
      .select('*, usuario:usuario_id(nombre, email)')
      .eq('documento_id', documento_id)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data
  },

  // Caché de compilados por día — evita recompilar/resubir un PDF que ya
  // está al día (ver migración add_cache_compilados.sql)
  async obtenerCompiladosDia(contratoId: string) {
    const { data, error } = await supabase
      .from('compilados_dia')
      .select('*')
      .eq('contrato_id', contratoId)

    if (error) throw error
    return data
  },

  async guardarCompiladoDia(registro: {
    contrato_id: string
    fecha: string
    url: string
    ultima_aprobacion: string
    total_documentos: number
    generado_por?: string | null
  }) {
    const { data, error } = await supabase
      .from('compilados_dia')
      .upsert(registro, { onConflict: 'contrato_id,fecha' })
      .select()
      .single()

    if (error) throw error
    return data
  },

  // ============ PARTE DIARIO ============
  // Tablas separadas de las de Documentos QR (add_partes_diarios.sql) —
  // comparten solo "usuarios" y "contratos". Ver ARQUITECTURA.md.

  // Reserva de verdad el siguiente número (incrementa el contador atómico
  // en secuencias_numero_parte) — llamar SOLO justo antes de crear el
  // Daily Report, nunca para mostrarlo en pantalla mientras se llena el
  // formulario (ver previsualizarSiguienteNumeroParte, y el bug de saltos
  // de correlativo del 2026-09-26 causado por llamar esto al abrir el
  // formulario).
  async obtenerSiguienteNumeroParte(contratoId: string): Promise<number> {
    const { data, error } = await supabase.rpc('obtener_siguiente_numero_parte', {
      p_contrato_id: contratoId,
    })
    if (error) throw error
    return data as number
  },

  // Solo LEE cuál sería el próximo número (sin reservarlo/incrementar nada)
  // — para mostrarlo en el formulario mientras el usuario todavía no decide
  // guardar. El número real se pide recién al guardar, con
  // obtenerSiguienteNumeroParte.
  async previsualizarSiguienteNumeroParte(contratoId: string): Promise<number> {
    const { data, error } = await supabase.rpc('previsualizar_siguiente_numero_parte', {
      p_contrato_id: contratoId,
    })
    if (error) throw error
    return data as number
  },

  // El último parte de la MISMA faena ya trae, en sus columnas
  // *_acumuladas, la suma de todos los anteriores de esa faena — así que
  // el acumulado del parte nuevo es "el de este + lo que traiga este
  // mismo objeto" (ver nota en la migración). Cada faena corre su propia
  // cadena de acumulados en paralelo (ver add_faena_partes_diarios.sql) —
  // por eso el filtro por faena es tan importante acá como el de
  // contrato_id: si tomara el último reporte de la OTRA faena como base,
  // los acumulados de turno saldrían mal calculados.
  async obtenerUltimoParteDiario(contratoId: string, faena: string) {
    // Por número de reporte, no por fecha (ver obtenerPartesDiarios) —
    // acá importa todavía más: si esto tomara el reporte equivocado como
    // "el último", los acumulados de turno del reporte nuevo saldrían
    // mal calculados.
    const { data, error } = await supabase
      .from('partes_diarios')
      .select('hh_directas_acumuladas, hm_acumuladas, hh_indirectas_acumuladas')
      .eq('contrato_id', contratoId)
      .eq('faena', faena)
      .order('numero_reporte', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    return data
  },

  // Recalcula la cadena de *_acumuladas de una faena DESDE CERO, a partir
  // del HH real de cada reporte (calcularHHReales), y guarda solo los
  // reportes cuyo acumulado haya quedado distinto del que ya tenían.
  //
  // Por qué existe: antes, el acumulado de un reporte nuevo se calculaba
  // una sola vez al crearlo (último acumulado + HH de este reporte) y
  // quedaba fijo para siempre — si ese reporte (o cualquier reporte
  // anterior de la misma faena) se editaba después, ese cambio nunca se
  // reflejaba ni en su propio acumulado ni en el de los reportes
  // posteriores, que dependen de él en cadena. Auditoría del 2026-09-07
  // encontró 5 reportes reales desincronizados así, con hasta 141 HH de
  // diferencia entre lo mostrado y la suma real. Este método reemplaza ese
  // cálculo incremental: se llama después de CUALQUIER guardado (crear,
  // editar, o el reintento de crearParteDiario/actualizarParteDiario) y
  // siempre recalcula la cadena completa, así que un reporte editado
  // propaga el cambio a todo lo que viene después automáticamente. Ver
  // ParteDiarioForm.tsx (guardar()) y calculosHH.ts (acumularCadena).
  async recalcularAcumuladosFaena(contratoId: string, faena: Faena) {
    await esperarBloqueoRecalculoFaena(contratoId, faena)
    try {
      await recalcularAcumuladosFaenaSinBloqueo(contratoId, faena)
    } finally {
      const { error } = await supabase.rpc('liberar_bloqueo_recalculo_faena', {
        p_contrato_id: contratoId,
        p_faena: faena,
      })
      if (error) console.error('No se pudo liberar el bloqueo de recálculo de faena:', error)
    }
  },

  async crearParteDiario(parte: any) {
    const { data, error } = await supabase
      .from('partes_diarios')
      .insert([parte])
      .select()
      .single()

    if (error) throw error
    return data
  },

  async actualizarParteDiario(id: string, updates: any) {
    const { data, error } = await supabase
      .from('partes_diarios')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Hallazgo QA 2026-09-25: actualizarParteDiario (arriba) es un UPDATE a
  // ciegas — sin comparar el `estado` esperado, dos ediciones casi
  // simultáneas del MISMO parte (dos coordinadores/apr con el mismo
  // borrador abierto, o el mandante comentándolo mientras alguien más lo
  // guarda) pueden pisarse el `estado` entre sí en silencio. Mismo patrón
  // de bloqueo optimista que ya usa actualizarDocumentoSiEstado.
  async actualizarParteDiarioSiEstado(id: string, estadoEsperado: string, updates: any) {
    const { data, error } = await supabase
      .from('partes_diarios')
      .update(updates)
      .eq('id', id)
      .eq('estado', estadoEsperado)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error('Este Daily Report ya fue actualizado por otra persona (o comentado por el mandante) — vuelve a abrirlo antes de guardar de nuevo.')
      }
      throw error
    }
    return data
  },

  // Solo coordinador tiene policy de delete sobre partes_diarios (apr no
  // tiene — ver add_partes_diarios.sql), así que esto falla en el server
  // si lo llama cualquier otro rol, incluso si la UI lo permitiera.
  async eliminarParteDiario(id: string) {
    const { error } = await supabase.from('partes_diarios').delete().eq('id', id)
    if (error) throw error
  },

  async obtenerPartesDiarios(contratoId: string) {
    // Ordenado por número de reporte (no por fecha): dos reportes pueden
    // crearse fuera de orden respecto a su fecha real (por ejemplo, un
    // borrador atrasado que se envía después), y el número de reporte es
    // el que de verdad refleja el orden de creación — es correlativo y
    // se asigna con obtener_siguiente_numero_parte() al crear cada uno.
    const { data, error } = await supabase
      .from('partes_diarios')
      .select('*, usuario_creador:creado_por(nombre, email, rol, firma_url)')
      .eq('contrato_id', contratoId)
      .order('numero_reporte', { ascending: false })

    if (error) throw error
    return data
  },

  async obtenerParteDiario(id: string) {
    const { data, error } = await supabase
      .from('partes_diarios')
      .select('*, usuario_creador:creado_por(nombre, email, rol, firma_url)')
      .eq('id', id)
      .single()

    if (error) throw error
    return data
  },

  async comentarComoMandante(id: string, comentario: string, autor: string, usuarioId: string) {
    const { data, error } = await supabase
      .from('partes_diarios')
      .update({
        comentario_mandante: comentario,
        comentario_mandante_autor: autor,
        comentario_mandante_por: usuarioId,
        comentario_mandante_fecha: new Date().toISOString(),
        estado: 'comentado_mandante',
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  // ============ COMPRAS (SC -> RQ -> OC) ============
  // Ver add_compras.sql. Código SC atómico por contrato (mismo patrón que
  // obtenerSiguienteSecuenciaPDF: evita colisiones si dos coordinadores
  // crean una SC al mismo tiempo).
  async obtenerSiguienteCodigoSC(contratoId: string): Promise<string> {
    const { data, error } = await supabase.rpc('obtener_siguiente_codigo_sc', {
      p_contrato_id: contratoId,
    })
    if (error) throw error
    return data as string
  },

  // Inserta todos los ítems de una Solicitud de Compra en un solo insert:
  // o quedan guardadas todas las filas, o ninguna (una sola transacción).
  async crearSolicitudCompra(
    items: Omit<SolicitudCompra, 'id' | 'avanzo_a_rq' | 'created_at' | 'updated_at'>[]
  ) {
    const { data, error } = await supabase.from('solicitudes_compra').insert(items).select()
    if (error) throw error
    return data as SolicitudCompra[]
  },

  // Cada pestaña solo trae lo que todavía no avanzó a la siguiente etapa
  // (avanzo_a_rq / avanzo_a_oc = false) — las filas que ya avanzaron
  // quedan en la base para trazabilidad pero no se listan de nuevo acá.
  async obtenerSolicitudesCompra(contratoId: string) {
    const { data, error } = await supabase
      .from('solicitudes_compra')
      .select('*')
      .eq('contrato_id', contratoId)
      .eq('avanzo_a_rq', false)
      .order('created_at', { ascending: false })
      .order('numero_item', { ascending: true })

    if (error) throw error
    return data as SolicitudCompra[]
  },

  // El join a solicitudes_compra trae Documento/Fecha de Solicitud (no son
  // columnas propias de requisiciones) para mostrar la misma columna en
  // las tres pestañas sin duplicar el dato; se aplana acá para que el resto
  // del código maneje un objeto plano, igual que si fueran columnas propias.
  async obtenerRequisiciones(contratoId: string) {
    const { data, error } = await supabase
      .from('requisiciones')
      .select('*, solicitud_compra:solicitud_compra_id(documento_url, documento_nombre, fecha_solicitud)')
      .eq('contrato_id', contratoId)
      .eq('avanzo_a_oc', false)
      .order('created_at', { ascending: false })
      .order('numero_item', { ascending: true })

    if (error) throw error
    return (data ?? []).map((fila: any) => ({
      ...fila,
      documento_url: fila.solicitud_compra?.documento_url ?? null,
      documento_nombre: fila.solicitud_compra?.documento_nombre ?? null,
      fecha_solicitud: fila.solicitud_compra?.fecha_solicitud ?? null,
      solicitud_compra: undefined,
    })) as Requisicion[]
  },

  // Igual que obtenerRequisiciones: solo trae lo que todavía no avanzó a
  // la siguiente etapa (avanzo_a_gd = false).
  async obtenerOrdenesCompra(contratoId: string) {
    const { data, error } = await supabase
      .from('ordenes_compra')
      .select(
        '*, requisicion:requisicion_id(solicitud_compra:solicitud_compra_id(documento_url, documento_nombre, fecha_solicitud))'
      )
      .eq('contrato_id', contratoId)
      .eq('avanzo_a_gd', false)
      .order('created_at', { ascending: false })
      .order('numero_item', { ascending: true })

    if (error) throw error
    return (data ?? []).map((fila: any) => ({
      ...fila,
      documento_url: fila.requisicion?.solicitud_compra?.documento_url ?? null,
      documento_nombre: fila.requisicion?.solicitud_compra?.documento_nombre ?? null,
      fecha_solicitud: fila.requisicion?.solicitud_compra?.fecha_solicitud ?? null,
      requisicion: undefined,
    })) as OrdenCompra[]
  },

  // El join anidado (orden_compra -> requisicion -> solicitud_compra) trae
  // Documento/Fecha de Solicitud, igual que en obtenerRequisiciones/
  // obtenerOrdenesCompra, para mostrar la misma columna en las cuatro
  // pestañas sin duplicar el dato.
  async obtenerGuiasDespacho(contratoId: string) {
    const { data, error } = await supabase
      .from('guias_despacho')
      .select(
        '*, orden_compra:orden_compra_id(requisicion:requisicion_id(solicitud_compra:solicitud_compra_id(documento_url, documento_nombre, fecha_solicitud)))'
      )
      .eq('contrato_id', contratoId)
      .order('created_at', { ascending: false })
      .order('numero_item', { ascending: true })

    if (error) throw error
    return (data ?? []).map((fila: any) => ({
      ...fila,
      documento_url: fila.orden_compra?.requisicion?.solicitud_compra?.documento_url ?? null,
      documento_nombre: fila.orden_compra?.requisicion?.solicitud_compra?.documento_nombre ?? null,
      fecha_solicitud: fila.orden_compra?.requisicion?.solicitud_compra?.fecha_solicitud ?? null,
      orden_compra: undefined,
    })) as GuiaDespacho[]
  },

  // Botón "Pasar a RQ →" / "Pasar a OC →": recibe un arreglo de ids para
  // soportar tanto una fila sola como selección en lote.
  async avanzarSCaRQ(itemIds: string[]) {
    const { error } = await supabase.rpc('avanzar_sc_a_rq', { p_item_ids: itemIds })
    if (error) throw error
  },

  async avanzarRQaOC(itemIds: string[]) {
    const { error } = await supabase.rpc('avanzar_rq_a_oc', { p_item_ids: itemIds })
    if (error) throw error
  },

  async avanzarOCaGD(itemIds: string[]) {
    const { error } = await supabase.rpc('avanzar_oc_a_gd', { p_item_ids: itemIds })
    if (error) throw error
  },

  // Botón "← Devolver": solo de a una fila (así se aprobó en el mockup).
  async devolverRQaSC(requisicionId: string) {
    const { error } = await supabase.rpc('devolver_rq_a_sc', { p_requisicion_id: requisicionId })
    if (error) throw error
  },

  async devolverOCaRQ(ordenId: string) {
    const { error } = await supabase.rpc('devolver_oc_a_rq', { p_orden_id: ordenId })
    if (error) throw error
  },

  async devolverGDaOC(guiaId: string) {
    const { error } = await supabase.rpc('devolver_gd_a_oc', { p_guia_id: guiaId })
    if (error) throw error
  },

  // Campos propios de RQ/OC: llegan en blanco al avanzar y se completan
  // a mano en su pestaña.
  async actualizarRequisicion(
    id: string,
    updates: Partial<Pick<Requisicion, 'rq_numero' | 'fecha_rq' | 'codigo_defontana'>>
  ) {
    const { data, error } = await supabase
      .from('requisiciones')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data as Requisicion
  },

  async actualizarOrdenCompra(id: string, updates: Partial<Pick<OrdenCompra, 'oc_numero' | 'proveedor' | 'fecha_oc'>>) {
    const { data, error } = await supabase
      .from('ordenes_compra')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data as OrdenCompra
  },

  async actualizarGuiaDespacho(
    id: string,
    updates: Partial<Pick<GuiaDespacho, 'guia_numero' | 'fecha_guia' | 'cantidad_recibida'>>
  ) {
    const { data, error } = await supabase
      .from('guias_despacho')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data as GuiaDespacho
  },

  // Botón "Eliminar": borra el ítem para siempre, no vuelve a ninguna
  // etapa anterior (a diferencia de devolverRQaSC/devolverOCaRQ). Como
  // cada pestaña solo muestra ítems que todavía no avanzaron de etapa
  // (avanzo_a_rq/avanzo_a_oc = false), un ítem visible en la UI nunca
  // tiene una fila hija (RQ/OC) que dependa de él, así que el delete
  // directo es seguro sin necesidad de cascada.
  async eliminarSolicitudCompra(id: string) {
    const { error } = await supabase.from('solicitudes_compra').delete().eq('id', id)
    if (error) throw error
  },

  async eliminarRequisicion(id: string) {
    const { error } = await supabase.from('requisiciones').delete().eq('id', id)
    if (error) throw error
  },

  async eliminarOrdenCompra(id: string) {
    const { error } = await supabase.from('ordenes_compra').delete().eq('id', id)
    if (error) throw error
  },

  async eliminarGuiaDespacho(id: string) {
    const { error } = await supabase.from('guias_despacho').delete().eq('id', id)
    if (error) throw error
  },

  // ---------- Entrega de Turno ----------
  // Ver add_entrega_turno.sql. Acceso restringido a coordinador a nivel de
  // RLS, no solo en la UI — un intento de otro rol vuelve 0 filas o falla,
  // no un error silencioso con datos ajenos.
  async obtenerEntregasTurno(contratoId: string, faena: string) {
    const { data, error } = await supabase
      .from('entregas_turno')
      .select('*, usuario_creador:creado_por(nombre, email, rol), usuario_hecha:hecha_por(nombre, email, rol)')
      .eq('contrato_id', contratoId)
      .eq('faena', faena)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data
  },

  async crearEntregaTurno(entrega: {
    contrato_id: string
    faena: string
    descripcion: string
    observaciones: string | null
    creado_por: string
  }) {
    const { data, error } = await supabase.from('entregas_turno').insert([entrega]).select().single()
    if (error) throw error
    return data
  },

  // `hecha = false` limpia hecha_por/hecha_en (permite desmarcar por si se
  // marcó por error), no solo pasar hecha=true una vez.
  async marcarEntregaTurnoHecha(id: string, hecha: boolean, usuarioId: string) {
    const { data, error } = await supabase
      .from('entregas_turno')
      .update({
        hecha,
        hecha_por: hecha ? usuarioId : null,
        hecha_en: hecha ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  async eliminarEntregaTurno(id: string) {
    const { error } = await supabase.from('entregas_turno').delete().eq('id', id)
    if (error) throw error
  },

  // ---------- Organizador de Turnos ----------
  // Ver add_organizador_turnos.sql. Acceso restringido a coordinador a
  // nivel de RLS, mismo patrón que Entrega de Turno. Independiente de
  // faena/contrato — pedido explícito.
  async obtenerCuadrillasTurno() {
    const { data, error } = await supabase
      .from('cuadrillas_turno')
      .select('*, trabajadores:cuadrillas_turno_trabajadores(*)')
      .order('orden', { ascending: true })

    if (error) throw error
    return data
  },

  async crearCuadrillaTurno(cuadrilla: {
    nombre: string
    patron_dias_trabajo: number
    patron_dias_descanso: number
    patron_incluye_subida: boolean
    fecha_inicio: string
    color_tema: string
    orden: number
    creado_por: string
  }) {
    const { data, error } = await supabase.from('cuadrillas_turno').insert([cuadrilla]).select().single()
    if (error) throw error
    return data
  },

  // Guarda en una sola transacción los cambios de trabajadores y los
  // campos propios de la cuadrilla (ver
  // add_guardar_edicion_cuadrilla_turno_rpc.sql) — antes eran un
  // Promise.all de N updates de trabajador + un update de cuadrilla
  // aparte, y una falla a medio Promise.all dejaba trabajadores
  // guardados sin que la cuadrilla se actualizara, con un solo error
  // genérico que no reflejaba ese estado intermedio.
  async guardarEdicionCuadrillaTurno(
    cuadrillaId: string,
    trabajadores: Array<{ id: string; nombre: string; apellido: string; rut: string; cargo: string }>,
    cambios: {
      nombre: string
      patron_dias_trabajo: number
      patron_dias_descanso: number
      patron_incluye_subida: boolean
      fecha_inicio: string
      color_tema: string
      config_subida_id: string | null
      config_bajada_id: string | null
    }
  ) {
    const { data, error } = await supabase.rpc('guardar_edicion_cuadrilla_turno', {
      p_cuadrilla_id: cuadrillaId,
      p_trabajadores: trabajadores,
      p_nombre: cambios.nombre,
      p_patron_dias_trabajo: cambios.patron_dias_trabajo,
      p_patron_dias_descanso: cambios.patron_dias_descanso,
      p_patron_incluye_subida: cambios.patron_incluye_subida,
      p_fecha_inicio: cambios.fecha_inicio,
      p_color_tema: cambios.color_tema,
      p_config_subida_id: cambios.config_subida_id,
      p_config_bajada_id: cambios.config_bajada_id,
    })
    if (error) throw error
    return data
  },

  async eliminarCuadrillaTurno(id: string) {
    // La FK de cuadrillas_turno_trabajadores tiene "on delete cascade":
    // borrar la cuadrilla borra a sus trabajadores automáticamente.
    const { error } = await supabase.from('cuadrillas_turno').delete().eq('id', id)
    if (error) throw error
  },

  // Reescribe el orden completo (0..n-1) tras un arrastre, en una sola
  // transacción (ver add_reordenar_cuadrillas_turno_rpc.sql — mismo patrón
  // que reordenar_documentos). No usar .upsert() con columnas parciales acá:
  // un INSERT ... ON CONFLICT DO UPDATE exige que la fila candidata del
  // INSERT cumpla los NOT NULL de la tabla completa antes de resolver el
  // conflicto, así que un payload con solo {id, orden} falla siempre.
  async reordenarCuadrillasTurno(idsEnOrden: string[]) {
    const { error } = await supabase.rpc('reordenar_cuadrillas_turno', { p_ids: idsEnOrden })
    if (error) throw error
  },

  // Hallazgo QA 2026-09-25: mover varios turnos con Promise.all (un
  // db.actualizarCuadrillaTurno por cuadrilla) podía fallar a medias — las
  // que sí tuvieron éxito quedaban movidas en la base pero el estado local
  // nunca se actualizaba, así que un reintento las volvía a mover. Un solo
  // UPDATE de todas las filas en una transacción evita ese estado
  // intermedio (ver add_mover_fecha_cuadrillas_turno_rpc.sql).
  async moverFechaCuadrillasTurno(ids: string[], deltaDias: number) {
    const { error } = await supabase.rpc('mover_fecha_cuadrillas_turno', { p_ids: ids, p_delta_dias: deltaDias })
    if (error) throw error
  },

  async agregarTrabajadorCuadrilla(trabajador: {
    cuadrilla_id: string
    nombre: string
    apellido: string
    rut: string
    cargo: string
  }) {
    const { data, error } = await supabase
      .from('cuadrillas_turno_trabajadores')
      .insert([trabajador])
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Un solo insert para toda la lista — la carga masiva no gana nada
  // haciendo N round-trips secuenciales cuando la API acepta un array.
  async agregarTrabajadoresCuadrilla(trabajadores: { cuadrilla_id: string; nombre: string; apellido: string; rut: string; cargo: string }[]) {
    const { data, error } = await supabase.from('cuadrillas_turno_trabajadores').insert(trabajadores).select()
    if (error) throw error
    return data
  },

  async eliminarTrabajadorCuadrilla(id: string) {
    const { error } = await supabase.from('cuadrillas_turno_trabajadores').delete().eq('id', id)
    if (error) throw error
  },

  // ---------- Eventos de tránsito (Subida/Bajada sueltas) ----------
  // Ver add_eventos_transito.sql. Un día suelto, independiente de
  // cualquier CuadrillaTurno — mismo acceso RLS (coordinador y consultor).
  async obtenerEventosTransito() {
    const { data, error } = await supabase
      .from('eventos_transito')
      .select('*, trabajadores:eventos_transito_trabajadores(*)')
      .order('fecha', { ascending: true })

    if (error) throw error
    return data
  },

  async crearEventoTransito(evento: { tipo: 'subida' | 'bajada'; fecha: string; configuracion_id: string | null; creado_por: string }) {
    const { data, error } = await supabase.from('eventos_transito').insert([evento]).select().single()
    if (error) throw error
    return data
  },

  async eliminarEventoTransito(id: string) {
    // eventos_transito_trabajadores tiene "on delete cascade".
    const { error } = await supabase.from('eventos_transito').delete().eq('id', id)
    if (error) throw error
  },

  async agregarTrabajadorEventoTransito(trabajador: { evento_id: string; nombre: string; apellido: string; rut: string; cargo: string }) {
    const { data, error } = await supabase.from('eventos_transito_trabajadores').insert([trabajador]).select().single()
    if (error) throw error
    return data
  },

  async agregarTrabajadoresEventoTransito(
    trabajadores: { evento_id: string; nombre: string; apellido: string; rut: string; cargo: string }[]
  ) {
    const { data, error } = await supabase.from('eventos_transito_trabajadores').insert(trabajadores).select()
    if (error) throw error
    return data
  },

  // ---------- Configuraciones de Viaje (presets de Origen/Destino/Hora) ----------
  // Ver add_configuraciones_viaje.sql. Reusables y asignables a un turno
  // (cuadrillas_turno.config_subida_id / config_bajada_id) — mismo acceso
  // RLS que cuadrillas_turno.
  async obtenerConfiguracionesViaje() {
    const { data, error } = await supabase
      .from('configuraciones_viaje')
      .select('*')
      .order('tipo', { ascending: true })
      .order('hora', { ascending: true })

    if (error) throw error
    return data
  },

  async crearConfiguracionViaje(config: { tipo: 'subida' | 'bajada'; origen: string; destino: string; hora: string; creado_por: string }) {
    const { data, error } = await supabase.from('configuraciones_viaje').insert([config]).select().single()
    if (error) throw error
    return data
  },

  async eliminarConfiguracionViaje(id: string) {
    // Los turnos que la tenían asignada la pierden solos (FK "on delete
    // set null"), no hace falta desasignarla a mano antes de borrar.
    const { error } = await supabase.from('configuraciones_viaje').delete().eq('id', id)
    if (error) throw error
  },

  // ---------- Reservas de Pasajes ----------
  // Ver add_reservas_pasaje.sql. Mismo acceso RLS que cuadrillas_turno
  // (coordinador y consultor). Las filas candidatas (quién sube/baja y
  // cuándo) se calculan en el frontend desde el motor de turnos — esto
  // solo trae/guarda el estado propio de cada reserva ya existente.
  async obtenerReservasPasaje(fechaDesde: string, fechaHasta: string) {
    const { data, error } = await supabase
      .from('reservas_pasaje')
      .select('*')
      .gte('fecha', fechaDesde)
      .lte('fecha', fechaHasta)

    if (error) throw error
    return data
  },

  // Upsert con todas las columnas NOT NULL siempre presentes en el
  // payload (trabajador_id, fecha, tipo, origen, destino, creado_por) —
  // un INSERT ... ON CONFLICT DO UPDATE valida esas columnas en la fila
  // candidata del INSERT antes de resolver el conflicto (mismo problema
  // que ya se dio en reordenarCuadrillasTurno con un upsert parcial).
  async guardarReservaPasaje(reserva: {
    trabajador_id: string
    fecha: string
    tipo: 'subida' | 'bajada'
    origen: string
    destino: string
    horario: string | null
    confirmada: boolean
    confirmada_por: string | null
    confirmada_en: string | null
    encargado_reserva: string | null
    fecha_reserva: string | null
    observaciones: string | null
    creado_por: string
  }) {
    const { data, error } = await supabase
      .from('reservas_pasaje')
      .upsert([{ ...reserva, updated_at: new Date().toISOString() }], { onConflict: 'trabajador_id,fecha,tipo' })
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Hallazgo QA 2026-09-25: para una reserva que YA existe, ReservasPasajes.tsx
  // reenviaba la fila completa (reconstruida desde un snapshot local de
  // `reservas`, mezclado con el cambio actual) vía guardarReservaPasaje —
  // dos ediciones casi simultáneas a campos distintos de la misma reserva
  // (una tipea el horario, otra confirma) cada una parte del mismo
  // `existente` desactualizado, y la que termina de guardar último pisa el
  // cambio de la otra. Un UPDATE con solo los campos que de verdad
  // cambiaron no tiene ese problema — a diferencia de un upsert, no exige
  // que el payload traiga todas las columnas NOT NULL de la tabla.
  async actualizarReservaPasaje(
    id: string,
    cambios: Partial<{
      horario: string | null
      confirmada: boolean
      confirmada_por: string | null
      confirmada_en: string | null
      encargado_reserva: string | null
      fecha_reserva: string | null
      observaciones: string | null
    }>
  ) {
    const { data, error } = await supabase
      .from('reservas_pasaje')
      .update({ ...cambios, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },
}
