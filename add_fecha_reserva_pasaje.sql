-- ============================================================
-- Reservas de Pasajes: fecha en que se hizo/asignó la reserva.
-- Distinta de `fecha` (la de subida/bajada del trabajador, calculada por
-- el motor de turnos) — pedido explícito 2026-09-24: un selector de fecha
-- en el encabezado de cada grupo de día, junto con Encargado (que ya
-- existía como columna pero ahora también se edita ahí, uno por día en
-- vez de uno por trabajador). Ver ReservasPasajes.tsx.
-- ============================================================

alter table public.reservas_pasaje add column if not exists fecha_reserva date;
