-- ============================================================
-- Corrección de datos (2026-10-03): el Daily Report N° 43 nunca llegó a
-- existir — su número se reservó (guardado fallido o reporte borrado) y el
-- contador siguió de largo, así que el contrato quedó con 42, 44, 45, 46…
-- Esto cierra ese hueco: TODOS los reportes con número mayor a 43 del
-- contrato afectado bajan 1 (44→43, 45→44, 46→45…), y el contador
-- queda en el último número real, para que el próximo sea el siguiente.
--
-- OJO: cambia el N° de reportes que ya están enviados. Cualquier Excel/PDF
-- ya emitido con el N° viejo (ej. DR044_…) o comentario del mandante que lo
-- cite hay que revisarlo a mano.
--
-- Es seguro correrlo una sola vez: si no queda ningún hueco en el 43, se
-- detiene con un mensaje y no cambia nada. Si por algún motivo hay más de
-- un contrato con ese hueco, también se detiene (hay que revisarlo antes).
-- Todo ocurre en una sola transacción: o se aplica completo, o nada.
-- ============================================================

do $$
declare
  v_contratos uuid[];
begin
  select array_agg(distinct p.contrato_id) into v_contratos
  from public.partes_diarios p
  where p.numero_reporte > 43
    and not exists (
      select 1 from public.partes_diarios x
      where x.contrato_id = p.contrato_id and x.numero_reporte = 43
    );

  if v_contratos is null then
    raise exception 'Nada que corregir: ningún contrato tiene el hueco en el N° 43 (o ya se corrigió).';
  end if;
  if array_length(v_contratos, 1) > 1 then
    raise exception 'Se esperaba un solo contrato con el hueco en el N° 43 pero hay %: revisar antes de corregir.', array_length(v_contratos, 1);
  end if;

  -- En dos pasos (primero se aparta con un desplazamiento grande, después se
  -- baja): un UPDATE directo "numero_reporte - 1" puede chocar contra la
  -- restricción única (contrato, N°) a mitad de camino, porque Postgres la
  -- revisa fila por fila y no garantiza el orden.
  update public.partes_diarios
  set numero_reporte = numero_reporte + 100000
  where contrato_id = v_contratos[1] and numero_reporte > 43;

  update public.partes_diarios
  set numero_reporte = numero_reporte - 100001
  where contrato_id = v_contratos[1] and numero_reporte > 100043;

  -- El contador queda en el último número real del contrato.
  insert into public.secuencias_numero_parte (contrato_id, ultimo_valor)
  select contrato_id, max(numero_reporte)
  from public.partes_diarios
  where contrato_id = v_contratos[1]
  group by contrato_id
  on conflict (contrato_id) do update set ultimo_valor = excluded.ultimo_valor;
end $$;

notify pgrst, 'reload schema';

-- Verificación: debe verse 41, 42, 43, 44, 45… sin huecos, y el contador
-- igual al último número (el próximo reporte será el siguiente).
select 'REPORTE' as tipo, p.numero_reporte as numero,
       p.faena::text || ' · viaje ' || p.fecha::text || ' · ' || p.estado::text as detalle
from public.partes_diarios p
where p.numero_reporte >= 41
union all
select 'CONTADOR', s.ultimo_valor, 'último número asignado (contrato ' || s.contrato_id || ')'
from public.secuencias_numero_parte s
order by 1, 2;
