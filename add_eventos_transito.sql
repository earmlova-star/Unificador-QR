-- ============================================================
-- Módulo "Organizador de Turnos": Subida o Bajada sueltas, de un solo día
-- — pedido explícito 2026-09-24. Independientes de cualquier Turno/
-- cuadrilla (no repiten ningún ciclo, ver CuadrillaTurno/motorTurnos.ts).
-- Mismo acceso que cuadrillas_turno (coordinador y consultor, ver
-- fix_organizador_turnos_rol_consultor.sql).
--
-- eventos_transito_trabajadores mismo patrón que
-- cuadrillas_turno_trabajadores: se borran en cascada con su evento.
-- ============================================================

create table if not exists public.eventos_transito (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('subida', 'bajada')),
  fecha date not null,

  creado_por uuid not null references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_eventos_transito_fecha
  on public.eventos_transito (fecha);

create table if not exists public.eventos_transito_trabajadores (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos_transito(id) on delete cascade,

  nombre text not null,
  apellido text not null,
  rut text not null,
  cargo text not null,

  created_at timestamptz not null default now()
);

create index if not exists idx_eventos_transito_trabajadores_evento
  on public.eventos_transito_trabajadores (evento_id);

alter table public.eventos_transito enable row level security;
drop policy if exists "coordinador_consultor_todo_eventos_transito" on public.eventos_transito;
create policy "coordinador_consultor_todo_eventos_transito" on public.eventos_transito
  for all using (public.usuario_rol_actual() in ('coordinador', 'consultor'))
  with check (public.usuario_rol_actual() in ('coordinador', 'consultor'));

alter table public.eventos_transito_trabajadores enable row level security;
drop policy if exists "coordinador_consultor_todo_eventos_transito_trabajadores" on public.eventos_transito_trabajadores;
create policy "coordinador_consultor_todo_eventos_transito_trabajadores" on public.eventos_transito_trabajadores
  for all using (public.usuario_rol_actual() in ('coordinador', 'consultor'))
  with check (public.usuario_rol_actual() in ('coordinador', 'consultor'));

-- Reservas de Pasajes (pedido explícito: las subidas/bajadas sueltas
-- también deben poder reservarse ahí, igual que las de un turno normal).
-- reservas_pasaje.trabajador_id tenía FK solo a cuadrillas_turno_trabajadores
-- — se saca esa FK para poder referenciar también a un trabajador de un
-- evento_transito suelto, sin duplicar la tabla de reservas.
alter table public.reservas_pasaje drop constraint if exists reservas_pasaje_trabajador_id_fkey;
