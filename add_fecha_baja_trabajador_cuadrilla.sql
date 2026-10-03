-- ============================================================
-- Baja con fecha de un trabajador de turno (pedido explícito 2026-10-03):
-- al sacar a alguien de un turno NO se quiere perder sus reservas de
-- pasajes anteriores a la baja.
--
-- Hasta ahora "sacar" era borrar la fila del trabajador, y un trigger
-- (trg_limpiar_reservas_pasaje_cuadrilla, ver
-- fix_reservas_pasaje_huerfanas_al_borrar_trabajador.sql) borraba en
-- cascada TODAS sus reservas (confirmaciones, horarios, observaciones);
-- además, documentos_vencimiento.funcionario_id tiene "on delete cascade",
-- así que también se iban sus vencimientos.
--
-- Ahora la baja es solo una fecha: el trabajador sigue existiendo y
-- Reservas de Pasajes lo calcula hasta esa fecha inclusive (null = activo,
-- sin baja). Es un UPDATE, no un DELETE, así que el trigger no se dispara
-- y nada se borra. "Eliminar definitivamente" sigue siendo un DELETE (con
-- su advertencia en la pantalla).
--
-- Columna nullable: la app vieja simplemente la ignora, así que se puede
-- correr antes de desplegar la nueva.
-- ============================================================

alter table public.cuadrillas_turno_trabajadores
  add column if not exists fecha_baja date;

notify pgrst, 'reload schema';

-- Verificación: debe aparecer la columna fecha_baja (tipo date, nullable).
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'cuadrillas_turno_trabajadores'
  and column_name = 'fecha_baja';
