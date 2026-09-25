-- ============================================================
-- Subidas/Bajadas sueltas (eventos_transito): permite asignarles una
-- ConfiguracionViaje al crearlas, igual que ya se puede con un Turno
-- (cuadrillas_turno.config_subida_id/config_bajada_id) — pedido explícito
-- 2026-09-25. Una sola columna acá (no dos como en cuadrillas_turno)
-- porque un evento_transito ya tiene su `tipo` fijo (subida o bajada), a
-- diferencia de un turno que necesita una de cada una.
-- ============================================================

alter table public.eventos_transito
  add column if not exists configuracion_id uuid references public.configuraciones_viaje(id) on delete set null;

notify pgrst, 'reload schema';
