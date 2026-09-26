-- ============================================================
-- Hallazgo QA 2026-09-25: add_eventos_transito.sql eliminó la FK
-- reservas_pasaje_trabajador_id_fkey (que tenía "on delete cascade" hacia
-- cuadrillas_turno_trabajadores) para poder usar reservas_pasaje.trabajador_id
-- como referencia polimórfica — apunta a una fila de
-- cuadrillas_turno_trabajadores O de eventos_transito_trabajadores, y
-- Postgres no permite una FK que apunte "a cualquiera de estas dos tablas".
-- Pero al sacar la FK también se sacó el "on delete cascade" que traía: hoy
-- borrar un trabajador de cuadrilla (directo, o en cascada al borrar toda
-- la cuadrilla) o un trabajador de evento_transito (en cascada al borrar el
-- evento) deja sus reservas_pasaje huérfanas para siempre — nada las borra
-- ni las marca, simplemente quedan filas muertas acumulándose sin que
-- ninguna pantalla vuelva a mostrarlas.
--
-- Fix: como una sola FK declarativa no puede cubrir las dos tablas de
-- origen, se reemplaza por dos triggers AFTER DELETE (uno por cada tabla de
-- trabajador) que borran las reservas_pasaje del trabajador borrado —
-- mismo efecto que el "on delete cascade" original, pero replicado para
-- ambos orígenes posibles. Sin "security definer": los dos roles con
-- permiso para borrar un trabajador (coordinador, consultor) son
-- exactamente los mismos que tienen permiso para borrar en reservas_pasaje,
-- así que la RLS de reservas_pasaje no bloquea el trigger.
--
-- También se limpian de una vez las filas huérfanas que ya existan hoy.
-- ============================================================

delete from public.reservas_pasaje as r
where not exists (select 1 from public.cuadrillas_turno_trabajadores as t where t.id = r.trabajador_id)
  and not exists (select 1 from public.eventos_transito_trabajadores as e where e.id = r.trabajador_id);

create or replace function public.limpiar_reservas_pasaje_de_trabajador()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  delete from public.reservas_pasaje where trabajador_id = old.id;
  return old;
end;
$function$;

drop trigger if exists trg_limpiar_reservas_pasaje_cuadrilla on public.cuadrillas_turno_trabajadores;
create trigger trg_limpiar_reservas_pasaje_cuadrilla
  after delete on public.cuadrillas_turno_trabajadores
  for each row execute function public.limpiar_reservas_pasaje_de_trabajador();

drop trigger if exists trg_limpiar_reservas_pasaje_evento on public.eventos_transito_trabajadores;
create trigger trg_limpiar_reservas_pasaje_evento
  after delete on public.eventos_transito_trabajadores
  for each row execute function public.limpiar_reservas_pasaje_de_trabajador();

notify pgrst, 'reload schema';
