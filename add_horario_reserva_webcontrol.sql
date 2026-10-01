-- Pedido explícito 2026-10-02: el subgrupo de Reservas de Pasajes se
-- nombra con el horario al que hay que reservar en Webcontrol (sistema
-- externo de la empresa de buses), distinto del horario real de viaje
-- (columna "hora", ya existente) — ver ReservasPasajes.tsx.
alter table configuraciones_viaje
  add column if not exists horario_reserva_webcontrol text;
