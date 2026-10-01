-- ============================================================
-- Arrastre de HH acumuladas entre faenas (pedido explícito 2026-10-01):
-- hasta ahora la cadena de acumulados de cada faena (ver acumularCadena en
-- calculosHH.ts) siempre arrancaba en 0 — cada faena corre su propia
-- cuenta desde cero, de forma completamente independiente. Los Bronces
-- (LB) ahora debe arrancar su cadena desde donde quedó Las Tórtolas (LT)
-- al día de hoy — un traspaso de posta puntual, no una fusión permanente:
-- si algún día se crea un nuevo Daily Report de LT, su propia cadena
-- sigue siendo la de siempre, sin tocar la de LB.
--
-- Esta tabla guarda ese punto de partida por (contrato, faena) — sin fila
-- = 0/0/0, el comportamiento de toda la vida. recalcularAcumuladosFaenaSinBloqueo
-- (supabase.ts) la lee y la pasa como semilla de acumularCadena en vez de
-- arrancar siempre en 0.
-- ============================================================

create table if not exists public.acumulados_base_faena (
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  faena text not null check (faena in ('LT', 'LB')),

  hh_directas_base numeric not null default 0,
  hm_base numeric not null default 0,
  hh_indirectas_base numeric not null default 0,

  updated_at timestamptz not null default now(),

  primary key (contrato_id, faena)
);

alter table public.acumulados_base_faena enable row level security;

-- Solo lectura desde el cliente (coordinador/apr, los dos roles que pueden
-- guardar un Daily Report y por lo tanto disparar el recálculo que la lee)
-- — no hay policy de insert/update/delete a propósito: esta fila se carga
-- a mano por SQL, nunca desde la app.
drop policy if exists "coordinador_apr_lee_acumulados_base_faena" on public.acumulados_base_faena;
create policy "coordinador_apr_lee_acumulados_base_faena" on public.acumulados_base_faena
  for select using (public.usuario_rol_actual() in ('coordinador', 'apr'));

-- Traspaso de posta: para cada contrato que tenga reportes de LT, toma el
-- acumulado de su ÚLTIMO reporte (mayor número de reporte) y lo deja como
-- base de arranque de LB en ese mismo contrato. Si LB ya tenía una base
-- cargada, la reemplaza (ON CONFLICT) — pensado para poder re-ejecutar
-- este archivo sin duplicar filas.
insert into public.acumulados_base_faena (contrato_id, faena, hh_directas_base, hm_base, hh_indirectas_base)
select distinct on (contrato_id)
  contrato_id, 'LB', coalesce(hh_directas_acumuladas, 0), coalesce(hm_acumuladas, 0), coalesce(hh_indirectas_acumuladas, 0)
from public.partes_diarios
where faena = 'LT'
order by contrato_id, numero_reporte desc
on conflict (contrato_id, faena) do update set
  hh_directas_base = excluded.hh_directas_base,
  hm_base = excluded.hm_base,
  hh_indirectas_base = excluded.hh_indirectas_base,
  updated_at = now();

notify pgrst, 'reload schema';

-- ---- Verificación: copia el resultado de vuelta para confirmar los
-- valores que quedaron cargados como base de LB ----
select contrato_id, faena, hh_directas_base, hm_base, hh_indirectas_base
from public.acumulados_base_faena
where faena = 'LB';
