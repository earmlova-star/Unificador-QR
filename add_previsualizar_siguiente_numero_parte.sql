-- ============================================================
-- Bug reportado 2026-09-26: al crear Daily Reports, el correlativo salta
-- (ej. del 36 al 44) sin que existan reportes 37-43.
--
-- Causa: el fix de hallazgo QA #12 (fix_secuencias_sin_rol_y_numero_parte_
-- no_atomico.sql) cambió obtener_siguiente_numero_parte para que incremente
-- ATÓMICAMENTE un contador en secuencias_numero_parte cada vez que se llama
-- — correcto para evitar que dos apr guardando a la vez choquen en el mismo
-- número. El problema es DÓNDE se llama: ParteDiarioForm.tsx la invoca en
-- un useEffect apenas se ABRE el formulario de "Nuevo Daily Report", solo
-- para MOSTRAR el número en pantalla mientras se llena — no para guardar.
-- Antes del fix (cuando calculaba max(numero_reporte)+1 sobre la tabla real)
-- abrir el formulario varias veces sin guardar era inofensivo: como nada se
-- insertaba, max()+1 daba siempre el mismo número. Con el contador atómico,
-- cada apertura del formulario "gasta" un número aunque el usuario cierre
-- sin guardar — de ahí los saltos.
--
-- Fix: separar "mostrar cuál sería el próximo número" (esto, de solo
-- lectura, sin tocar el contador) de "reservar el número de verdad" (la
-- función existente obtener_siguiente_numero_parte, que ahora solo se debe
-- llamar justo antes del INSERT real en ParteDiarioForm.tsx, no al abrir el
-- formulario).
-- ============================================================

create or replace function public.previsualizar_siguiente_numero_parte(p_contrato_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ultimo integer;
begin
  if public.usuario_rol_actual() not in ('coordinador', 'apr') then
    raise exception 'No autorizado';
  end if;

  select ultimo_valor into v_ultimo from public.secuencias_numero_parte where contrato_id = p_contrato_id;
  if v_ultimo is null then
    select coalesce(max(numero_reporte), 0) into v_ultimo from public.partes_diarios where contrato_id = p_contrato_id;
  end if;

  return v_ultimo + 1;
end;
$function$;

grant execute on function public.previsualizar_siguiente_numero_parte(uuid) to authenticated;

notify pgrst, 'reload schema';
