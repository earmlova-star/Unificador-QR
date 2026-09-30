-- ============================================================
-- Modal de trabajadores compartido (Organizador de Turnos) — pedido
-- explícito 2026-09-30: las subidas/bajadas sueltas ganan el mismo modal
-- de editar/agregar/eliminar trabajadores que ya tienen los turnos
-- (cuadrillas_turno, ver add_guardar_edicion_cuadrilla_turno_rpc.sql).
--
-- Mismo motivo que esa migración: un Promise.all de un UPDATE por
-- trabajador editado podía fallar a medias, dejando algunos guardados y
-- otros no sin que quedara claro cuáles. Una sola función que actualiza
-- todas las filas en una transacción evita ese estado intermedio.
-- ============================================================

create or replace function public.guardar_trabajadores_evento_transito(p_evento_id uuid, p_trabajadores jsonb)
returns void
language sql
set search_path to 'public'
as $$
  update public.eventos_transito_trabajadores as t
  set nombre = c.nombre,
      apellido = c.apellido,
      rut = c.rut,
      cargo = c.cargo
  from jsonb_to_recordset(p_trabajadores) as c(id uuid, nombre text, apellido text, rut text, cargo text)
  where t.id = c.id and t.evento_id = p_evento_id;
$$;

grant execute on function public.guardar_trabajadores_evento_transito(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
