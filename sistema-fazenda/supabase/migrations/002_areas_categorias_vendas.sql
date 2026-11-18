-- =====================================================================
-- Etapa 1.1 — ajustes a partir das planilhas da Fazenda 2
--   * Categoria automática por sexo + idade (mesmas faixas do Relatório
--     Mensal do Rebanho) e marcação de matriz
--   * Pastos/áreas com o uso dividido como na planilha "Áreas Faz. 2"
--   * Vendas (cabeçalho + animais), com valores visíveis só a gestores
-- Rode depois do 001_mvp.sql. Não apaga nenhum dado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Categoria por idade
-- ---------------------------------------------------------------------
alter table public.animais add column if not exists matriz boolean not null default false;
alter table public.animais add column if not exists touro  boolean not null default false;

create or replace function public.categoria_idade(p_sexo text, p_nasc date, p_touro boolean default false)
returns text language sql immutable as $$
  select case
    when p_sexo = 'M' and p_touro then 'Touro'
    when p_nasc is null then null
    else case
      when (extract(year from age(current_date, p_nasc)) * 12 + extract(month from age(current_date, p_nasc))) <= 4
        then case when p_sexo = 'F' then 'Bezerra 0-4 m'  else 'Bezerro 0-4 m'  end
      when (extract(year from age(current_date, p_nasc)) * 12 + extract(month from age(current_date, p_nasc))) <= 12
        then case when p_sexo = 'F' then 'Bezerra 5-12 m' else 'Bezerro 5-12 m' end
      when (extract(year from age(current_date, p_nasc)) * 12 + extract(month from age(current_date, p_nasc))) <= 24
        then case when p_sexo = 'F' then 'Novilha 13-24 m' else 'Garrote 13-24 m' end
      when (extract(year from age(current_date, p_nasc)) * 12 + extract(month from age(current_date, p_nasc))) <= 36
        then case when p_sexo = 'F' then 'Novilha 25-36 m' else 'Garrote 25-36 m' end
      else case when p_sexo = 'F' then 'Vaca acima de 36 m' else 'Boi acima de 36 m' end
    end
  end
$$;

-- Unicidade de chip/controle/brinco passa a valer só para animais ATIVOS:
-- um número de animal vendido ou morto pode ser reaproveitado.
drop index if exists public.ux_animais_chip;
drop index if exists public.ux_animais_controle;
drop index if exists public.ux_animais_brinco;
create unique index ux_animais_chip     on public.animais (lower(trim(chip)))     where chip is not null and situacao = 'ativo' and not arquivado;
create unique index ux_animais_controle on public.animais (lower(trim(controle))) where controle is not null and situacao = 'ativo' and not arquivado;
create unique index ux_animais_brinco   on public.animais (lower(trim(brinco)))   where brinco is not null and situacao = 'ativo' and not arquivado;

-- Operador continua podendo inserir só bezerros (via nascimento)
drop policy if exists campo_ins_bezerro on public.animais;
create policy campo_ins_bezerro on public.animais for insert to authenticated
  with check (public.usuario_ativo() and categoria in ('Bezerro','Bezerra') and mae_id is not null);

-- ---------------------------------------------------------------------
-- Áreas: uso dividido como na planilha
-- ---------------------------------------------------------------------
alter table public.pastos add column if not exists tipo text
  check (tipo is null or tipo in ('Pasto','Agricultura','Reflorestamento/Mata','Desmatado/Sem definição','Eucalipto','Outro'));
alter table public.pastos add column if not exists area_reflorest_ha numeric(10,2);
alter table public.pastos add column if not exists area_soja_ha      numeric(10,2);
alter table public.pastos add column if not exists area_sem_def_ha   numeric(10,2);
alter table public.pastos add column if not exists pasto_boa_ha      numeric(10,2);
alter table public.pastos add column if not exists pasto_media_ha    numeric(10,2);
alter table public.pastos add column if not exists pasto_ruim_ha     numeric(10,2);
alter table public.pastos add column if not exists pasto_degradada_ha numeric(10,2);

-- capacidade = área de pasto × lotação média (chuva+seca)/2, como na planilha
create or replace view public.v_pastos with (security_invoker = true) as
select p.*,
       coalesce(p.pasto_boa_ha,0) + coalesce(p.pasto_media_ha,0) + coalesce(p.pasto_ruim_ha,0) + coalesce(p.pasto_degradada_ha,0) as area_pasto_ha,
       case when p.lotacao_ua_chuva is null and p.lotacao_ua_seca is null then null
            else round(p.area_ha * (coalesce(p.lotacao_ua_chuva,0) + coalesce(p.lotacao_ua_seca,0)) / 2, 0) end as capacidade_ua,
       (select count(*) from public.animais a where a.pasto_id = p.id and a.situacao = 'ativo' and not a.arquivado) as animais_agora
from public.pastos p;

-- ---------------------------------------------------------------------
-- Vendas
-- ---------------------------------------------------------------------
create table if not exists public.vendas (
  id               uuid primary key default gen_random_uuid(),
  fazenda_id       uuid not null references public.fazendas(id),
  data             date not null,
  comprador        text not null,
  notas_fiscais    text,
  sexo             text check (sexo is null or sexo in ('M','F','Misto')),
  categoria        text,
  quantidade       integer check (quantidade is null or quantidade >= 0),
  peso_balanca_kg  numeric(12,2),
  peso_frigorifico_kg numeric(12,2),
  rendimento_pct   numeric(6,2),
  media_arroba     numeric(10,4),
  valor_arroba     numeric(12,4),
  valor_total      numeric(14,2),
  forma_pagamento  text,
  obs              text,
  origem           text,             -- ex.: "Importado de Vendas2026F2.xlsx / aba 13.08 - NF 5934.35"
  arquivado        boolean not null default false,
  criado_por       uuid default auth.uid() references public.perfis(id),
  criado_em        timestamptz not null default now()
);

create table if not exists public.venda_itens (
  id          uuid primary key default gen_random_uuid(),
  venda_id    uuid not null references public.vendas(id),
  ordem       integer,
  animal_id   uuid references public.animais(id),
  controle    text,
  chip        text,
  peso_kg     numeric(7,2),
  raca        text,
  nascimento  date,
  obs         text,
  criado_em   timestamptz not null default now()
);
create index if not exists ix_venda_itens_venda    on public.venda_itens (venda_id);
create index if not exists ix_venda_itens_controle on public.venda_itens (controle);

-- Quando um item de venda aponta para um animal ativo, ele passa a "vendido".
create or replace function public.baixar_animal_vendido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.animal_id is not null then
    update public.animais set situacao = 'vendido' where id = new.animal_id and situacao = 'ativo';
  end if;
  return new;
end $$;
drop trigger if exists trg_baixar_vendido on public.venda_itens;
create trigger trg_baixar_vendido after insert on public.venda_itens
  for each row execute function public.baixar_animal_vendido();

alter table public.vendas      enable row level security;
alter table public.venda_itens enable row level security;
-- vendas têm valores: só administrador e gerente veem e lançam
create policy gestor_sel_vendas on public.vendas      for select to authenticated using (public.eh_gestor());
create policy gestor_ins_vendas on public.vendas      for insert to authenticated with check (public.eh_gestor());
create policy gestor_upd_vendas on public.vendas      for update to authenticated using (public.eh_gestor()) with check (public.eh_gestor());
create policy gestor_sel_itens  on public.venda_itens for select to authenticated using (public.eh_gestor());
create policy gestor_ins_itens  on public.venda_itens for insert to authenticated with check (public.eh_gestor());
create policy gestor_upd_itens  on public.venda_itens for update to authenticated using (public.eh_gestor()) with check (public.eh_gestor());

create trigger trg_audit_vendas      after insert or update or delete on public.vendas      for each row execute function public.registrar_auditoria();
create trigger trg_audit_venda_itens after insert or update or delete on public.venda_itens for each row execute function public.registrar_auditoria();

-- ---------------------------------------------------------------------
-- Visão de animais: categoria calculada pela idade
-- (drop + create porque mudam colunas)
-- ---------------------------------------------------------------------
drop view if exists public.v_animais;
create view public.v_animais with (security_invoker = true) as
select a.*,
       coalesce(public.categoria_idade(a.sexo, a.nascimento, a.touro), a.categoria) as categoria_atual,
       f.nome  as fazenda_nome,
       l.nome  as lote_nome,
       p.codigo as pasto_codigo,
       m.controle as mae_controle,
       up.peso_kg as ultimo_peso_kg,
       up.data    as ultima_pesagem,
       case when a.nascimento is null then null
            else (extract(year from age(current_date, a.nascimento)) * 12
                + extract(month from age(current_date, a.nascimento)))::int end as idade_meses
from public.animais a
join public.fazendas f on f.id = a.fazenda_id
left join public.lotes l on l.id = a.lote_id
left join public.pastos p on p.id = a.pasto_id
left join public.animais m on m.id = a.mae_id
left join lateral (select peso_kg, data from public.pesagens pe
                    where pe.animal_id = a.id order by data desc, criado_em desc limit 1) up on true;
