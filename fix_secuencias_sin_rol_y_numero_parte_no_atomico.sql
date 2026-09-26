-- ============================================================
-- Hallazgo QA 2026-09-25 (dos problemas distintos en dos RPC hermanas):
--
-- 1) obtener_siguiente_secuencia_pdf y obtener_siguiente_numero_parte son
--    SECURITY DEFINER (saltan RLS) sin ningún chequeo de
--    usuario_rol_actual() adentro — a diferencia de sus funciones hermanas
--    (obtener_siguiente_codigo_sc, avanzar_*_a_*, puede_escribir_en_carpeta),
--    que sí lo hacen. Cualquier usuario autenticado podía llamarlas
--    directamente y alterar el contador de secuencia de PDFs o de números
--    de Parte Diario de cualquier contrato.
--
-- 2) obtener_siguiente_numero_parte calculaba max(numero_reporte)+1 en vez
--    de un contador atómico (como sí hace secuencias_pdf/secuencias_sc) —
--    dos apr guardando un parte nuevo casi al mismo tiempo podían recibir
--    el mismo numero_reporte.
--
-- Fix: agrega el mismo chequeo de rol que ya usan las funciones hermanas
-- (roles verificados contra quién puede de verdad llamar cada una: ver
-- ParteDiario/permisos.ts para numero_parte, DocumentList.tsx "puedeCargar"
-- para secuencia_pdf), y una tabla de secuencia propia + upsert atómico
-- para numero_parte, igual patrón que secuencias_pdf/secuencias_sc.
--
-- La tabla nueva se rellena con el máximo numero_reporte YA GUARDADO de
-- cada contrato antes de activar la función nueva, para no chocar con
-- reportes existentes.
-- ============================================================

create table if not exists public.secuencias_numero_parte (
  contrato_id uuid primary key,
  ultimo_valor integer not null default 0
);

insert into public.secuencias_numero_parte (contrato_id, ultimo_valor)
select contrato_id, max(numero_reporte)
from public.partes_diarios
group by contrato_id
on conflict (contrato_id) do update
  set ultimo_valor = greatest(public.secuencias_numero_parte.ultimo_valor, excluded.ultimo_valor);

create or replace function public.obtener_siguiente_numero_parte(p_contrato_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_siguiente int;
begin
  if public.usuario_rol_actual() not in ('coordinador', 'apr') then
    raise exception 'No autorizado';
  end if;

  insert into public.secuencias_numero_parte (contrato_id, ultimo_valor)
  values (p_contrato_id, 1)
  on conflict (contrato_id)
  do update set ultimo_valor = secuencias_numero_parte.ultimo_valor + 1
  returning ultimo_valor into v_siguiente;

  return v_siguiente;
end;
$function$;

create or replace function public.obtener_siguiente_secuencia_pdf(p_contrato_id uuid, p_fecha date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_siguiente int;
begin
  if public.usuario_rol_actual() not in ('coordinador', 'apr', 'supervisor') then
    raise exception 'No autorizado';
  end if;

  insert into public.secuencias_pdf (contrato_id, fecha, ultimo_valor)
  values (p_contrato_id, p_fecha, 1)
  on conflict (contrato_id, fecha)
  do update set ultimo_valor = secuencias_pdf.ultimo_valor + 1
  returning ultimo_valor into v_siguiente;

  return v_siguiente;
end;
$function$;

notify pgrst, 'reload schema';
