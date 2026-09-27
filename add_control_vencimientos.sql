-- ============================================================
-- Módulo "Control de Vencimientos" — pedido explícito 2026-09-27.
-- Especificación original escrita para Cloudflare D1/SQLite; se adapta acá
-- al stack real de la app (Postgres/Supabase + RLS), y "Funcionarios" pasa
-- a ser el mismo listado de trabajadores que ya existe en Organizador de
-- Turnos (cuadrillas_turno_trabajadores) en vez de una tabla nueva
-- duplicada — así un mismo RUT no queda cargado dos veces en dos tablas
-- distintas. Solo coordinador tiene acceso a este módulo.
--
-- documentos_vencimiento usa dos columnas de FK nullable (funcionario_id /
-- camioneta_id) en vez de la referencia polimórfica sin FK que trae la
-- especificación original (entidad_tipo + entidad_id sin FK real) — ese
-- patrón sin FK fue justo la causa de reservas_pasaje quedando huérfana al
-- borrar su trabajador (ver fix_reservas_pasaje_huerfanas_al_borrar_
-- trabajador.sql); acá se evita desde el diseño con "on delete cascade" en
-- ambas FKs y un check que exige que se use exactamente una de las dos.
-- ============================================================

create table if not exists public.camionetas (
  id uuid primary key default gen_random_uuid(),
  patente text unique not null,
  modelo text,

  creado_por uuid not null references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documentos_vencimiento (
  id uuid primary key default gen_random_uuid(),

  funcionario_id uuid references public.cuadrillas_turno_trabajadores(id) on delete cascade,
  camioneta_id uuid references public.camionetas(id) on delete cascade,

  nombre_documento text not null,
  fecha_vencimiento date not null,

  creado_por uuid not null references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint documentos_vencimiento_una_entidad check (
    (funcionario_id is not null and camioneta_id is null) or
    (funcionario_id is null and camioneta_id is not null)
  )
);

create index if not exists idx_documentos_vencimiento_fecha
  on public.documentos_vencimiento (fecha_vencimiento);
create index if not exists idx_documentos_vencimiento_funcionario
  on public.documentos_vencimiento (funcionario_id);
create index if not exists idx_documentos_vencimiento_camioneta
  on public.documentos_vencimiento (camioneta_id);

alter table public.camionetas enable row level security;
drop policy if exists "coordinador_todo_camionetas" on public.camionetas;
create policy "coordinador_todo_camionetas" on public.camionetas
  for all using (public.usuario_rol_actual() = 'coordinador')
  with check (public.usuario_rol_actual() = 'coordinador');

alter table public.documentos_vencimiento enable row level security;
drop policy if exists "coordinador_todo_documentos_vencimiento" on public.documentos_vencimiento;
create policy "coordinador_todo_documentos_vencimiento" on public.documentos_vencimiento
  for all using (public.usuario_rol_actual() = 'coordinador')
  with check (public.usuario_rol_actual() = 'coordinador');

notify pgrst, 'reload schema';
