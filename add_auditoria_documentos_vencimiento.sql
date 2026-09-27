-- ============================================================
-- Control de Vencimientos: trazabilidad de usuario — pedido explícito
-- 2026-09-27. Mismo patrón ya usado en partes_diarios.comentario_mandante_
-- autor/_por/_fecha (ver ParteDiarioDetalle.tsx / comentarComoMandante):
-- se guarda el NOMBRE (para mostrar sin join) Y el uuid (para trazabilidad
-- real) del usuario que hizo el cambio, más la marca de tiempo. Se pasan
-- explícitos desde el cliente (mismo criterio que comentarComoMandante),
-- no se derivan con un trigger.
-- ============================================================

alter table public.documentos_vencimiento
  add column if not exists observacion_autor text,
  add column if not exists observacion_por uuid references public.usuarios(id),
  add column if not exists observacion_creada_en timestamptz,
  add column if not exists vencimiento_actualizado_autor text,
  add column if not exists vencimiento_actualizado_por uuid references public.usuarios(id),
  add column if not exists vencimiento_actualizado_en timestamptz;

-- Se reemplaza la función del trigger existente (ver
-- add_observacion_documentos_vencimiento.sql) para que la limpieza
-- automática de la observación al cambiar la fecha también borre su
-- autoría — si no, quedaría un "Por: Fulano" huérfano sin nota visible.
create or replace function public.limpiar_observacion_al_cambiar_fecha_vencimiento()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.fecha_vencimiento is distinct from old.fecha_vencimiento then
    new.observacion := null;
    new.observacion_autor := null;
    new.observacion_por := null;
    new.observacion_creada_en := null;
  end if;
  return new;
end;
$function$;

notify pgrst, 'reload schema';
