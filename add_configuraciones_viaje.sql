-- ============================================================
-- Reservas de Pasajes: configuraciones reusables de Origen/Destino/Hora,
-- asignables manualmente a un turno — pedido explícito 2026-09-25.
-- Reemplaza la regla fija que existía antes (subida 17:00 → hotel): ahora
-- esa misma regla se crea como una fila acá (una configuración de Subida
-- y otra de Bajada) y se asigna a los turnos que corresponda, en vez de
-- estar hardcodeada en el código.
--
-- Un turno puede tener una configuración para su subida y otra para su
-- bajada (cuadrillas_turno.config_subida_id / config_bajada_id). Si no
-- tiene ninguna asignada, Reservas de Pasajes sigue usando el Origen/
-- Destino genérico (Terminal ↔ Faena) de siempre.
-- ============================================================

create table if not exists public.configuraciones_viaje (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('subida', 'bajada')),
  origen text not null,
  destino text not null,
  hora text not null,

  creado_por uuid not null references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_configuraciones_viaje_tipo
  on public.configuraciones_viaje (tipo);

alter table public.configuraciones_viaje enable row level security;
drop policy if exists "coordinador_consultor_todo_configuraciones_viaje" on public.configuraciones_viaje;
create policy "coordinador_consultor_todo_configuraciones_viaje" on public.configuraciones_viaje
  for all using (public.usuario_rol_actual() in ('coordinador', 'consultor'))
  with check (public.usuario_rol_actual() in ('coordinador', 'consultor'));

-- "on delete set null": si se borra una configuración, los turnos que la
-- tenían asignada vuelven a usar el Origen/Destino genérico, en vez de
-- que el borrado falle o arrastre al turno con ella.
alter table public.cuadrillas_turno
  add column if not exists config_subida_id uuid references public.configuraciones_viaje(id) on delete set null,
  add column if not exists config_bajada_id uuid references public.configuraciones_viaje(id) on delete set null;

-- Ver incidente 2026-09-24 (add_eventos_transito.sql): esto evita que el
-- caché de PostgREST tarde en enterarse de las tablas/columnas nuevas.
notify pgrst, 'reload schema';
