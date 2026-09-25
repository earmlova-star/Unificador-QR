-- ============================================================
-- Hallazgo QA 2026-09-25 (severidad alta): el trigger
-- mandante_solo_comenta() en partes_diarios solo valida algo cuando
-- usuario_rol_actual() = 'mandante' — para cualquier otro rol hace
-- `return new;` sin ninguna verificación. Su propósito real (según su
-- propio mensaje de excepción) es restringir al MANDANTE a solo tocar sus
-- campos de comentario, no proteger esos campos de otros roles.
--
-- Efecto: nada en la base impedía que un apr o coordinador (que ya tienen
-- permiso de UPDATE sobre partes propios/todos vía RLS) escribiera
-- comentario_mandante / comentario_mandante_autor / comentario_mandante_por
-- / comentario_mandante_fecha — la única protección era que el frontend
-- nunca llama a comentarComoMandante() fuera de la UI del mandante. Un
-- PATCH directo a la REST API (sin pasar por el frontend) podía forjar un
-- "comentario del mandante" con el estado y la fecha que quisiera.
--
-- Fix: mismo trigger, pero ahora también valida el caso contrario — si el
-- rol NO es mandante, bloquea cualquier cambio a los 4 campos de
-- comentario del mandante (el resto de los campos, incluido `estado`,
-- sigue sin restricción para apr/coordinador, igual que hoy).
-- ============================================================

create or replace function public.mandante_solo_comenta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public.usuario_rol_actual() = 'mandante' then
    if (new.contrato_id, new.numero_reporte, new.fecha, new.faena,
        new.condicion_climatica, new.actividades, new.mano_obra_directa,
        new.mano_obra_indirecta, new.maquinaria, new.jornada,
        new.hh_directas_programado, new.hh_indirectas_programado,
        new.hh_directas_acumuladas, new.hm_acumuladas,
        new.hh_indirectas_acumuladas, new.fotos,
        new.comentario_contratista_autor, new.comentario_contratista,
        new.excel_url, new.creado_por)
       is distinct from
       (old.contrato_id, old.numero_reporte, old.fecha, old.faena,
        old.condicion_climatica, old.actividades, old.mano_obra_directa,
        old.mano_obra_indirecta, old.maquinaria, old.jornada,
        old.hh_directas_programado, old.hh_indirectas_programado,
        old.hh_directas_acumuladas, old.hm_acumuladas,
        old.hh_indirectas_acumuladas, old.fotos,
        old.comentario_contratista_autor, old.comentario_contratista,
        old.excel_url, old.creado_por)
    then
      raise exception 'El mandante solo puede agregar su comentario, no modificar el contenido del reporte';
    end if;
  else
    if (new.comentario_mandante, new.comentario_mandante_autor,
        new.comentario_mandante_por, new.comentario_mandante_fecha)
       is distinct from
       (old.comentario_mandante, old.comentario_mandante_autor,
        old.comentario_mandante_por, old.comentario_mandante_fecha)
    then
      raise exception 'Solo el mandante puede modificar el comentario del mandante';
    end if;
  end if;

  return new;
end;
$function$;

notify pgrst, 'reload schema';
