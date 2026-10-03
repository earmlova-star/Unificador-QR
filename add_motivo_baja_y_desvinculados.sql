-- ============================================================
-- Baja con motivo + grupo "Desvinculados" en Funcionarios (pedido
-- explícito 2026-10-03). Complementa add_fecha_baja_trabajador_cuadrilla.sql.
--
--  * Al dar de baja a un trabajador de turno se pide el MOTIVO
--    (Renuncia Voluntaria, Despido Directo, Traslado — y los que se agreguen
--    con el botón de agregado rápido; ver motivos_baja).
--  * La baja se refleja en el directorio de Funcionarios (funcionarios_turno):
--    el funcionario pasa a "Desvinculado" con su fecha y motivo, y deja de
--    contar en el resumen de cargos vigentes.
--
-- El directorio es independiente de los trabajadores de turno (no hay FK),
-- así que el enlace es por RUT (sin puntos, guion ni mayúscula de la K), igual
-- que su índice único. Dar de baja / reintegrar actualiza AMBAS tablas en una
-- sola transacción (una función), para no dejarlas desincronizadas.
--
-- Compatible con la app anterior (solo agrega columnas nullable y funciones
-- nuevas): se puede correr antes de desplegar la versión nueva.
-- ============================================================

-- 1) Columnas de motivo / baja ---------------------------------------------
alter table public.cuadrillas_turno_trabajadores
  add column if not exists motivo_baja text;

alter table public.funcionarios_turno
  add column if not exists fecha_baja date,
  add column if not exists motivo_baja text;

-- 2) Lista de motivos (para el selector y el botón de agregado rápido) ------
-- Los registros de baja guardan el NOMBRE del motivo como texto (no una FK):
-- así borrar o renombrar un motivo de esta lista no altera el historial.
create table if not exists public.motivos_baja (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  creado_por uuid references public.usuarios(id),
  created_at timestamptz not null default now()
);

create unique index if not exists uq_motivos_baja_nombre
  on public.motivos_baja (lower(btrim(nombre)));

alter table public.motivos_baja enable row level security;

drop policy if exists "coordinador_consultor_todo_motivos_baja" on public.motivos_baja;
create policy "coordinador_consultor_todo_motivos_baja" on public.motivos_baja
  for all using (public.usuario_rol_actual() in ('coordinador', 'consultor'))
  with check (public.usuario_rol_actual() in ('coordinador', 'consultor'));

-- Los tres motivos de siempre; created_at escalonado solo para que la app los
-- liste en este orden (se ordena por created_at) y los nuevos queden después.
insert into public.motivos_baja (nombre, created_at)
values ('Renuncia Voluntaria', now() - interval '2 minutes'),
       ('Despido Directo', now() - interval '1 minute'),
       ('Traslado', now())
on conflict do nothing;

-- 3) Dar de baja: trabajador + directorio en una sola transacción -----------
-- Sin "security definer" a propósito: corre con los permisos de quien llama
-- (coordinador / consultor, que son los mismos con acceso a ambas tablas).
create or replace function public.dar_de_baja_trabajador_cuadrilla(
  p_trabajador_id uuid,
  p_fecha_baja date,
  p_motivo text
)
returns public.cuadrillas_turno_trabajadores
language plpgsql
set search_path to 'public'
as $function$
declare
  v_trabajador public.cuadrillas_turno_trabajadores;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if p_fecha_baja is null then
    raise exception 'La fecha de baja es obligatoria';
  end if;
  if v_motivo = '' then
    raise exception 'El motivo de la baja es obligatorio';
  end if;

  update public.cuadrillas_turno_trabajadores
  set fecha_baja = p_fecha_baja, motivo_baja = v_motivo
  where id = p_trabajador_id
  returning * into v_trabajador;

  if not found then
    raise exception 'No existe el trabajador %', p_trabajador_id;
  end if;

  -- Directorio: si ya está (mismo RUT) se marca desvinculado; si todavía no
  -- estaba cargado, se crea ya como desvinculado para que el resumen de
  -- Funcionarios lo cuente en el grupo "Desvinculados".
  insert into public.funcionarios_turno as f (nombre, apellido, rut, cargo, turno, creado_por, fecha_baja, motivo_baja)
  select v_trabajador.nombre, v_trabajador.apellido, v_trabajador.rut, v_trabajador.cargo,
         (select c.nombre from public.cuadrillas_turno c where c.id = v_trabajador.cuadrilla_id),
         auth.uid(), p_fecha_baja, v_motivo
  on conflict (upper(replace(replace(rut, '.', ''), '-', ''))) do update
    set fecha_baja = excluded.fecha_baja,
        motivo_baja = excluded.motivo_baja,
        turno = coalesce(f.turno, excluded.turno),
        updated_at = now();

  return v_trabajador;
end;
$function$;

-- 4) Reintegrar: deshace la baja en ambas tablas ----------------------------
create or replace function public.reintegrar_trabajador_cuadrilla(p_trabajador_id uuid)
returns public.cuadrillas_turno_trabajadores
language plpgsql
set search_path to 'public'
as $function$
declare
  v_trabajador public.cuadrillas_turno_trabajadores;
begin
  update public.cuadrillas_turno_trabajadores
  set fecha_baja = null, motivo_baja = null
  where id = p_trabajador_id
  returning * into v_trabajador;

  if not found then
    raise exception 'No existe el trabajador %', p_trabajador_id;
  end if;

  update public.funcionarios_turno
  set fecha_baja = null, motivo_baja = null, updated_at = now()
  where upper(replace(replace(rut, '.', ''), '-', '')) = upper(replace(replace(v_trabajador.rut, '.', ''), '-', ''));

  return v_trabajador;
end;
$function$;

grant execute on function public.dar_de_baja_trabajador_cuadrilla(uuid, date, text) to authenticated;
grant execute on function public.reintegrar_trabajador_cuadrilla(uuid) to authenticated;

-- 5) Bajas que ya existían (hechas con la versión anterior, sin motivo): se
--    reflejan en el directorio con su fecha; el motivo queda "no registrado".
update public.funcionarios_turno as f
set fecha_baja = t.fecha_baja, updated_at = now()
from public.cuadrillas_turno_trabajadores as t
where t.fecha_baja is not null
  and upper(replace(replace(t.rut, '.', ''), '-', '')) = upper(replace(replace(f.rut, '.', ''), '-', ''))
  and f.fecha_baja is distinct from t.fecha_baja;

notify pgrst, 'reload schema';

-- Verificación: motivos cargados, columnas nuevas y funciones.
select 'motivo' as chequeo, nombre as resultado from public.motivos_baja
union all
select 'columna ' || table_name || '.' || column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'cuadrillas_turno_trabajadores' and column_name = 'motivo_baja')
    or (table_name = 'funcionarios_turno' and column_name in ('fecha_baja', 'motivo_baja')))
union all
select 'función', proname::text
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('dar_de_baja_trabajador_cuadrilla', 'reintegrar_trabajador_cuadrilla')
order by 1, 2;
