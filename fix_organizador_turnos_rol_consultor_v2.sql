-- ============================================================
-- Organizador de Turnos: re-aplica el acceso de consultor de forma
-- más agresiva (elimina CUALQUIER policy existente en estas dos tablas,
-- sin importar el nombre, antes de recrear la correcta) por si
-- fix_organizador_turnos_rol_consultor.sql no llegó a aplicarse o quedó
-- una policy vieja con otro nombre bloqueando. Termina con dos SELECT
-- de verificación — copia su resultado de vuelta para confirmar.
-- ============================================================

do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'cuadrillas_turno'
  loop
    execute format('drop policy %I on public.cuadrillas_turno', pol.policyname);
  end loop;

  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'cuadrillas_turno_trabajadores'
  loop
    execute format('drop policy %I on public.cuadrillas_turno_trabajadores', pol.policyname);
  end loop;
end $$;

create policy "coordinador_consultor_todo_cuadrillas_turno" on public.cuadrillas_turno
  for all using (public.usuario_rol_actual() in ('coordinador', 'consultor'))
  with check (public.usuario_rol_actual() in ('coordinador', 'consultor'));

create policy "coordinador_consultor_todo_cuadrillas_turno_trabajadores" on public.cuadrillas_turno_trabajadores
  for all using (public.usuario_rol_actual() in ('coordinador', 'consultor'))
  with check (public.usuario_rol_actual() in ('coordinador', 'consultor'));

-- ---- Verificación 1: deben aparecer exactamente estas dos policies ----
select tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename in ('cuadrillas_turno', 'cuadrillas_turno_trabajadores');

-- ---- Verificación 2: revisa que el usuario consultor de prueba esté
-- activo (si "estado" no es 'activo', usuario_rol_actual() devuelve NULL
-- y la política de arriba no deja ver nada, sin ningún error visible) ----
select id, nombre, email, rol, estado
from public.usuarios
where rol = 'consultor';
