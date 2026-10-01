-- ============================================================
-- Turno 5x2 con traslado diario (pedido explícito 2026-10-02): a
-- diferencia de 14x14/7x7/4x3 (la cuadrilla pernocta en faena durante el
-- bloque de trabajo: un solo tránsito de subida al empezar y uno de
-- bajada al terminar), acá la cuadrilla NO pernocta — cada día de trabajo
-- genera su propia subida Y bajada. El motor de turnos (motorTurnos.ts)
-- ya sabe generar esos días como SegmentoTurno.tipo 'SUBIDA_BAJADA' y
-- Reservas de Pasajes ya sabe convertir eso en dos candidatos (uno de
-- subida, uno de bajada) — esta migración solo agrega la columna que les
-- dice cuándo hacerlo.
-- ============================================================

alter table public.cuadrillas_turno
  add column if not exists patron_traslado_diario boolean not null default false;

-- guardar_edicion_cuadrilla_turno (ver add_guardar_edicion_cuadrilla_turno_rpc.sql)
-- agrega el parámetro p_patron_traslado_diario — cambia la firma de la
-- función, así que hay que borrar la versión vieja antes de recrearla o
-- queda un overload viejo sin uso colgando.
drop function if exists public.guardar_edicion_cuadrilla_turno(uuid, jsonb, text, int, int, boolean, date, text, uuid, uuid);

create or replace function public.guardar_edicion_cuadrilla_turno(
  p_cuadrilla_id uuid,
  p_trabajadores jsonb,
  p_nombre text,
  p_patron_dias_trabajo int,
  p_patron_dias_descanso int,
  p_patron_incluye_subida boolean,
  p_patron_traslado_diario boolean,
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
      patron_traslado_diario = p_patron_traslado_diario,
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

grant execute on function public.guardar_edicion_cuadrilla_turno(uuid, jsonb, text, int, int, boolean, boolean, date, text, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
