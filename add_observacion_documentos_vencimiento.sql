-- ============================================================
-- Control de Vencimientos: observaciones + menú contextual — pedido
-- explícito 2026-09-27.
--
-- Regla de negocio: la observación de un registro se borra automáticamente
-- en cuanto su fecha_vencimiento cambia (una observación vieja atada a una
-- fecha que ya no es la vigente deja de tener sentido — ej. "trámite en
-- curso, vence el 2 de septiembre" ya no aplica si la fecha se actualizó a
-- otro mes). Se impone con un trigger, no solo en el cliente: así se
-- cumple sin importar desde dónde se actualice fecha_vencimiento.
-- ============================================================

alter table public.documentos_vencimiento
  add column if not exists observacion text;

create or replace function public.limpiar_observacion_al_cambiar_fecha_vencimiento()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.fecha_vencimiento is distinct from old.fecha_vencimiento then
    new.observacion := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_limpiar_observacion_al_cambiar_fecha on public.documentos_vencimiento;
create trigger trg_limpiar_observacion_al_cambiar_fecha
  before update on public.documentos_vencimiento
  for each row execute function public.limpiar_observacion_al_cambiar_fecha_vencimiento();

notify pgrst, 'reload schema';
