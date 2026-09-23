-- ============================================================
-- Módulo "Organizador de Turnos" — carta Gantt de cuadrillas mineras
-- (patrones 14x14, 7x7, 4x3, personalizados), independiente de faena/
-- contrato (pedido explícito) y de coordinador únicamente, mismo patrón
-- que add_entrega_turno.sql.
-- ============================================================

create table if not exists public.cuadrillas_turno (
  id uuid primary key default gen_random_uuid(),

  nombre text not null,

  -- Patrón de turno (días de trabajo x días de descanso). "personalizado"
  -- cuando no calza con ningún preset fijo (14x14, 7x7, 4x3) del frontend.
  patron_dias_trabajo integer not null check (patron_dias_trabajo > 0),
  patron_dias_descanso integer not null check (patron_dias_descanso > 0),
  patron_incluye_subida boolean not null default true,

  -- Fecha base del primer día de turno (Día 1) de la cuadrilla.
  fecha_inicio date not null,

  -- Id del tema de color (paleta fija en el frontend: amber, blue,
  -- emerald, purple, indigo, rose, teal, cyan) — no se guarda el CSS acá.
  color_tema text not null default 'amber',

  -- Orden de la fila en la carta Gantt (reordenable por arrastre). Se
  -- reescribe completo (0..n-1) cada vez que el coordinador reordena.
  orden integer not null default 0,

  creado_por uuid not null references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cuadrillas_turno_trabajadores (
  id uuid primary key default gen_random_uuid(),
  cuadrilla_id uuid not null references public.cuadrillas_turno(id) on delete cascade,

  nombre text not null,
  apellido text not null,
  rut text not null,
  cargo text not null,

  created_at timestamptz not null default now()
);

create index if not exists idx_cuadrillas_turno_orden
  on public.cuadrillas_turno (orden);

create index if not exists idx_cuadrillas_turno_trabajadores_cuadrilla
  on public.cuadrillas_turno_trabajadores (cuadrilla_id);

alter table public.cuadrillas_turno enable row level security;
alter table public.cuadrillas_turno_trabajadores enable row level security;

drop policy if exists "coordinador_todo_cuadrillas_turno" on public.cuadrillas_turno;
create policy "coordinador_todo_cuadrillas_turno" on public.cuadrillas_turno
  for all using (public.usuario_rol_actual() = 'coordinador')
  with check (public.usuario_rol_actual() = 'coordinador');

drop policy if exists "coordinador_todo_cuadrillas_turno_trabajadores" on public.cuadrillas_turno_trabajadores;
create policy "coordinador_todo_cuadrillas_turno_trabajadores" on public.cuadrillas_turno_trabajadores
  for all using (public.usuario_rol_actual() = 'coordinador')
  with check (public.usuario_rol_actual() = 'coordinador');
