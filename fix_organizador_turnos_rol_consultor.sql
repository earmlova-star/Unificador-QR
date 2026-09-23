-- ============================================================
-- Organizador de Turnos: agrega acceso (ver y editar) al rol consultor,
-- que antes era solo coordinador (ver add_organizador_turnos.sql).
-- Mismo patrón que Compras (usuario.rol === COORDINADOR || CONSULTOR).
-- ============================================================

drop policy if exists "coordinador_todo_cuadrillas_turno" on public.cuadrillas_turno;
create policy "coordinador_consultor_todo_cuadrillas_turno" on public.cuadrillas_turno
  for all using (public.usuario_rol_actual() in ('coordinador', 'consultor'))
  with check (public.usuario_rol_actual() in ('coordinador', 'consultor'));

drop policy if exists "coordinador_todo_cuadrillas_turno_trabajadores" on public.cuadrillas_turno_trabajadores;
create policy "coordinador_consultor_todo_cuadrillas_turno_trabajadores" on public.cuadrillas_turno_trabajadores
  for all using (public.usuario_rol_actual() in ('coordinador', 'consultor'))
  with check (public.usuario_rol_actual() in ('coordinador', 'consultor'));
