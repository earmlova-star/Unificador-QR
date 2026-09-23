-- ============================================================
-- El drag-and-drop de Organizador de Turnos no reordenaba: db.reordenarCuadrillasTurno
-- usaba supabase.from('cuadrillas_turno').upsert([{id, orden, updated_at}], ...).
-- En un INSERT ... ON CONFLICT DO UPDATE, Postgres arma la fila candidata
-- del INSERT (y valida sus NOT NULL) ANTES de resolver el conflicto hacia
-- el UPDATE — como el payload no traía nombre/patron_dias_trabajo/
-- patron_dias_descanso/fecha_inicio/color_tema/creado_por, el intento
-- fallaba con "null value in column ... violates not-null constraint" en
-- CADA fila, la operación completa se abortaba, y el catch de
-- soltarCuadrilla() recargaba desde el servidor — el turno arrastrado
-- volvía a su posición original sin que se notara el error real.
--
-- Mismo patrón que reordenar_documentos (ver
-- add_reordenar_documentos_rpc.sql): un UPDATE que solo toca "orden",
-- sin tocar el resto de columnas, en una sola sentencia/transacción.
-- Sin "security definer" a propósito: corre con los permisos de quien
-- llama, así que la RLS de cuadrillas_turno se sigue aplicando fila por
-- fila igual que antes.
-- ============================================================

create or replace function public.reordenar_cuadrillas_turno(p_ids uuid[])
returns void
language sql
set search_path = public
as $$
  update public.cuadrillas_turno as c
  set orden = nuevo.posicion, updated_at = now()
  from (select id, ordinality - 1 as posicion from unnest(p_ids) with ordinality as t(id, ordinality)) as nuevo
  where c.id = nuevo.id;
$$;

grant execute on function public.reordenar_cuadrillas_turno(uuid[]) to authenticated;
