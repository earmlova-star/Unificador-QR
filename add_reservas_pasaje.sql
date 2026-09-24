-- ============================================================
-- Módulo "Reservas de Pasajes" (pestaña dentro de Organizador de Turnos).
-- Organiza la reserva de buses según las subidas y bajadas de cada
-- cuadrilla (calculadas por el motor de turnos, no se guardan acá) y
-- persiste solo el estado propio de cada reserva: horario, confirmación,
-- encargado y observaciones. Mismo acceso que cuadrillas_turno
-- (coordinador y consultor, ver fix_organizador_turnos_rol_consultor.sql).
--
-- Una fila por (trabajador, fecha, tipo) — "tipo" distingue si esa fecha
-- es su subida o su bajada, porque una cuadrilla puede tener ambas en
-- fechas cercanas. Se crea/actualiza con upsert (on conflict) recién
-- cuando alguien edita algo de esa reserva; hasta entonces la fila
-- candidata solo existe calculada en el frontend, no en la base.
-- ============================================================

create table if not exists public.reservas_pasaje (
  id uuid primary key default gen_random_uuid(),
  trabajador_id uuid not null references public.cuadrillas_turno_trabajadores(id) on delete cascade,

  fecha date not null,
  tipo text not null check (tipo in ('subida', 'bajada')),

  origen text not null,
  destino text not null,
  horario text,

  confirmada boolean not null default false,
  confirmada_por uuid references public.usuarios(id),
  confirmada_en timestamptz,

  encargado_reserva text,
  observaciones text,

  creado_por uuid not null references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (trabajador_id, fecha, tipo)
);

create index if not exists idx_reservas_pasaje_fecha
  on public.reservas_pasaje (fecha);

alter table public.reservas_pasaje enable row level security;

drop policy if exists "coordinador_consultor_todo_reservas_pasaje" on public.reservas_pasaje;
create policy "coordinador_consultor_todo_reservas_pasaje" on public.reservas_pasaje
  for all using (public.usuario_rol_actual() in ('coordinador', 'consultor'))
  with check (public.usuario_rol_actual() in ('coordinador', 'consultor'));
