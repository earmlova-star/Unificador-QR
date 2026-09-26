-- ============================================================
-- Hallazgo QA 2026-09-25: db.recalcularAcumuladosFaena hace un SELECT de
-- todos los partes_diarios de la faena, calcula la cadena completa de
-- acumulados en JS (calcularHHReales + acumularCadena) y después escribe un
-- UPDATE por reporte que cambió — sin ningún tipo de bloqueo. Se llama
-- después de CUALQUIER guardado de un Daily Report de esa faena
-- (ParteDiarioForm.tsx), así que dos personas guardando reportes de la
-- MISMA faena casi al mismo tiempo disparan dos recálculos en paralelo: el
-- que termina de leer último ve los datos ya escritos por el otro a medio
-- camino, y el que termina de escribir último pisa los acumulados del otro
-- — la cadena queda con valores mezclados de dos ejecuciones distintas.
--
-- Se evaluaron y descartaron: (a) advisory locks tomados en un RPC aparte
-- — las llamadas de supabase-js/PostgREST son stateless, nada garantiza
-- que la sesión de Postgres siga siendo la misma entre dos llamadas RPC
-- separadas, así que un pg_advisory_lock tomado en una no necesariamente
-- lo sigue teniendo la siguiente; (b) portar todo calcularHHReales/
-- acumularCadena a PL/pgSQL para hacer todo (leer+calcular+escribir) en una
-- sola transacción — demasiado riesgoso para tocar sin pruebas un cálculo
-- financiero/de HH ya probado en JS.
--
-- Fix elegido: una fila de bloqueo con TTL (por si el proceso que la tomó
-- se cae sin liberarla, no queda pegada para siempre) por (contrato, faena)
-- — el cálculo en JS existente (calcularHHReales/acumularCadena) no se
-- toca, solo se envuelve con adquirir/reintentar-con-backoff/liberar desde
-- supabase.ts.
-- ============================================================

create table if not exists public.bloqueos_recalculo_faena (
  contrato_id uuid not null,
  faena text not null,
  bloqueado_hasta timestamptz not null,
  primary key (contrato_id, faena)
);

-- Sin RLS ni grants directos sobre la tabla: solo se toca a través de las
-- dos funciones de abajo (security definer), nunca directo desde el cliente.

create or replace function public.adquirir_bloqueo_recalculo_faena(p_contrato_id uuid, p_faena text, p_ttl_segundos int)
returns boolean
language sql
security definer
set search_path to 'public'
as $$
  insert into public.bloqueos_recalculo_faena (contrato_id, faena, bloqueado_hasta)
  values (p_contrato_id, p_faena, now() + (p_ttl_segundos || ' seconds')::interval)
  on conflict (contrato_id, faena) do update
    set bloqueado_hasta = now() + (p_ttl_segundos || ' seconds')::interval
    where public.bloqueos_recalculo_faena.bloqueado_hasta < now()
  returning true;
$$;

create or replace function public.liberar_bloqueo_recalculo_faena(p_contrato_id uuid, p_faena text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.bloqueos_recalculo_faena where contrato_id = p_contrato_id and faena = p_faena;
$$;

grant execute on function public.adquirir_bloqueo_recalculo_faena(uuid, text, int) to authenticated;
grant execute on function public.liberar_bloqueo_recalculo_faena(uuid, text) to authenticated;

notify pgrst, 'reload schema';
