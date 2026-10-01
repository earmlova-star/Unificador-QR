-- ============================================================
-- Subidas/Bajadas sueltas múltiples (pedido explícito 2026-10-02): el
-- modal "+ ▲ Subida" / "+ ▼ Bajada" pasa a poder crear varias fechas de
-- una sola vez (misma lista de funcionarios, mismo tipo y configuración
-- de viaje para todas) — antes era una fecha por guardado.
--
-- Mismo motivo que guardar_edicion_cuadrilla_turno/
-- mover_fecha_cuadrillas_turno: crear N eventos + sus trabajadores con N
-- llamadas secuenciales desde el cliente (un insert de evento + un insert
-- de trabajadores por cada fecha) deja la puerta abierta a que una falle
-- a medio camino (ej. fecha 3 de 5) y el usuario quede con fechas 1-2 ya
-- creadas en la base mientras la pantalla muestra un solo error genérico
-- como si nada se hubiera guardado. Una sola función que hace TODOS los
-- inserts (eventos + trabajadores de cada uno) en una única invocación
-- evita ese estado intermedio — o se crean todas las fechas, o ninguna.
-- Sin "security definer": corre con los permisos de quien llama, la RLS
-- de eventos_transito / eventos_transito_trabajadores (coordinador y
-- consultor) se sigue aplicando igual que antes.
--
-- p_trabajadores es LA MISMA lista para todas las fechas (pedido
-- explícito: "los mismos funcionarios para todas las fechas") — se
-- inserta una copia independiente por cada evento creado, así que editar
-- o eliminar un trabajador de una fecha después no afecta a las demás.
-- ============================================================

create or replace function public.crear_eventos_transito_multiples(
  p_tipo text,
  p_fechas date[],
  p_configuracion_id uuid,
  p_trabajadores jsonb,
  p_creado_por uuid
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_fecha date;
  v_evento public.eventos_transito;
  v_trabajadores_evento jsonb;
  v_resultado jsonb := '[]'::jsonb;
begin
  foreach v_fecha in array p_fechas loop
    insert into public.eventos_transito (tipo, fecha, configuracion_id, creado_por)
    values (p_tipo, v_fecha, p_configuracion_id, p_creado_por)
    returning * into v_evento;

    with insertados as (
      insert into public.eventos_transito_trabajadores (evento_id, nombre, apellido, rut, cargo)
      select v_evento.id, c.nombre, c.apellido, c.rut, c.cargo
      from jsonb_to_recordset(p_trabajadores) as c(nombre text, apellido text, rut text, cargo text)
      returning *
    )
    select coalesce(jsonb_agg(to_jsonb(insertados)), '[]'::jsonb) into v_trabajadores_evento from insertados;

    v_resultado := v_resultado || jsonb_build_object(
      'id', v_evento.id,
      'tipo', v_evento.tipo,
      'fecha', v_evento.fecha,
      'configuracion_id', v_evento.configuracion_id,
      'creado_por', v_evento.creado_por,
      'created_at', v_evento.created_at,
      'updated_at', v_evento.updated_at,
      'trabajadores', v_trabajadores_evento
    );
  end loop;

  return v_resultado;
end;
$function$;

grant execute on function public.crear_eventos_transito_multiples(text, date[], uuid, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
