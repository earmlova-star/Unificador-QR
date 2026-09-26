-- ============================================================
-- Hallazgo QA 2026-09-25: moverFechaCuadrilla (con "🔒 Sincronizado")
-- disparaba un db.actualizarCuadrillaTurno por cuadrilla vía Promise.all —
-- si UNA fallaba, la promesa entera se rechazaba y setCuadrillas() (el
-- estado local) nunca corría, aunque las que sí tuvieron éxito ya hubieran
-- escrito en la base. La UI seguía mostrando la fecha vieja para TODAS, así
-- que un reintento del usuario volvía a sumar el mismo delta a las que ya
-- se habían movido — quedaban en +2 días mientras las demás en +1.
--
-- Mismo patrón que reordenar_cuadrillas_turno (ver
-- add_reordenar_cuadrillas_turno_rpc.sql): un solo UPDATE de varias filas
-- en una única sentencia/transacción — o se mueven TODAS, o ninguna, sin
-- estado intermedio posible. Sin "security definer" a propósito: corre con
-- los permisos de quien llama, la RLS de cuadrillas_turno se sigue
-- aplicando igual que antes.
-- ============================================================

create or replace function public.mover_fecha_cuadrillas_turno(p_ids uuid[], p_delta_dias int)
returns void
language sql
set search_path = public
as $$
  update public.cuadrillas_turno
  set fecha_inicio = fecha_inicio + p_delta_dias, updated_at = now()
  where id = any(p_ids);
$$;

grant execute on function public.mover_fecha_cuadrillas_turno(uuid[], int) to authenticated;

notify pgrst, 'reload schema';
