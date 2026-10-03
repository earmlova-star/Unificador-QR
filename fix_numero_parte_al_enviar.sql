-- ============================================================
-- El N° de Daily Report se asigna AL ENVIAR, no al guardar borrador
-- (pedido explícito 2026-10-03). Antes el N° se reservaba (contador +1)
-- ANTES de guardar el reporte: si el guardado fallaba (ej. sin señal en
-- faena) o el reporte se borraba, el número quedaba gastado y el
-- correlativo saltaba (así desapareció el N° 43).
--
-- Ahora:
--   * Un borrador no tiene N° (numero_reporte queda null).
--   * Un trigger asigna el N° en la MISMA transacción que escribe el
--     reporte, en el momento en que su estado deja de ser "borrador"
--     (se crea ya enviado, o pasa de borrador a enviado). Si esa
--     escritura falla, el contador vuelve atrás junto con ella: no se
--     pierde ningún número. Dos envíos simultáneos se ordenan solos (el
--     contador bloquea la fila hasta que termina el primero).
--   * Solo borrar a propósito un reporte ya numerado deja un hueco.
--
-- Orden para aplicar: correr ESTE archivo (y fix_renumerar_hueco_43.sql)
-- ANTES de desplegar la versión nueva de la app. Es compatible con la
-- app vieja mientras tanto (ver el final del archivo).
-- ============================================================

-- 1) Un borrador no tiene N° todavía. La restricción única (contrato, N°)
--    sigue: los null no chocan entre sí, así que puede haber varios borradores.
alter table public.partes_diarios alter column numero_reporte drop not null;

-- 2) Asignación automática del N° al enviar.
--    SECURITY DEFINER porque el contador (secuencias_numero_parte) y el
--    máximo global del contrato no son visibles para un apr bajo RLS. No
--    se puede llamar desde la app: una función de trigger no se expone
--    como RPC.
create or replace function public.asignar_numero_parte_al_enviar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.estado is distinct from 'borrador' and new.numero_reporte is null then
    -- greatest(contador, máximo existente) + 1: nunca choca con un N° que
    -- ya exista, aunque el contador haya quedado atrás.
    insert into public.secuencias_numero_parte as sec (contrato_id, ultimo_valor)
    select new.contrato_id, coalesce(max(p.numero_reporte), 0) + 1
    from public.partes_diarios p
    where p.contrato_id = new.contrato_id
    on conflict (contrato_id) do update
      set ultimo_valor = greatest(sec.ultimo_valor, excluded.ultimo_valor - 1) + 1
    returning sec.ultimo_valor into new.numero_reporte;
  end if;
  return new;
end;
$function$;

drop trigger if exists asignar_numero_parte_al_enviar on public.partes_diarios;
create trigger asignar_numero_parte_al_enviar
  before insert or update on public.partes_diarios
  for each row execute function public.asignar_numero_parte_al_enviar();

-- 3) El contador queda en el último N° real de cada contrato (suelta los
--    números que se habían reservado y nunca se usaron).
update public.secuencias_numero_parte s
set ultimo_valor = coalesce(
  (select max(p.numero_reporte) from public.partes_diarios p where p.contrato_id = s.contrato_id),
  0
);

notify pgrst, 'reload schema';

-- Verificación.
select 'columna numero_reporte permite null' as chequeo, is_nullable as resultado
from information_schema.columns
where table_schema = 'public' and table_name = 'partes_diarios' and column_name = 'numero_reporte'
union all
select 'trigger de asignación', tgname::text
from pg_trigger
where tgrelid = 'public.partes_diarios'::regclass and tgname = 'asignar_numero_parte_al_enviar' and not tgisinternal
union all
select 'borradores que ya tenían N° (conservan el suyo)', count(*)::text
from public.partes_diarios
where estado = 'borrador' and numero_reporte is not null
union all
select 'contador', s.contrato_id || ' → ' || s.ultimo_valor
from public.secuencias_numero_parte s;

-- ------------------------------------------------------------
-- Compatibilidad: obtener_siguiente_numero_parte y
-- previsualizar_siguiente_numero_parte siguen existiendo para que la app
-- vieja funcione hasta que se despliegue la nueva (la vieja manda su
-- propio N° y el trigger no lo toca). La app nueva ya no las usa: una vez
-- desplegada, se pueden borrar con:
--   drop function public.obtener_siguiente_numero_parte(uuid);
--   drop function public.previsualizar_siguiente_numero_parte(uuid);
-- ------------------------------------------------------------
