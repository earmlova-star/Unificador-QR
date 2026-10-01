-- ============================================================
-- Limpieza (pedido explícito 2026-10-02): acumulados_base_faena fue un
-- mecanismo de traspaso PUNTUAL (LB arrancaba su propia cadena desde el
-- total de LT al momento de correr add_acumulados_base_faena.sql), pensado
-- para cuando cada faena corría su propia cadena de acumulados por
-- separado.
--
-- Ahora hay una sola cadena de acumulados por CONTRATO (ver
-- recalcularAcumuladosContrato en supabase.ts), ordenada por N° de reporte
-- sin importar la faena de cada uno — ya no hay nada que "traspasar": el
-- contrato entero se recalcula siempre desde cero en cada guardado. Esta
-- tabla quedó sin ningún código que la lea ni la escriba; se borra para no
-- dejar un mecanismo muerto confundiendo a quien mire el esquema después.
-- ============================================================

drop table if exists public.acumulados_base_faena;

notify pgrst, 'reload schema';
