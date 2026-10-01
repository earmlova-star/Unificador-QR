-- Pedido explícito 2026-10-02: nivel más externo en Reservas de Pasajes
-- ("Turno H", "Turno AB"), que agrupa varias Configuraciones de viaje
-- (ej. la de subida y la de bajada de un mismo turno operativo) por un
-- nombre común, sin importar el nombre real de la cuadrilla/turno de
-- cada una — ver ReservasPasajes.tsx.
alter table configuraciones_viaje
  add column if not exists grupo_webcontrol text;
