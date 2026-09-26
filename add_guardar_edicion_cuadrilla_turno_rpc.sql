-- ============================================================
-- Hallazgo QA 2026-09-25: ModalEditarTurno.guardar() hacía
-- Promise.all(cambiosTrabajadores.map(db.actualizarTrabajadorCuadrilla))
-- y solo DESPUÉS de que esa promesa resolviera llamaba a
-- db.actualizarCuadrillaTurno para los campos propios de la cuadrilla
-- (nombre, patrón, fecha_inicio, color, config_subida/bajada_id).
--
-- Si UNO de los updates de trabajador fallaba (ej. RUT duplicado, corte de
-- red a medio Promise.all), Promise.all se rechazaba entero: los cambios de
-- cuadrilla nunca se guardaban, pero los trabajadores cuyo UPDATE individual
-- ya había alcanzado a la base SÍ quedaban escritos — a pesar de que la
-- modal mostraba un solo error genérico como si nada se hubiera guardado.
-- El coordinador reintentaba "guardar" completo confiando en ese mensaje,
-- sin saber que parte de los datos de trabajadores ya estaban aplicados.
--
-- Mismo patrón que mover_fecha_cuadrillas_turno (ver
-- add_mover_fecha_cuadrillas_turno_rpc.sql): una sola función que hace TODOS
-- los UPDATE (trabajadores + cuadrilla) en una única invocación — Postgres
-- ya corre el cuerpo completo de una función en la transacción de quien la
-- llama, así que o se guarda todo, o no se guarda nada. Sin "security
-- definer" a propósito: corre con los permisos de quien llama, la RLS de
-- cuadrillas_turno / cuadrillas_turno_trabajadores (solo coordinador) se
-- sigue aplicando igual que antes.
-- ============================================================

create or replace function public.guardar_edicion_cuadrilla_turno(
  p_cuadrilla_id uuid,
  p_trabajadores jsonb,
  p_nombre text,
  p_patron_dias_trabajo int,
  p_patron_dias_descanso int,
  p_patron_incluye_subida boolean,
  p_fecha_inicio date,
  p_color_tema text,
  p_config_subida_id uuid,
  p_config_bajada_id uuid
)
returns public.cuadrillas_turno
language plpgsql
set search_path to 'public'
as $function$
declare
  v_cuadrilla public.cuadrillas_turno;
begin
  update public.cuadrillas_turno_trabajadores as t
  set nombre = c.nombre,
      apellido = c.apellido,
      rut = c.rut,
      cargo = c.cargo
  from jsonb_to_recordset(p_trabajadores) as c(id uuid, nombre text, apellido text, rut text, cargo text)
  where t.id = c.id;

  update public.cuadrillas_turno
  set nombre = p_nombre,
      patron_dias_trabajo = p_patron_dias_trabajo,
      patron_dias_descanso = p_patron_dias_descanso,
      patron_incluye_subida = p_patron_incluye_subida,
      fecha_inicio = p_fecha_inicio,
      color_tema = p_color_tema,
      config_subida_id = p_config_subida_id,
      config_bajada_id = p_config_bajada_id,
      updated_at = now()
  where id = p_cuadrilla_id
  returning * into v_cuadrilla;

  return v_cuadrilla;
end;
$function$;

grant execute on function public.guardar_edicion_cuadrilla_turno(uuid, jsonb, text, int, int, boolean, date, text, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
