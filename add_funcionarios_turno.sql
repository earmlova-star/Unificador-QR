-- ============================================================
-- Organizador de Turnos: base de datos de funcionarios (pedido explícito
-- 2026-10-02). Es el directorio que alimenta el buscador con
-- autocompletado al agregar un funcionario a una Subida/Bajada suelta:
-- al elegir uno se completan solos nombre, apellido, RUT y cargo.
--
-- Es un directorio aparte: agregar/editar/borrar acá NO modifica a los
-- funcionarios ya asignados a un turno o a una subida/bajada (cada uno
-- conserva su propia copia, como hasta ahora).
--
-- Mismo acceso que el resto del módulo (coordinador y consultor).
-- ============================================================

create table if not exists public.funcionarios_turno (
  id uuid primary key default gen_random_uuid(),

  nombre text not null,
  apellido text not null,
  rut text not null,
  cargo text not null,
  -- Turno al que pertenece (texto libre, normalmente el nombre de una
  -- cuadrilla). Opcional: quien solo viaja en subidas/bajadas sueltas no
  -- tiene turno.
  turno text,

  -- Null en los cargados desde esta migración (se ejecuta sin sesión).
  creado_por uuid references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un funcionario por RUT, sin importar puntos/guion/mayúscula de la K.
create unique index if not exists uq_funcionarios_turno_rut
  on public.funcionarios_turno (upper(replace(replace(rut, '.', ''), '-', '')));

alter table public.funcionarios_turno enable row level security;

drop policy if exists "coordinador_consultor_todo_funcionarios_turno" on public.funcionarios_turno;
create policy "coordinador_consultor_todo_funcionarios_turno" on public.funcionarios_turno
  for all using (public.usuario_rol_actual() in ('coordinador', 'consultor'))
  with check (public.usuario_rol_actual() in ('coordinador', 'consultor'));

-- ---- Carga inicial con los funcionarios que ya existen ----
-- Toma los trabajadores de todos los turnos y de las subidas/bajadas
-- sueltas. Si una persona aparece más de una vez (mismo RUT), se queda
-- con una sola fila: prioriza la que viene de un turno (para poder
-- completar "Turno") y, entre esas, la más reciente.
-- Se puede volver a ejecutar sin riesgo: solo agrega los que falten.
insert into public.funcionarios_turno (nombre, apellido, rut, cargo, turno)
select distinct on (clave) nombre, apellido, rut, cargo, turno
from (
  select
    btrim(t.nombre) as nombre,
    btrim(t.apellido) as apellido,
    btrim(t.rut) as rut,
    btrim(t.cargo) as cargo,
    c.nombre as turno,
    upper(replace(replace(t.rut, '.', ''), '-', '')) as clave,
    1 as prioridad,
    t.created_at
  from public.cuadrillas_turno_trabajadores t
  join public.cuadrillas_turno c on c.id = t.cuadrilla_id

  union all

  select
    btrim(e.nombre),
    btrim(e.apellido),
    btrim(e.rut),
    btrim(e.cargo),
    null,
    upper(replace(replace(e.rut, '.', ''), '-', '')),
    2,
    e.created_at
  from public.eventos_transito_trabajadores e
) origen
order by clave, prioridad, created_at desc
on conflict do nothing;

notify pgrst, 'reload schema';

-- Verificación: cuántos quedaron cargados.
select count(*) as funcionarios_cargados from public.funcionarios_turno;
