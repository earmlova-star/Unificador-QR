-- ============================================================
-- Corrección de datos puntual (2026-09-26): el reporte que quedó numerado
-- 44 por el bug de saltos de correlativo (ver
-- add_previsualizar_siguiente_numero_parte.sql) en realidad es el reporte
-- que debía seguir al 36 — se renombra a 37, y se sincroniza el contador
-- atómico para que el próximo reporte de ese contrato siga en 38 (no en 45).
--
-- Paso 1 — diagnóstico: corre esto primero y revisa el resultado antes de
-- seguir. Debería verse UNA sola fila con numero_reporte = 44, y NINGUNA
-- con numero_reporte = 37, todas del mismo contrato_id.
-- ============================================================

select id, contrato_id, faena, fecha, numero_reporte
from public.partes_diarios
where numero_reporte in (36, 37, 44)
order by contrato_id, numero_reporte;

-- ============================================================
-- Paso 2 — la corrección en sí. El UPDATE solo aplica si, para ese mismo
-- contrato, el 37 todavía no existe Y el 44 es el número más alto que hay
-- (o sea, no hay reportes 45+ ya creados después) — si alguna de las dos
-- condiciones no se cumple, no cambia nada, para no corromper datos si la
-- situación real es distinta a la esperada.
-- ============================================================

update public.partes_diarios as p
set numero_reporte = 37
where p.numero_reporte = 44
  and not exists (
    select 1 from public.partes_diarios as p2
    where p2.contrato_id = p.contrato_id and p2.numero_reporte = 37
  )
  and not exists (
    select 1 from public.partes_diarios as p3
    where p3.contrato_id = p.contrato_id and p3.numero_reporte > 44
  );

-- Sincroniza el contador: el próximo obtener_siguiente_numero_parte de ese
-- contrato debe devolver 38, no 45.
update public.secuencias_numero_parte as s
set ultimo_valor = 37
where s.contrato_id in (
  select contrato_id from public.partes_diarios where numero_reporte = 37
);

-- ============================================================
-- Paso 3 — verificación: debería verse el reporte con numero_reporte = 37
-- (el que antes era 44) y ningún 44 restante para ese contrato.
-- ============================================================

select id, contrato_id, faena, fecha, numero_reporte
from public.partes_diarios
where numero_reporte in (36, 37, 44)
order by contrato_id, numero_reporte;

notify pgrst, 'reload schema';
