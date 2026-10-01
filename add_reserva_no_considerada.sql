-- Pedido explícito 2026-10-02: botón "Reserva no considerada" en
-- Reservas de Pasajes, igual que "Confirmada" pero para descartar una
-- reserva (queda en gris y al final de su tabla, ver ReservasPasajes.tsx).
alter table reservas_pasaje
  add column if not exists no_considerada boolean not null default false;
