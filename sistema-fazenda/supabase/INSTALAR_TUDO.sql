-- ============================================================
-- INSTALAR TUDO — Sistema de Gestão da Fazenda (Fazenda 2)
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run. Só uma vez.
-- (É a junção de migrations/001 a 004.)
-- ============================================================

-- >>>>>>>>>> migrations/001_mvp.sql
-- =====================================================================
-- Sistema de Gestão da Fazenda — Etapa 1 (MVP)
-- Banco: Supabase (PostgreSQL). Rode este arquivo uma vez no SQL Editor.
-- Regras gerais:
--   * Nada é apagado: registros são ARQUIVADOS (coluna "arquivado").
--   * Toda alteração fica registrada na tabela "auditoria".
--   * Ninguém acessa nada sem login e sem perfil ATIVO aprovado pelo admin.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Perfis de usuário
-- ---------------------------------------------------------------------
create table public.perfis (
  id         uuid primary key references auth.users(id) on delete cascade,
  nome       text not null default '',
  email      text,
  papel      text not null default 'operador'
             check (papel in ('admin','gerente','operador')),
  ativo      boolean not null default false,
  criado_em  timestamptz not null default now()
);

-- Funções auxiliares usadas nas regras de acesso (security definer para
-- não cair em recursão nas políticas da própria tabela perfis).
create or replace function public.papel_atual() returns text
language sql stable security definer set search_path = public as $$
  select papel from public.perfis where id = auth.uid() and ativo
$$;

create or replace function public.usuario_ativo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ativo from public.perfis where id = auth.uid()), false)
$$;

create or replace function public.eh_gestor() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.papel_atual() in ('admin','gerente'), false)
$$;

create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.papel_atual() = 'admin', false)
$$;

-- Quando alguém cria conta, nasce um perfil INATIVO de operador.
-- O primeiro usuário do sistema vira administrador ativo automaticamente.
create or replace function public.criar_perfil_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare primeiro boolean;
begin
  select not exists (select 1 from public.perfis) into primeiro;
  insert into public.perfis (id, nome, email, papel, ativo)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'nome', ''),
          new.email,
          case when primeiro then 'admin' else 'operador' end,
          primeiro);
  return new;
end $$;

create trigger trg_novo_usuario after insert on auth.users
  for each row execute function public.criar_perfil_novo_usuario();

-- ---------------------------------------------------------------------
-- Cadastros base
-- ---------------------------------------------------------------------
create table public.fazendas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  municipio  text,
  obs        text,
  arquivado  boolean not null default false,
  criado_por uuid default auth.uid() references public.perfis(id),
  criado_em  timestamptz not null default now()
);

create table public.pastos (
  id             uuid primary key default gen_random_uuid(),
  fazenda_id     uuid not null references public.fazendas(id),
  codigo         text not null,              -- nº novo da área (ex.: A1)
  codigo_antigo  text,                       -- nº antigo (ex.: 30A)
  nome           text,
  area_ha        numeric(10,2) check (area_ha is null or area_ha >= 0),
  lotacao_ua_chuva numeric(10,2) check (lotacao_ua_chuva is null or lotacao_ua_chuva >= 0),
  lotacao_ua_seca  numeric(10,2) check (lotacao_ua_seca is null or lotacao_ua_seca >= 0),
  situacao       text,                       -- ex.: bom, regular, sujo/ruim, mato
  tipo_solo      text,
  obs            text,
  arquivado      boolean not null default false,
  criado_por     uuid default auth.uid() references public.perfis(id),
  criado_em      timestamptz not null default now(),
  unique (fazenda_id, codigo)
);

create table public.lotes (
  id         uuid primary key default gen_random_uuid(),
  fazenda_id uuid not null references public.fazendas(id),
  nome       text not null,
  descricao  text,
  pasto_id   uuid references public.pastos(id),
  arquivado  boolean not null default false,
  criado_por uuid default auth.uid() references public.perfis(id),
  criado_em  timestamptz not null default now(),
  unique (fazenda_id, nome)
);

-- ---------------------------------------------------------------------
-- Animais
-- ---------------------------------------------------------------------
create table public.animais (
  id            uuid primary key default gen_random_uuid(),
  fazenda_id    uuid not null references public.fazendas(id),
  controle      text,           -- nº de controle usado nas planilhas (ex.: 7444)
  chip          text,           -- chip eletrônico / RFID
  brinco        text,           -- brinco visual, se diferente do controle
  nome          text,
  sexo          text not null check (sexo in ('M','F')),
  raca          text,
  nascimento    date,
  categoria     text,
  lote_id       uuid references public.lotes(id),
  pasto_id      uuid references public.pastos(id),
  mae_id        uuid references public.animais(id),
  pai_id        uuid references public.animais(id),
  pai_descricao text,           -- quando o pai não é um animal cadastrado (sêmen, touro de fora)
  situacao      text not null default 'ativo'
                check (situacao in ('ativo','vendido','morto','descartado','transferido')),
  obs           text,
  arquivado     boolean not null default false,
  criado_por    uuid default auth.uid() references public.perfis(id),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- precisa de alguma identificação; bezerro sem número é identificado pela mãe
  check (controle is not null or chip is not null or brinco is not null or mae_id is not null),
  check (nascimento is null or nascimento <= current_date)
);

-- Evita duplicidade: o mesmo chip/controle/brinco não pode ser usado
-- por dois animais ativos (não arquivados).
create unique index ux_animais_chip     on public.animais (lower(trim(chip)))     where chip is not null and not arquivado;
create unique index ux_animais_controle on public.animais (lower(trim(controle))) where controle is not null and not arquivado;
create unique index ux_animais_brinco   on public.animais (lower(trim(brinco)))   where brinco is not null and not arquivado;
create index ix_animais_lote  on public.animais (lote_id);
create index ix_animais_pasto on public.animais (pasto_id);
create index ix_animais_mae   on public.animais (mae_id);

create table public.pesagens (
  id         uuid primary key default gen_random_uuid(),
  animal_id  uuid not null references public.animais(id),
  data       date not null default current_date check (data <= current_date),
  peso_kg    numeric(7,2) not null check (peso_kg > 0 and peso_kg < 2000),
  obs        text,
  criado_por uuid default auth.uid() references public.perfis(id),
  criado_em  timestamptz not null default now()
);
create index ix_pesagens_animal on public.pesagens (animal_id, data desc);

create table public.nascimentos (
  id            uuid primary key default gen_random_uuid(),
  bezerro_id    uuid not null unique references public.animais(id),
  mae_id        uuid references public.animais(id),
  pai_id        uuid references public.animais(id),
  pai_descricao text,
  data          date not null check (data <= current_date),
  peso_nascer_kg numeric(6,2) check (peso_nascer_kg is null or (peso_nascer_kg > 0 and peso_nascer_kg < 100)),
  obs           text,
  criado_por    uuid default auth.uid() references public.perfis(id),
  criado_em     timestamptz not null default now()
);

-- Movimentação de animal ou de lote inteiro entre pastos
create table public.movimentacoes (
  id               uuid primary key default gen_random_uuid(),
  animal_id        uuid references public.animais(id),
  lote_id          uuid references public.lotes(id),
  pasto_origem_id  uuid references public.pastos(id),
  pasto_destino_id uuid not null references public.pastos(id),
  data             date not null default current_date,
  motivo           text,
  obs              text,
  criado_por       uuid default auth.uid() references public.perfis(id),
  criado_em        timestamptz not null default now(),
  check (animal_id is not null or lote_id is not null)
);

-- Ao registrar uma movimentação, atualiza o pasto atual do animal/lote.
create or replace function public.aplicar_movimentacao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.animal_id is not null then
    update public.animais set pasto_id = new.pasto_destino_id, atualizado_em = now()
     where id = new.animal_id;
  end if;
  if new.lote_id is not null then
    update public.lotes   set pasto_id = new.pasto_destino_id where id = new.lote_id;
    update public.animais set pasto_id = new.pasto_destino_id, atualizado_em = now()
     where lote_id = new.lote_id and situacao = 'ativo' and not arquivado;
  end if;
  return new;
end $$;
create trigger trg_aplicar_movimentacao after insert on public.movimentacoes
  for each row execute function public.aplicar_movimentacao();

-- ---------------------------------------------------------------------
-- Tarefas do dia a dia
-- ---------------------------------------------------------------------
create table public.tarefas (
  id              uuid primary key default gen_random_uuid(),
  titulo          text not null,
  descricao       text,
  data            date not null default current_date,
  hora            time,
  prioridade      text not null default 'media' check (prioridade in ('baixa','media','alta')),
  pasto_id        uuid references public.pastos(id),
  local_texto     text,
  responsavel_id  uuid references public.perfis(id),
  equipe          text,
  materiais       text,
  status          text not null default 'pendente'
                  check (status in ('pendente','andamento','concluida')),
  obs_execucao    text,
  concluida_em    timestamptz,
  arquivado       boolean not null default false,
  criado_por      uuid default auth.uid() references public.perfis(id),
  criado_em       timestamptz not null default now()
);
create index ix_tarefas_data on public.tarefas (data, status);

create or replace function public.marcar_conclusao() returns trigger
language plpgsql as $$
begin
  if new.status = 'concluida' and (old.status is distinct from 'concluida') then
    new.concluida_em := now();
  elsif new.status <> 'concluida' then
    new.concluida_em := null;
  end if;
  return new;
end $$;
create trigger trg_tarefa_conclusao before update on public.tarefas
  for each row execute function public.marcar_conclusao();

-- Operador só pode mudar status / observação da execução das tarefas dele.
create or replace function public.limitar_edicao_operador_tarefa() returns trigger
language plpgsql as $$
begin
  if not public.eh_gestor() then
    if (new.titulo, new.descricao, new.data, new.hora, new.prioridade, new.pasto_id,
        new.local_texto, new.responsavel_id, new.equipe, new.materiais, new.arquivado)
       is distinct from
       (old.titulo, old.descricao, old.data, old.hora, old.prioridade, old.pasto_id,
        old.local_texto, old.responsavel_id, old.equipe, old.materiais, old.arquivado) then
      raise exception 'Operador só pode alterar o status e a observação da tarefa.';
    end if;
  end if;
  return new;
end $$;
create trigger trg_tarefa_operador before update on public.tarefas
  for each row execute function public.limitar_edicao_operador_tarefa();

-- ---------------------------------------------------------------------
-- Auditoria (quem fez o quê e quando)
-- ---------------------------------------------------------------------
create table public.auditoria (
  id           bigserial primary key,
  tabela       text not null,
  registro_id  uuid,
  acao         text not null,
  antes        jsonb,
  depois       jsonb,
  usuario_id   uuid default auth.uid(),
  em           timestamptz not null default now()
);

create or replace function public.registrar_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.auditoria (tabela, registro_id, acao, antes, depois, usuario_id)
  values (tg_table_name,
          coalesce((case when tg_op = 'DELETE' then old.id else new.id end), null),
          tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
          auth.uid());
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['perfis','fazendas','pastos','lotes','animais','pesagens',
                           'nascimentos','movimentacoes','tarefas'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$s
                    for each row execute function public.registrar_auditoria()', t);
  end loop;
end $$;

create or replace function public.tocar_atualizado() returns trigger
language plpgsql as $$ begin new.atualizado_em := now(); return new; end $$;
create trigger trg_animais_atualizado before update on public.animais
  for each row execute function public.tocar_atualizado();

-- ---------------------------------------------------------------------
-- Registro de nascimento em uma única operação (cria o bezerro + o evento)
-- ---------------------------------------------------------------------
create or replace function public.registrar_nascimento(
  p_fazenda_id uuid, p_mae_id uuid, p_pai_id uuid, p_pai_descricao text,
  p_data date, p_sexo text, p_raca text, p_peso numeric,
  p_controle text, p_chip text, p_brinco text, p_obs text
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid; v_pasto uuid; v_lote uuid;
begin
  if p_mae_id is not null then
    select pasto_id, lote_id into v_pasto, v_lote from public.animais where id = p_mae_id;
  end if;
  insert into public.animais (fazenda_id, controle, chip, brinco, sexo, raca, nascimento,
                              categoria, mae_id, pai_id, pai_descricao, pasto_id, lote_id, obs)
  values (p_fazenda_id, nullif(trim(p_controle),''), nullif(trim(p_chip),''), nullif(trim(p_brinco),''),
          p_sexo, p_raca, p_data,
          case when p_sexo = 'M' then 'Bezerro' else 'Bezerra' end,
          p_mae_id, p_pai_id, nullif(trim(p_pai_descricao),''), v_pasto, v_lote, p_obs)
  returning id into v_id;

  insert into public.nascimentos (bezerro_id, mae_id, pai_id, pai_descricao, data, peso_nascer_kg, obs)
  values (v_id, p_mae_id, p_pai_id, nullif(trim(p_pai_descricao),''), p_data, p_peso, p_obs);

  if p_peso is not null then
    insert into public.pesagens (animal_id, data, peso_kg, obs) values (v_id, p_data, p_peso, 'Peso ao nascer');
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Visão com último peso e idade (para listas e filtros)
-- ---------------------------------------------------------------------
create or replace view public.v_animais with (security_invoker = true) as
select a.*,
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

-- ---------------------------------------------------------------------
-- Regras de acesso (Row Level Security)
--   admin   : tudo
--   gerente : tudo da operação (não gerencia usuários)
--   operador: consulta a operação; registra pesagem, nascimento,
--             movimentação; atualiza status das próprias tarefas
-- Nenhuma política de DELETE nas tabelas da operação: nada é apagado.
-- ---------------------------------------------------------------------
alter table public.perfis        enable row level security;
alter table public.fazendas      enable row level security;
alter table public.pastos        enable row level security;
alter table public.lotes         enable row level security;
alter table public.animais       enable row level security;
alter table public.pesagens      enable row level security;
alter table public.nascimentos   enable row level security;
alter table public.movimentacoes enable row level security;
alter table public.tarefas       enable row level security;
alter table public.auditoria     enable row level security;

-- perfis
create policy perfis_ler_proprio on public.perfis for select to authenticated
  using (id = auth.uid() or public.usuario_ativo());
create policy perfis_admin_altera on public.perfis for update to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- leitura geral para qualquer usuário ativo
create policy ler_fazendas      on public.fazendas      for select to authenticated using (public.usuario_ativo());
create policy ler_pastos        on public.pastos        for select to authenticated using (public.usuario_ativo());
create policy ler_lotes         on public.lotes         for select to authenticated using (public.usuario_ativo());
create policy ler_animais       on public.animais       for select to authenticated using (public.usuario_ativo());
create policy ler_pesagens      on public.pesagens      for select to authenticated using (public.usuario_ativo());
create policy ler_nascimentos   on public.nascimentos   for select to authenticated using (public.usuario_ativo());
create policy ler_movimentacoes on public.movimentacoes for select to authenticated using (public.usuario_ativo());
create policy ler_tarefas       on public.tarefas       for select to authenticated using (public.usuario_ativo());
create policy ler_auditoria     on public.auditoria     for select to authenticated using (public.eh_admin());

-- cadastros: só gestor (admin/gerente)
create policy gestor_ins_fazendas on public.fazendas for insert to authenticated with check (public.eh_gestor());
create policy gestor_upd_fazendas on public.fazendas for update to authenticated using (public.eh_gestor()) with check (public.eh_gestor());
create policy gestor_ins_pastos   on public.pastos   for insert to authenticated with check (public.eh_gestor());
create policy gestor_upd_pastos   on public.pastos   for update to authenticated using (public.eh_gestor()) with check (public.eh_gestor());
create policy gestor_ins_lotes    on public.lotes    for insert to authenticated with check (public.eh_gestor());
create policy gestor_upd_lotes    on public.lotes    for update to authenticated using (public.eh_gestor()) with check (public.eh_gestor());
create policy gestor_ins_animais  on public.animais  for insert to authenticated with check (public.eh_gestor());
create policy gestor_upd_animais  on public.animais  for update to authenticated using (public.eh_gestor()) with check (public.eh_gestor());

-- registros de campo: qualquer usuário ativo
create policy campo_ins_pesagens      on public.pesagens      for insert to authenticated with check (public.usuario_ativo());
create policy campo_ins_movimentacoes on public.movimentacoes for insert to authenticated with check (public.usuario_ativo());
create policy campo_ins_nascimentos   on public.nascimentos   for insert to authenticated with check (public.usuario_ativo());
-- o bezerro é criado pela função registrar_nascimento: operador pode inserir
-- animal somente se for um nascimento (com mãe ou categoria de bezerro)
create policy campo_ins_bezerro on public.animais for insert to authenticated
  with check (public.usuario_ativo() and categoria in ('Bezerro','Bezerra'));

-- tarefas
create policy gestor_ins_tarefas on public.tarefas for insert to authenticated with check (public.eh_gestor());
create policy upd_tarefas on public.tarefas for update to authenticated
  using (public.eh_gestor() or (public.usuario_ativo() and responsavel_id = auth.uid()))
  with check (public.eh_gestor() or (public.usuario_ativo() and responsavel_id = auth.uid()));

-- Impede que um usuário mude o próprio papel ou se ative (somente admin).
create or replace function public.proteger_perfil() returns trigger
language plpgsql as $$
begin
  if not public.eh_admin() and (new.papel, new.ativo) is distinct from (old.papel, old.ativo) then
    raise exception 'Somente o administrador altera papel e acesso.';
  end if;
  if old.id = auth.uid() and (new.papel <> 'admin' or not new.ativo) and old.papel = 'admin' then
    raise exception 'Você não pode remover o seu próprio acesso de administrador.';
  end if;
  return new;
end $$;
create trigger trg_proteger_perfil before update on public.perfis
  for each row execute function public.proteger_perfil();

-- >>>>>>>>>> migrations/002_areas_categorias_vendas.sql
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

-- >>>>>>>>>> migrations/003_importacao_fazenda2.sql
-- Importação da Fazenda 2 (gerado por importacao/gerar_sql.py — não editar à mão)
-- Rode UMA vez, depois do 001 e do 002. Se rodar de novo, as áreas não duplicam,
-- mas as vendas sim: por isso há uma trava logo abaixo.
begin;
do $$ begin if exists (select 1 from public.vendas where origem like 'Importado de %') then
  raise exception 'Importação já foi feita antes. Nada foi alterado.'; end if; end $$;
insert into public.fazendas (nome, municipio) values ('Santa Adriana II', 'Diamantino - MT') on conflict (nome) do nothing;
create temp table fz on commit drop as select id from public.fazendas where nome = 'Santa Adriana II';
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'A1', null, 'Agricultura', 90.11, null, 90.11, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'A2', null, 'Agricultura', 100.47, null, 100.47, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'A3', null, 'Agricultura', 78.99, null, 78.99, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'A4', null, 'Agricultura', 123.0, null, 123.0, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'A5', null, 'Agricultura', 71.92, null, 71.92, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'A6', null, 'Agricultura', 121.66, null, 121.66, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'A7', null, 'Agricultura', 107.74, null, 107.74, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'A8', null, 'Agricultura', 76.04, null, 76.04, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'A9', null, 'Agricultura', 31.62, null, 31.62, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'A10', null, 'Agricultura', 122.64, null, 122.64, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'A11', null, 'Agricultura', 94.86, null, 94.86, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'A13', '15', 'Agricultura', 264.6, null, 264.6, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'A14', '30A', 'Agricultura', 204.95, null, 204.95, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'A15', '30B', 'Agricultura', 111.72, null, 111.72, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'A16', '32A', 'Agricultura', 324.7, null, 324.7, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'A18', '52', 'Agricultura', 60.0, null, 60.0, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'A19', '32B', 'Agricultura', 270.72, null, 190.72, null, null, null, null, null, null, null, null, 'Na planilha a soma dos usos (190.72 ha) difere do total (270.72 ha).' from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'D1', '54', 'Desmatado/Sem definição', 489.26, null, null, 489.26, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'D2', '52', 'Desmatado/Sem definição', 471.86, null, null, 471.86, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'D3', '37', 'Desmatado/Sem definição', 798.5, null, null, 798.5, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'D4', '40', 'Desmatado/Sem definição', 276.11, null, null, null, null, null, null, null, null, null, null, 'Uso da área não informado na planilha 2025.26.' from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'D5', '49C', 'Desmatado/Sem definição', 245.57, null, null, null, null, null, null, null, null, null, null, 'Uso da área não informado na planilha 2025.26.' from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'M1', '48', 'Reflorestamento/Mata', 288.75, 288.75, null, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'M2', '47', 'Reflorestamento/Mata', 188.75, 188.75, null, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'M3', '38', 'Reflorestamento/Mata', 305.82, 305.82, null, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'M4', null, 'Reflorestamento/Mata', 111.61, 111.61, null, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'M5', null, 'Reflorestamento/Mata', 1442.9, 1442.9, null, null, null, null, null, null, null, null, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P1', '1 conf', 'Pasto', 80.75, null, null, null, null, null, null, null, null, null, null, 'Uso da área não informado na planilha 2025.26.' from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P3', '13', 'Pasto', 163.19, null, null, null, 163.19, null, null, null, 1.0, 0.5, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P4', '14C', 'Pasto', 49.71, null, null, null, null, null, 49.71, null, 0.5, 0.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P5', '14D', 'Pasto', 180.85, null, null, null, null, 90.425, 90.425, null, 0.5, 0.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P6B', '14B', 'Pasto', 111.47, null, null, null, null, null, 111.47, null, 0.5, 0.5, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P6A', '14A', 'Pasto', 105.05, null, null, null, null, null, 105.05, null, 0.5, 0.5, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P7', '20a', 'Pasto', 117.05, null, 50.0, null, null, null, 117.05, null, 0.5, 0.5, null, 'Na planilha a soma dos usos (167.05 ha) difere do total (117.05 ha).' from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P8', '20b', 'Pasto', 111.04, null, null, null, null, null, 111.04, null, 0.5, 0.5, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P9', '22a', 'Pasto', 134.72, null, null, null, null, 134.72, null, null, 1.0, 0.5, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P10', '22b', 'Pasto', 115.56, null, null, null, null, 115.56, null, null, 1.0, 0.5, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'RE17', 'eucalipto', 'Eucalipto', 209.09, null, null, null, 149.09, 60.0, null, null, 1.5, 1.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P11', '24', 'Pasto', 129.47, null, null, null, null, 129.47, null, null, 1.5, 1.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P12', '26', 'Pasto', 249.57, null, 110.0, null, null, null, null, 139.57, 0.5, 0.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P13', '28A', 'Pasto', 104.81, null, null, null, 104.81, null, null, null, 2.0, 1.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P14', '28A', 'Pasto', 130.0, null, null, null, 130.0, null, null, null, 2.0, 1.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P15', '28B', 'Pasto', 81.65, null, null, null, null, null, null, 81.65, null, 0.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P16', '28B', 'Pasto', 98.17, null, null, null, null, null, null, 98.17, null, 0.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P17', '28C', 'Pasto', 195.78, null, null, null, null, null, null, 195.78, null, 0.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P18', '50A', 'Pasto', 91.88, null, null, null, 61.88, 30.0, null, null, 1.0, 0.5, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P19', '49A', 'Pasto', 64.96, null, null, null, null, 64.96, null, null, 1.0, 0.5, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P20', '49B', 'Pasto', 136.98, null, null, null, null, null, null, 136.98, null, 0.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P21', '50B', 'Pasto', 170.39, null, null, null, null, null, null, 170.39, null, 0.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P22', '50C', 'Pasto', 153.41, null, null, null, null, null, null, 153.41, null, 0.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P23', '42', 'Pasto', 140.1, null, null, null, null, null, null, 140.1, null, 0.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P24', '43', 'Pasto', 69.81, null, null, null, null, null, null, 69.81, null, 0.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P25', '44', 'Pasto', 64.7, null, null, null, null, null, null, 64.7, null, 0.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P26', '46', 'Pasto', 326.55, null, null, null, null, null, null, 326.55, null, 0.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P27a', '36', 'Pasto', 83.0, null, null, null, null, 83.0, null, null, 1.0, 0.5, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P27b', null, 'Pasto', 106.9, null, null, null, 106.9, null, null, null, 2.0, 1.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P28', '34', 'Pasto', 137.98, null, null, null, 90.0, null, 47.98, null, 5.0, 1.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P30', '32C', 'Pasto', 159.87, null, null, null, null, null, null, 159.87, 0.5, 0.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P31', '35', 'Pasto', 20.26, null, null, null, 20.26, null, null, null, 1.5, 1.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) select id, 'P32', 'tropa', 'Pasto', 25.32, null, null, null, 25.32, null, null, null, 1.5, 1.0, null, null from fz on conflict (fazenda_id, codigo) do nothing;
with v as (insert into public.vendas (fazenda_id, data, comprador, notas_fiscais, sexo, categoria, quantidade, peso_balanca_kg, peso_frigorifico_kg, rendimento_pct, media_arroba, valor_arroba, valor_total, obs, origem) select id, '2026-02-17', 'JBS S/A', '5645,6,7,8', 'F', 'Vaca / Novilha', 80.0, 40420.0, 21297.0, 52.6893, 17.7475, null, 416769.2, 'Nome da aba indica 09/02, mas a data preenchida na planilha é 17/02/2026.', 'Importado de Vendas2026F2.xlsx / aba 09.02 - NF' from fz returning id)
insert into public.venda_itens (venda_id, ordem, controle, chip, peso_kg, raca, nascimento, obs) values
  ((select id from v), 1, '11', null, null, 'NEL', '2020-10-01', null),
  ((select id from v), 2, '32', null, null, 'NEL', '2020-10-01', null),
  ((select id from v), 3, '75', null, null, 'NEL', '2020-10-01', null),
  ((select id from v), 4, '76', null, null, 'NEL', '2020-10-01', null),
  ((select id from v), 5, '158', null, null, 'NEL', '2020-10-01', null),
  ((select id from v), 6, '246', null, null, 'NEL', '2020-10-01', null),
  ((select id from v), 7, '300', null, null, 'NEL', '2020-10-01', null),
  ((select id from v), 8, '357', null, null, 'NEL', '2020-10-01', null),
  ((select id from v), 9, '358', null, null, 'NEL', '2021-03-01', null),
  ((select id from v), 10, '375', null, null, 'NEL', '2021-03-01', null),
  ((select id from v), 11, '409', null, null, 'NEL', '2021-03-01', null),
  ((select id from v), 12, '411', null, null, 'NEL', '2021-03-01', null),
  ((select id from v), 13, '415', null, null, 'NEL', '2021-03-01', null),
  ((select id from v), 14, '532', null, null, 'NEL', '2021-06-01', null),
  ((select id from v), 15, '589', null, null, 'NEL', '2022-04-01', null),
  ((select id from v), 16, '756', null, null, 'NEL', '2022-10-01', null),
  ((select id from v), 17, '790', null, null, 'NEL', '2022-10-01', null),
  ((select id from v), 18, '813', null, null, 'NEL', '2022-02-01', null),
  ((select id from v), 19, '827', null, null, 'NEL', '2022-02-01', null),
  ((select id from v), 20, '1009', null, null, 'NEL', '2022-02-01', null),
  ((select id from v), 21, '1026', null, null, 'NEL', '2022-11-01', null),
  ((select id from v), 22, '1096', null, null, 'NEL', '2022-02-01', null),
  ((select id from v), 23, '1147', null, null, 'NEL', '2022-11-01', null),
  ((select id from v), 24, '1207', null, null, 'NEL', '2022-11-01', null),
  ((select id from v), 25, '1223', null, null, 'NEL', '2022-11-01', null),
  ((select id from v), 26, '1271', null, null, 'NEL', '2022-11-01', null),
  ((select id from v), 27, '1355', null, null, 'NEL', '2022-12-01', null),
  ((select id from v), 28, '1362', null, null, 'NEL', '2022-12-01', null),
  ((select id from v), 29, '1522', null, null, 'NEL', '2022-12-01', null),
  ((select id from v), 30, '1731', null, null, 'NEL', '2022-12-01', null),
  ((select id from v), 31, '1739', null, null, 'NEL', '2023-02-01', null),
  ((select id from v), 32, '1751', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 33, '1766', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 34, '1956', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 35, '2142', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 36, '2283', null, null, 'NEL', '2024-01-01', null),
  ((select id from v), 37, '2546', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 38, '2547', null, null, 'NEL', '2024-01-01', null),
  ((select id from v), 39, '2576', null, null, 'NEL', '2023-04-01', null),
  ((select id from v), 40, '2577', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 41, '2593', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 42, '2596', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 43, '2598', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 44, '2606', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 45, '2610', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 46, '2611', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 47, '2639', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 48, '2693', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 49, '2711', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 50, '2751', null, null, 'NEL', '2023-04-01', null),
  ((select id from v), 51, '2754', null, null, 'NEL', '2023-04-01', null),
  ((select id from v), 52, '2771', null, null, 'NEL', '2023-01-01', null),
  ((select id from v), 53, '2784', null, null, 'NEL', '2023-01-01', null),
  ((select id from v), 54, '2821', null, null, 'NEL', '2023-01-01', null),
  ((select id from v), 55, '3344', null, null, 'NEL', '2023-01-01', null),
  ((select id from v), 56, '3347', null, null, 'NEL', '2023-01-01', null),
  ((select id from v), 57, '3401', null, null, 'NEL', '2020-12-01', null),
  ((select id from v), 58, '3451', null, null, 'NEL', '2018-09-01', null),
  ((select id from v), 59, '3538', null, null, 'NEL', '2018-09-01', null),
  ((select id from v), 60, '3557', null, null, 'NEL', '2020-12-01', 'Número repetido nesta venda (provável erro de digitação, conforme a fazenda).'),
  ((select id from v), 61, '3557', 'A3', null, 'NEL', '2020-12-01', 'Número repetido nesta venda (provável erro de digitação, conforme a fazenda).'),
  ((select id from v), 62, '3608', null, null, 'NEL', '2018-10-01', null),
  ((select id from v), 63, '3614', null, null, 'NEL', '2021-11-01', null),
  ((select id from v), 64, '3627', null, null, 'NEL', '2021-11-01', null),
  ((select id from v), 65, '3665', null, null, 'NEL', '2020-12-01', null),
  ((select id from v), 66, '3753', null, null, 'NEL', '2021-11-01', null),
  ((select id from v), 67, '3771', null, null, 'NEL', '2021-05-01', null),
  ((select id from v), 68, '3865', null, null, 'NEL', '2021-11-01', null),
  ((select id from v), 69, '3944', null, null, 'NEL', '2021-11-01', null),
  ((select id from v), 70, '3979', null, null, 'NEL', '2018-12-01', null),
  ((select id from v), 71, '4127', null, null, 'NEL', '2022-01-01', null),
  ((select id from v), 72, '4200', null, null, 'NEL', '2022-02-01', null),
  ((select id from v), 73, '4244', null, null, 'NEL', '2019-02-01', null),
  ((select id from v), 74, '4281', null, null, 'NEL', '2019-09-01', null),
  ((select id from v), 75, '4369', null, null, 'NEL', '2019-09-01', null),
  ((select id from v), 76, '4705', null, null, 'NEL', '2019-09-01', null),
  ((select id from v), 77, '4746', null, null, 'NEL', '2019-10-01', null),
  ((select id from v), 78, '4786', null, null, 'NEL', '2021-09-01', null),
  ((select id from v), 79, '4815', null, null, 'NEL', '2020-12-01', null),
  ((select id from v), 80, '5175', null, null, 'NEL', '2020-12-01', null);
with v as (insert into public.vendas (fazenda_id, data, comprador, notas_fiscais, sexo, categoria, quantidade, peso_balanca_kg, peso_frigorifico_kg, rendimento_pct, media_arroba, valor_arroba, valor_total, obs, origem) select id, '2026-05-06', 'CARLOS GARCIA', '5799.5800.09', 'M', 'Bezerro', 233.0, 63619.0, null, null, 9.1014, 488.1398, 1035165.5, null, 'Importado de Vendas2026F2.xlsx / aba 06.05 - NF 5799.5800.09' from fz returning id)
insert into public.venda_itens (venda_id, ordem, controle, chip, peso_kg, raca, nascimento, obs) values
  ((select id from v), 1, '6658', null, 299.0, 'NEL', '2025-01-01', null),
  ((select id from v), 2, '6856', null, 294.0, 'NEL', '2025-05-01', null),
  ((select id from v), 3, '6857', null, 293.0, 'NEL', '2025-06-01', null),
  ((select id from v), 4, '6858', null, 291.0, 'NEL', '2025-06-01', null),
  ((select id from v), 5, '6861', null, 281.0, 'NEL', '2025-08-01', null),
  ((select id from v), 6, '6863', null, 308.0, 'NEL', '2025-08-01', null),
  ((select id from v), 7, '6864', null, 300.0, 'NEL', '2025-08-01', null),
  ((select id from v), 8, '6866', null, 288.0, 'NEL', '2025-08-01', null),
  ((select id from v), 9, '6867', null, 260.0, 'NEL', '2025-08-01', null),
  ((select id from v), 10, '6868', null, 298.0, 'NEL', '2025-08-01', null),
  ((select id from v), 11, '6869', null, 285.0, 'NEL', '2025-08-01', null),
  ((select id from v), 12, '6875', null, 298.0, 'NEL', '2025-08-01', null),
  ((select id from v), 13, '6877', null, 260.0, 'NEL', '2025-08-01', null),
  ((select id from v), 14, '6880', null, 259.0, 'NEL', '2025-08-01', null),
  ((select id from v), 15, '6883', null, 308.0, 'NEL', '2025-08-01', null),
  ((select id from v), 16, '6885', null, 256.0, 'NEL', '2025-08-01', null),
  ((select id from v), 17, '6887', null, 256.0, 'NEL', '2025-08-01', null),
  ((select id from v), 18, '6891', null, 255.0, 'NEL', '2025-08-01', null),
  ((select id from v), 19, '6894', null, 356.0, 'NEL', '2025-08-01', null),
  ((select id from v), 20, '6879', null, 253.0, 'NEL', '2025-08-01', null),
  ((select id from v), 21, '6898', null, 253.0, 'NEL', '2025-08-01', null),
  ((select id from v), 22, '6899', null, 268.0, 'NEL', '2025-08-01', null),
  ((select id from v), 23, '6902', null, 252.0, 'NEL', '2025-08-01', null),
  ((select id from v), 24, '6905', null, 276.0, 'NEL', '2025-08-01', null),
  ((select id from v), 25, '6908', null, 248.0, 'NEL', '2025-08-01', null),
  ((select id from v), 26, '6915', null, 248.0, 'NEL', '2025-08-01', null),
  ((select id from v), 27, '6916', null, 248.0, 'NEL', '2025-08-01', null),
  ((select id from v), 28, '6917', null, 248.0, 'NEL', '2025-08-01', null),
  ((select id from v), 29, '6921', null, 271.0, 'NEL', '2025-08-01', null),
  ((select id from v), 30, '6927', null, 247.0, 'NEL', '2025-08-01', null),
  ((select id from v), 31, '6929', null, 342.0, 'NEL', '2025-08-01', null),
  ((select id from v), 32, '6932', null, 245.0, 'NEL', '2025-08-01', null),
  ((select id from v), 33, '6935', null, 243.0, 'NEL', '2025-08-01', null),
  ((select id from v), 34, '6940', null, 243.0, 'NEL', '2025-08-01', null),
  ((select id from v), 35, '6941', null, 241.0, 'NEL', '2025-08-01', null),
  ((select id from v), 36, '6942', null, 312.0, 'NEL', '2025-08-01', null),
  ((select id from v), 37, '6943', null, 261.0, 'NEL', '2025-08-01', null),
  ((select id from v), 38, '6946', null, 253.0, 'NEL', '2025-08-01', null),
  ((select id from v), 39, '6949', null, 240.0, 'NEL', '2025-08-01', null),
  ((select id from v), 40, '6952', null, 239.0, 'NEL', '2025-08-01', null),
  ((select id from v), 41, '6955', null, 239.0, 'NEL', '2025-08-01', null),
  ((select id from v), 42, '6956', null, 239.0, 'NEL', '2025-08-01', null),
  ((select id from v), 43, '6959', null, 349.0, 'NEL', '2025-08-01', null),
  ((select id from v), 44, '6961', null, 237.0, 'NEL', '2025-08-01', null),
  ((select id from v), 45, '6964', null, 237.0, 'NEL', '2025-08-01', null),
  ((select id from v), 46, '6965', null, 249.0, 'NEL', '2025-08-01', null),
  ((select id from v), 47, '6967', null, 235.0, 'NEL', '2025-08-01', null),
  ((select id from v), 48, '6968', null, 234.0, 'NEL', '2025-08-01', null),
  ((select id from v), 49, '6969', null, 232.0, 'NEL', '2025-08-01', null),
  ((select id from v), 50, '6970', null, 231.0, 'NEL', '2025-08-01', null),
  ((select id from v), 51, '6971', null, 228.0, 'NEL', '2025-08-01', null),
  ((select id from v), 52, '6974', null, 226.0, 'NEL', '2025-08-01', null),
  ((select id from v), 53, '6975', null, 226.0, 'NEL', '2025-08-01', null),
  ((select id from v), 54, '6977', null, 332.0, 'NEL', '2025-08-01', null),
  ((select id from v), 55, '6978', null, 280.0, 'NEL', '2025-08-01', null),
  ((select id from v), 56, '6979', null, 307.0, 'NEL', '2025-08-01', null),
  ((select id from v), 57, '6980', null, 275.0, 'NEL', '2025-08-01', null),
  ((select id from v), 58, '6981', null, 282.0, 'NEL', '2025-08-01', null),
  ((select id from v), 59, '6982', null, 272.0, 'NEL', '2025-08-01', null),
  ((select id from v), 60, '6983', null, 335.0, 'NEL', '2025-08-01', null),
  ((select id from v), 61, '6984', null, 297.0, 'NEL', '2025-08-01', null),
  ((select id from v), 62, '6985', null, 186.0, 'NEL', '2025-08-01', null),
  ((select id from v), 63, '6986', null, 216.0, 'NEL', '2025-08-01', null),
  ((select id from v), 64, '6987', null, 313.0, 'NEL', '2025-08-01', null),
  ((select id from v), 65, '6988', null, 238.0, 'NEL', '2025-08-01', null),
  ((select id from v), 66, '6991', null, 285.0, 'NEL', '2025-08-01', null),
  ((select id from v), 67, '6874', null, 304.0, 'NEL', '2025-08-01', null),
  ((select id from v), 68, '6995', null, 280.0, 'NEL', '2025-08-01', null),
  ((select id from v), 69, '6997', null, 308.0, 'NEL', '2025-08-01', null),
  ((select id from v), 70, '6998', null, 306.0, 'NEL', '2025-08-01', null),
  ((select id from v), 71, '7001', null, 344.0, 'NEL', '2025-08-01', null),
  ((select id from v), 72, '7002', null, 291.0, 'NEL', '2025-08-01', null),
  ((select id from v), 73, '7003', null, 315.0, 'NEL', '2025-08-01', null),
  ((select id from v), 74, '7005', null, 244.0, 'NEL', '2025-08-01', null),
  ((select id from v), 75, '7010', null, 307.0, 'NEL', '2025-08-01', null),
  ((select id from v), 76, '7013', null, 257.0, 'NEL', '2025-08-01', null),
  ((select id from v), 77, '7014', null, 317.0, 'NEL', '2025-08-01', null),
  ((select id from v), 78, '7016', null, 249.0, 'NEL', '2025-08-01', null),
  ((select id from v), 79, '7018', null, 280.0, 'NEL', '2025-08-01', null),
  ((select id from v), 80, '7020', null, 249.0, 'NEL', '2025-08-01', null),
  ((select id from v), 81, '7022', null, 317.0, 'NEL', '2025-08-01', null),
  ((select id from v), 82, '7025', null, 265.0, 'NEL', '2025-08-01', null),
  ((select id from v), 83, '7026', null, 292.0, 'NEL', '2025-08-01', null),
  ((select id from v), 84, '7029', null, 284.0, 'NEL', '2025-08-01', null),
  ((select id from v), 85, '7030', null, 276.0, 'NEL', '2025-08-01', null),
  ((select id from v), 86, '7031', null, 252.0, 'NEL', '2025-08-01', null),
  ((select id from v), 87, '7034', null, 254.0, 'NEL', '2025-08-01', null),
  ((select id from v), 88, '7036', null, 234.0, 'NEL', '2025-08-01', null),
  ((select id from v), 89, '7038', null, 310.0, 'NEL', '2025-08-01', null),
  ((select id from v), 90, '7041', null, 233.0, 'NEL', '2025-08-01', null),
  ((select id from v), 91, '7044', null, 295.0, 'NEL', '2025-08-01', null),
  ((select id from v), 92, '7046', null, 317.0, 'NEL', '2025-08-01', null),
  ((select id from v), 93, '7049', null, 238.0, 'NEL', '2025-08-01', null),
  ((select id from v), 94, '7050', null, 271.0, 'NEL', '2025-08-01', null),
  ((select id from v), 95, '7052', null, 272.0, 'NEL', '2025-08-01', null),
  ((select id from v), 96, '7053', null, 311.0, 'NEL', '2025-08-01', null),
  ((select id from v), 97, '7054', null, 238.0, 'NEL', '2025-08-01', null),
  ((select id from v), 98, '7057', null, 298.0, 'NEL', '2025-08-01', null),
  ((select id from v), 99, '7060', null, 261.0, 'NEL', '2025-08-01', null),
  ((select id from v), 100, '7061', null, 237.0, 'NEL', '2025-08-01', null),
  ((select id from v), 101, '7062', null, 225.0, 'NEL', '2025-08-01', null),
  ((select id from v), 102, '7063', null, 242.0, 'NEL', '2025-08-01', null),
  ((select id from v), 103, '7065', null, 303.0, 'NEL', '2025-08-01', null),
  ((select id from v), 104, '7066', null, 250.0, 'NEL', '2025-08-01', null),
  ((select id from v), 105, '7067', null, 297.0, 'NEL', '2025-08-01', null),
  ((select id from v), 106, '7069', null, 284.0, 'NEL', '2025-08-01', null),
  ((select id from v), 107, '7072', null, 325.0, 'NEL', '2025-08-01', null),
  ((select id from v), 108, '7073', null, 265.0, 'NEL', '2025-08-01', null),
  ((select id from v), 109, '7082', null, 290.0, 'NEL', '2025-08-01', null),
  ((select id from v), 110, '7089', null, 291.0, 'NEL', '2025-08-01', null),
  ((select id from v), 111, '7097', null, 280.0, 'NEL', '2025-08-01', null),
  ((select id from v), 112, '7103', null, 266.0, 'NEL', '2025-08-01', null),
  ((select id from v), 113, '7106', null, 266.0, 'NEL', '2025-08-01', null),
  ((select id from v), 114, '7115', null, 258.0, 'NEL', '2025-08-01', null),
  ((select id from v), 115, '7120', null, 306.0, 'NEL', '2025-09-01', null),
  ((select id from v), 116, '7121', null, 280.0, 'NEL', '2025-09-01', null),
  ((select id from v), 117, '7123', null, 245.0, 'NEL', '2025-09-01', null),
  ((select id from v), 118, '7124', null, 304.0, 'NEL', '2025-09-01', null),
  ((select id from v), 119, '7126', null, 300.0, 'NEL', '2025-09-01', null),
  ((select id from v), 120, '7128', null, 253.0, 'NEL', '2025-09-01', null),
  ((select id from v), 121, '7129', null, 308.0, 'NEL', '2025-09-01', null),
  ((select id from v), 122, '7135', null, 271.0, 'NEL', '2025-09-01', null),
  ((select id from v), 123, '7137', null, 294.0, 'NEL', '2025-09-01', null),
  ((select id from v), 124, '7138', null, 263.0, 'NEL', '2025-09-01', null),
  ((select id from v), 125, '7140', null, 271.0, 'NEL', '2025-09-01', null),
  ((select id from v), 126, '7148', null, 240.0, 'NEL', '2025-09-01', null),
  ((select id from v), 127, '7153', null, 265.0, 'NEL', '2025-09-01', null),
  ((select id from v), 128, '7159', null, 300.0, 'NEL', '2025-09-01', null),
  ((select id from v), 129, '7160', null, 309.0, 'NEL', '2025-09-01', null),
  ((select id from v), 130, '7169', null, 248.0, 'NEL', '2025-09-01', null),
  ((select id from v), 131, '7173', null, 266.0, 'NEL', '2025-09-01', null),
  ((select id from v), 132, '7175', null, 289.0, 'NEL', '2025-09-01', null),
  ((select id from v), 133, '7176', null, 249.0, 'NEL', '2025-09-01', null),
  ((select id from v), 134, '7178', null, 271.0, 'NEL', '2025-09-01', null),
  ((select id from v), 135, '7183', null, 321.0, 'NEL', '2025-09-01', null),
  ((select id from v), 136, '7187', null, 312.0, 'NEL', '2025-09-01', null),
  ((select id from v), 137, '7190', null, 273.0, 'NEL', '2025-09-01', null),
  ((select id from v), 138, '7192', null, 236.0, 'NEL', '2025-09-01', null),
  ((select id from v), 139, '7197', null, 261.0, 'NEL', '2025-09-01', null),
  ((select id from v), 140, '7198', null, 265.0, 'NEL', '2025-09-01', null),
  ((select id from v), 141, '7212', null, 311.0, 'NEL', '2025-09-01', null),
  ((select id from v), 142, '7225', null, 206.0, 'NEL', '2025-09-01', null),
  ((select id from v), 143, '7227', null, 246.0, 'NEL', '2025-09-01', null),
  ((select id from v), 144, '7240', null, 313.0, 'NEL', '2025-09-01', null),
  ((select id from v), 145, '7243', null, 239.0, 'NEL', '2025-09-01', null),
  ((select id from v), 146, '7245', null, 260.0, 'NEL', '2025-09-01', null),
  ((select id from v), 147, '7268', null, 274.0, 'NEL', '2025-09-01', null),
  ((select id from v), 148, '7327', null, 266.0, 'NEL', '2025-10-01', null),
  ((select id from v), 149, '7328', null, 299.0, 'NEL', '2025-10-01', null),
  ((select id from v), 150, '7330', null, 272.0, 'NEL', '2025-10-01', null),
  ((select id from v), 151, '7332', null, 299.0, 'NEL', '2025-10-01', null),
  ((select id from v), 152, '7336', null, 274.0, 'NEL', '2025-10-01', null),
  ((select id from v), 153, '7341', null, 251.0, 'NEL', '2025-10-01', null),
  ((select id from v), 154, '7345', null, 309.0, 'NEL', '2025-10-01', null),
  ((select id from v), 155, '7348', null, 269.0, 'NEL', '2025-10-01', null),
  ((select id from v), 156, '7349', null, 301.0, 'NEL', '2025-10-01', null),
  ((select id from v), 157, '7352', null, 272.0, 'NEL', '2025-10-01', null),
  ((select id from v), 158, '7353', null, 302.0, 'NEL', '2025-10-01', null),
  ((select id from v), 159, '7362', null, 246.0, 'NEL', '2025-10-01', null),
  ((select id from v), 160, '7366', null, 296.0, 'NEL', '2025-10-01', null),
  ((select id from v), 161, '7367', null, 271.0, 'NEL', '2025-10-01', null),
  ((select id from v), 162, '7368', null, 280.0, 'NEL', '2025-10-01', null),
  ((select id from v), 163, '7369', null, 326.0, 'NEL', '2025-10-01', null),
  ((select id from v), 164, '7371', null, 258.0, 'NEL', '2025-10-01', null),
  ((select id from v), 165, '7373', null, 267.0, 'NEL', '2025-10-01', null),
  ((select id from v), 166, '7375', null, 236.0, 'NEL', '2025-10-01', null),
  ((select id from v), 167, '7376', null, 286.0, 'NEL', '2025-10-01', null),
  ((select id from v), 168, '7377', null, 290.0, 'NEL', '2025-10-01', null),
  ((select id from v), 169, '7378', null, 258.0, 'NEL', '2025-10-01', null),
  ((select id from v), 170, '7318', null, 258.0, 'NEL', '2025-10-01', 'Mesmo número aparece também na venda "10.06 - NF 5836" (provável erro de digitação).'),
  ((select id from v), 171, '7382', null, 300.0, 'NEL', '2025-10-01', null),
  ((select id from v), 172, '7391', null, 240.0, 'NEL', '2025-10-01', null),
  ((select id from v), 173, '7392', null, 308.0, 'NEL', '2025-10-01', null),
  ((select id from v), 174, '7393', null, 275.0, 'NEL', '2025-10-01', null),
  ((select id from v), 175, '7394', null, 305.0, 'NEL', '2025-10-01', null),
  ((select id from v), 176, '7399', null, 290.0, 'NEL', '2025-10-01', null),
  ((select id from v), 177, '7401', null, 217.0, 'NEL', '2025-10-01', null),
  ((select id from v), 178, '7405', null, 310.0, 'NEL', '2025-10-01', null),
  ((select id from v), 179, '7407', null, 269.0, 'NEL', '2025-10-01', null),
  ((select id from v), 180, '7408', null, 306.0, 'NEL', '2025-10-01', null),
  ((select id from v), 181, '7409', null, 295.0, 'NEL', '2025-10-01', null),
  ((select id from v), 182, '7410', null, 305.0, 'NEL', '2025-10-01', null),
  ((select id from v), 183, '7411', null, 280.0, 'NEL', '2025-10-01', null),
  ((select id from v), 184, '7428', null, 294.0, 'NEL', '2025-10-01', null),
  ((select id from v), 185, '7432', null, 325.0, 'NEL', '2025-10-01', null),
  ((select id from v), 186, '7434', null, 284.0, 'NEL', '2025-10-01', null),
  ((select id from v), 187, '7436', null, 321.0, 'NEL', '2025-10-01', null),
  ((select id from v), 188, '7440', null, 312.0, 'NEL', '2025-10-01', null),
  ((select id from v), 189, '7443', null, 306.0, 'NEL', '2025-10-01', null),
  ((select id from v), 190, '7444', null, 305.0, 'NEL', '2025-10-01', 'Mesmo número aparece também na venda "13.08 - NF 5934.35" (provável erro de digitação).'),
  ((select id from v), 191, '7446', null, 295.0, 'NEL', '2025-10-01', null),
  ((select id from v), 192, '7447', null, 293.0, 'NEL', '2025-10-01', null),
  ((select id from v), 193, '7448', null, 292.0, 'NEL', '2025-10-01', null),
  ((select id from v), 194, '7450', null, 287.0, 'NEL', '2025-10-01', null),
  ((select id from v), 195, '7452', null, 287.0, 'NEL', '2025-10-01', null),
  ((select id from v), 196, '7456', null, 295.0, 'NEL', '2025-10-01', null),
  ((select id from v), 197, '7459', null, 284.0, 'NEL', '2025-10-01', null),
  ((select id from v), 198, '7460', null, 277.0, 'NEL', '2025-10-01', null),
  ((select id from v), 199, '7465', null, 277.0, 'NEL', '2025-10-01', null),
  ((select id from v), 200, '7466', null, 275.0, 'NEL', '2025-10-01', null),
  ((select id from v), 201, '7468', null, 274.0, 'NEL', '2025-10-01', null),
  ((select id from v), 202, '7470', null, 273.0, 'NEL', '2025-10-01', null),
  ((select id from v), 203, '7471', null, 272.0, 'NEL', '2025-10-01', null),
  ((select id from v), 204, '7473', null, 270.0, 'NEL', '2025-10-01', null),
  ((select id from v), 205, '7475', null, 267.0, 'NEL', '2025-10-01', null),
  ((select id from v), 206, '7477', null, 266.0, 'NEL', '2025-10-01', null),
  ((select id from v), 207, '7479', null, 265.0, 'NEL', '2025-10-01', null),
  ((select id from v), 208, '7483', null, 274.0, 'NEL', '2025-10-01', 'Mesmo número aparece também na venda "10.06 - NF 5836" (provável erro de digitação).'),
  ((select id from v), 209, '7486', null, 274.0, 'NEL', '2025-10-01', null),
  ((select id from v), 210, '7488', null, 261.0, 'NEL', '2025-10-01', null),
  ((select id from v), 211, '7489', null, 259.0, 'NEL', '2025-10-01', null),
  ((select id from v), 212, '7492', null, 259.0, 'NEL', '2025-10-01', null),
  ((select id from v), 213, '7493', null, 262.0, 'NEL', '2025-10-01', null),
  ((select id from v), 214, '7498', null, 257.0, 'NEL', '2025-10-01', null),
  ((select id from v), 215, '7500', null, 249.0, 'NEL', '2025-10-01', null),
  ((select id from v), 216, '7502', null, 257.0, 'NEL', '2025-10-01', null),
  ((select id from v), 217, '7504', null, 256.0, 'NEL', '2025-10-01', null),
  ((select id from v), 218, '7506', null, 254.0, 'NEL', '2025-10-01', null),
  ((select id from v), 219, '7507', null, 253.0, 'NEL', '2025-10-01', null),
  ((select id from v), 220, '7509', null, 251.0, 'NEL', '2025-10-01', null),
  ((select id from v), 221, '7510', null, 248.0, 'NEL', '2025-10-01', null),
  ((select id from v), 222, '7511', null, 246.0, 'NEL', '2025-10-01', null),
  ((select id from v), 223, '7518', null, 246.0, 'NEL', '2025-10-01', null),
  ((select id from v), 224, '7519', null, 253.0, 'NEL', '2025-10-01', null),
  ((select id from v), 225, '7523', null, 247.0, 'NEL', '2025-10-01', null),
  ((select id from v), 226, '7529', null, 250.0, 'NEL', '2025-10-01', null),
  ((select id from v), 227, '7533', null, 224.0, 'NEL', '2025-10-01', null),
  ((select id from v), 228, '7535', null, 223.0, 'NEL', '2025-10-01', null),
  ((select id from v), 229, '7536', null, 258.0, 'NEL', '2025-10-01', null),
  ((select id from v), 230, '7537', null, 253.0, 'NEL', '2025-10-01', null),
  ((select id from v), 231, '7729', null, 267.0, 'NEL', '2025-12-01', null),
  ((select id from v), 232, '7731', null, 232.0, 'NEL', '2025-12-01', null),
  ((select id from v), 233, '7734', null, 271.0, 'NEL', '2025-12-01', null);
with v as (insert into public.vendas (fazenda_id, data, comprador, notas_fiscais, sexo, categoria, quantidade, peso_balanca_kg, peso_frigorifico_kg, rendimento_pct, media_arroba, valor_arroba, valor_total, obs, origem) select id, '2026-05-12', 'MARFRIG S/A', '5823/24', 'F', 'Vaca/Novilha', 90.0, 43400.0, 22184.4, 51.1161, 16.4329, null, 500881.0, 'NF no nome da aba: "5823.4"; no resumo: "5823/24".', 'Importado de Vendas2026F2.xlsx / aba 12.05 - NF 5823.4' from fz returning id)
insert into public.venda_itens (venda_id, ordem, controle, chip, peso_kg, raca, nascimento, obs) values
  ((select id from v), 1, '111', null, null, 'NEL', '2020-10-01', null),
  ((select id from v), 2, '120', null, null, 'NEL', '2020-10-01', null),
  ((select id from v), 3, '159', null, null, 'NEL', '2020-10-01', null),
  ((select id from v), 4, '169', null, null, 'NEL', '2020-10-01', null),
  ((select id from v), 5, '320', null, null, 'NEL', '2020-10-01', null),
  ((select id from v), 6, '400', null, null, 'NEL', '2021-03-01', null),
  ((select id from v), 7, '469', null, null, 'NEL', '2021-09-01', null),
  ((select id from v), 8, '471', null, null, 'NEL', '2021-09-01', null),
  ((select id from v), 9, '554', null, null, 'NEL', '2021-09-01', null),
  ((select id from v), 10, '671', null, null, 'NEL', '2021-09-01', null),
  ((select id from v), 11, '673', null, null, 'NEL', '2021-09-01', null),
  ((select id from v), 12, '721', null, null, 'NEL', '2021-09-01', null),
  ((select id from v), 13, '722', null, null, 'NEL', '2021-09-01', null),
  ((select id from v), 14, '740', null, null, 'NEL', '2021-09-01', null),
  ((select id from v), 15, '743', null, null, 'NEL', '2022-10-01', null),
  ((select id from v), 16, '833', null, null, 'NEL', '2022-10-01', null),
  ((select id from v), 17, '1053', null, null, 'NEL', '2022-10-01', null),
  ((select id from v), 18, '1316', null, null, 'NEL', '2022-10-01', null),
  ((select id from v), 19, '1330', null, null, 'NEL', '2022-10-01', null),
  ((select id from v), 20, '1350', null, null, 'NEL', '2022-10-01', null),
  ((select id from v), 21, '1501', null, null, 'NEL', '2022-10-01', null),
  ((select id from v), 22, '1626', null, null, 'NEL', '2023-09-01', null),
  ((select id from v), 23, '1639', null, null, 'NEL', '2023-09-01', null),
  ((select id from v), 24, '1648', null, null, 'NEL', '2023-09-01', null),
  ((select id from v), 25, '1669', null, null, 'NEL', '2023-09-01', null),
  ((select id from v), 26, '1673', null, null, 'NEL', '2023-09-01', null),
  ((select id from v), 27, '1716', null, null, 'NEL', '2023-09-01', null),
  ((select id from v), 28, '1725', null, null, 'NEL', '2023-09-01', null),
  ((select id from v), 29, '1729', null, null, 'NEL', '2023-09-01', null),
  ((select id from v), 30, '1753', null, null, 'NEL', '2023-09-01', null),
  ((select id from v), 31, '1758', null, null, 'NEL', '2023-09-01', null),
  ((select id from v), 32, '1764', null, null, 'NEL', '2023-09-01', null),
  ((select id from v), 33, '1769', null, null, 'NEL', '2023-09-01', null),
  ((select id from v), 34, '1772', null, null, 'NEL', '2023-09-01', null),
  ((select id from v), 35, '1788', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 36, '1844', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 37, '1878', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 38, '1879', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 39, '1902', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 40, '1907', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 41, '1908', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 42, '1912', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 43, '1936', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 44, '1937', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 45, '1943', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 46, '1963', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 47, '1979', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 48, '2011', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 49, '2016', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 50, '2022', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 51, '2033', null, null, 'NEL', '2023-10-01', null),
  ((select id from v), 52, '2053', null, null, 'NEL', '2023-12-01', null),
  ((select id from v), 53, '2062', null, null, 'NEL', '2023-12-01', null),
  ((select id from v), 54, '2095', null, null, 'NEL', '2023-12-01', null),
  ((select id from v), 55, '2103', null, null, 'NEL', '2023-12-01', null),
  ((select id from v), 56, '2106', null, null, 'NEL', '2023-12-01', null),
  ((select id from v), 57, '2113', null, null, 'NEL', '2023-12-01', null),
  ((select id from v), 58, '2122', null, null, 'NEL', '2024-01-01', null),
  ((select id from v), 59, '2133', null, null, 'NEL', '2024-01-01', null),
  ((select id from v), 60, '2135', null, null, 'NEL', '2024-01-01', null),
  ((select id from v), 61, '2148', null, null, 'NEL', '2024-01-01', null),
  ((select id from v), 62, '2167', null, null, 'NEL', '2024-01-01', null),
  ((select id from v), 63, '2200', null, null, 'NEL', '2024-01-01', null),
  ((select id from v), 64, '2235', null, null, 'NEL', '2024-01-01', null),
  ((select id from v), 65, '2489', null, null, 'NEL', '2023-04-01', null),
  ((select id from v), 66, '2511', null, null, 'NEL', '2023-04-01', null),
  ((select id from v), 67, '2532', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 68, '2542', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 69, '2550', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 70, '2562', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 71, '2564', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 72, '2587', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 73, '2597', null, null, 'NEL', '2023-08-01', null),
  ((select id from v), 74, '2656', null, null, 'NEL', '2023-04-01', null),
  ((select id from v), 75, '2673', null, null, 'NEL', '2023-04-01', null),
  ((select id from v), 76, '2692', null, null, 'NEL', '2023-04-01', null),
  ((select id from v), 77, '2769', null, null, 'NEL', '2023-01-01', null),
  ((select id from v), 78, '2788', null, null, 'NEL', '2023-01-01', null),
  ((select id from v), 79, '2800', null, null, 'NEL', '2023-01-01', null),
  ((select id from v), 80, '2938', null, null, 'NEL', '2023-01-01', null),
  ((select id from v), 81, '3089', null, null, 'NEL', '2020-11-01', null),
  ((select id from v), 82, '3100', null, null, 'NEL', '2020-11-01', null),
  ((select id from v), 83, '3104', null, null, 'NEL', '2020-11-01', null),
  ((select id from v), 84, '3356', null, null, 'NEL', '2018-09-01', null),
  ((select id from v), 85, '3525', null, null, 'NEL', '2020-12-01', null),
  ((select id from v), 86, '3688', null, null, 'NEL', '2021-11-01', null),
  ((select id from v), 87, '3882', null, null, 'NEL', '2021-12-01', null),
  ((select id from v), 88, '3937', null, null, 'NEL', '2018-12-01', null),
  ((select id from v), 89, '4104', null, null, 'NEL', '2019-02-01', null),
  ((select id from v), 90, '4730', null, null, 'NEL', '2020-12-01', null);
with v as (insert into public.vendas (fazenda_id, data, comprador, notas_fiscais, sexo, categoria, quantidade, peso_balanca_kg, peso_frigorifico_kg, rendimento_pct, media_arroba, valor_arroba, valor_total, obs, origem) select id, '2026-06-10', 'CARLOS GARCIA', '5836', 'M', 'Bezerro', 126.0, 32947.0, null, null, 8.7161, 480.0, 527152.0, null, 'Importado de Vendas2026F2.xlsx / aba 10.06 - NF 5836' from fz returning id)
insert into public.venda_itens (venda_id, ordem, controle, chip, peso_kg, raca, nascimento, obs) values
  ((select id from v), 1, '6881', null, 267.0, 'NEL', '2025-08-01', null),
  ((select id from v), 2, '7009', null, 235.0, 'NEL', '2025-08-01', null),
  ((select id from v), 3, '7076', null, 273.0, 'NEL', '2025-08-01', null),
  ((select id from v), 4, '7077', null, 277.0, 'NEL', '2025-08-01', null),
  ((select id from v), 5, '7079', null, 269.0, 'NEL', '2025-08-01', null),
  ((select id from v), 6, '7080', null, 271.0, 'NEL', '2025-08-01', null),
  ((select id from v), 7, '7087', null, 282.0, 'NEL', '2025-08-01', null),
  ((select id from v), 8, '7092', null, 251.0, 'NEL', '2025-08-01', null),
  ((select id from v), 9, '7099', null, 258.0, 'NEL', '2025-08-01', null),
  ((select id from v), 10, '7104', null, 254.0, 'NEL', '2025-08-01', null),
  ((select id from v), 11, '7108', null, 266.0, 'NEL', '2025-08-01', null),
  ((select id from v), 12, '7111', null, 261.0, 'NEL', '2025-08-01', null),
  ((select id from v), 13, '7113', null, 263.0, 'NEL', '2025-08-01', null),
  ((select id from v), 14, '7130', null, 318.0, 'NEL', '2025-09-10', null),
  ((select id from v), 15, '7131', null, 277.0, 'NEL', '2025-09-10', null),
  ((select id from v), 16, '7144', null, 256.0, 'NEL', '2025-09-10', null),
  ((select id from v), 17, '7146', null, 201.0, 'NEL', '2025-09-10', null),
  ((select id from v), 18, '7147', null, 275.0, 'NEL', '2025-09-10', null),
  ((select id from v), 19, '7150', null, 258.0, 'NEL', '2025-09-10', null),
  ((select id from v), 20, '7155', null, 224.0, 'NEL', '2025-09-10', null),
  ((select id from v), 21, '7156', null, 273.0, 'NEL', '2025-09-10', null),
  ((select id from v), 22, '7164', null, 238.0, 'NEL', '2025-09-10', null),
  ((select id from v), 23, '7165', null, 226.0, 'NEL', '2025-09-10', null),
  ((select id from v), 24, '7166', null, 286.0, 'NEL', '2025-09-10', null),
  ((select id from v), 25, '7168', null, 238.0, 'NEL', '2025-09-10', null),
  ((select id from v), 26, '7170', null, 261.0, 'NEL', '2025-09-10', null),
  ((select id from v), 27, '7177', null, 215.0, 'NEL', '2025-09-10', null),
  ((select id from v), 28, '7180', null, 246.0, 'NEL', '2025-09-10', null),
  ((select id from v), 29, '7188', null, 260.0, 'NEL', '2025-09-10', null),
  ((select id from v), 30, '7194', null, 234.0, 'NEL', '2025-09-10', null),
  ((select id from v), 31, '7195', null, 298.0, 'NEL', '2025-09-10', null),
  ((select id from v), 32, '7200', null, 277.0, 'NEL', '2025-09-10', null),
  ((select id from v), 33, '7201', null, 259.0, 'NEL', '2025-09-10', null),
  ((select id from v), 34, '7204', null, 298.0, 'NEL', '2025-09-10', null),
  ((select id from v), 35, '7206', null, 328.0, 'NEL', '2025-09-10', null),
  ((select id from v), 36, '7207', null, 259.0, 'NEL', '2025-09-12', null),
  ((select id from v), 37, '7208', null, 295.0, 'NEL', '2025-09-12', null),
  ((select id from v), 38, '7210', null, 267.0, 'NEL', '2025-09-12', null),
  ((select id from v), 39, '7215', null, 312.0, 'NEL', '2025-09-12', null),
  ((select id from v), 40, '7216', null, 272.0, 'NEL', '2025-09-12', null),
  ((select id from v), 41, '7218', null, 295.0, 'NEL', '2025-09-12', null),
  ((select id from v), 42, '7219', null, 283.0, 'NEL', '2025-09-12', null),
  ((select id from v), 43, '7220', null, 261.0, 'NEL', '2025-09-12', null),
  ((select id from v), 44, '7221', null, 286.0, 'NEL', '2025-09-12', null),
  ((select id from v), 45, '7223', null, 271.0, 'NEL', '2025-09-12', null),
  ((select id from v), 46, '7224', null, 251.0, 'NEL', '2025-09-12', null),
  ((select id from v), 47, '7230', null, 231.0, 'NEL', '2025-09-12', null),
  ((select id from v), 48, '7232', null, 220.0, 'NEL', '2025-09-12', null),
  ((select id from v), 49, '7236', null, 293.0, 'NEL', '2025-09-12', null),
  ((select id from v), 50, '7246', null, 272.0, 'NEL', '2025-09-12', null),
  ((select id from v), 51, '7248', null, 266.0, 'NEL', '2025-09-12', null),
  ((select id from v), 52, '7255', null, 293.0, 'NEL', '2025-09-12', null),
  ((select id from v), 53, '7259', null, 261.0, 'NEL', '2025-09-12', null),
  ((select id from v), 54, '7263', null, 209.0, 'NEL', '2025-09-12', null),
  ((select id from v), 55, '7264', null, 310.0, 'NEL', '2025-09-12', null),
  ((select id from v), 56, '7270', null, 301.0, 'NEL', '2025-09-12', null),
  ((select id from v), 57, '7275', null, 299.0, 'NEL', '2025-09-12', null),
  ((select id from v), 58, '7276', null, 312.0, 'NEL', '2025-09-12', null),
  ((select id from v), 59, '7277', null, 307.0, 'NEL', '2025-09-12', null),
  ((select id from v), 60, '7285', null, 273.0, 'NEL', '2025-09-12', null),
  ((select id from v), 61, '7287', null, 269.0, 'NEL', '2025-09-12', null),
  ((select id from v), 62, '7288', null, 294.0, 'NEL', '2025-09-12', null),
  ((select id from v), 63, '7290', null, 307.0, 'NEL', '2025-09-12', null),
  ((select id from v), 64, '7297', null, 304.0, 'NEL', '2025-09-12', null),
  ((select id from v), 65, '7300', null, 251.0, 'NEL', '2025-09-12', null),
  ((select id from v), 66, '7301', null, 311.0, 'NEL', '2025-09-12', null),
  ((select id from v), 67, '7303', null, 266.0, 'NEL', '2025-09-12', null),
  ((select id from v), 68, '7304', null, 280.0, 'NEL', '2025-09-12', null),
  ((select id from v), 69, '7308', null, 277.0, 'NEL', '2025-09-12', null),
  ((select id from v), 70, '7309', null, 299.0, 'NEL', '2025-09-12', null),
  ((select id from v), 71, '7314', null, 300.0, 'NEL', '2025-09-12', null),
  ((select id from v), 72, '7315', null, 274.0, 'NEL', '2025-09-12', null),
  ((select id from v), 73, '7316', null, 329.0, 'NEL', '2025-09-12', null),
  ((select id from v), 74, '7317', null, 315.0, 'NEL', '2025-09-12', null),
  ((select id from v), 75, '7318', null, 337.0, 'NEL', '2025-09-12', 'Mesmo número aparece também na venda "06.05 - NF 5799.5800.09" (provável erro de digitação).'),
  ((select id from v), 76, '7321', null, 289.0, 'NEL', '2025-09-12', null),
  ((select id from v), 77, '7322', null, 284.0, 'NEL', '2025-09-12', null),
  ((select id from v), 78, '7323', null, 254.0, 'NEL', '2025-09-12', null),
  ((select id from v), 79, '7326', null, 327.0, 'NEL', '2025-09-12', null),
  ((select id from v), 80, '7331', null, 244.0, 'NEL', '2025-10-16', null),
  ((select id from v), 81, '7335', null, 204.0, 'NEL', '2025-10-16', null),
  ((select id from v), 82, '7342', null, 203.0, 'NEL', '2025-10-16', null),
  ((select id from v), 83, '7344', null, 248.0, 'NEL', '2025-10-16', null),
  ((select id from v), 84, '7350', null, 248.0, 'NEL', '2025-10-16', null),
  ((select id from v), 85, '7357', null, 242.0, 'NEL', '2025-10-16', null),
  ((select id from v), 86, '7360', null, 238.0, 'NEL', '2025-10-16', null),
  ((select id from v), 87, '7364', null, 245.0, 'NEL', '2025-10-16', null),
  ((select id from v), 88, '7381', null, 239.0, 'NEL', '2025-10-16', null),
  ((select id from v), 89, '7400', null, 209.0, 'NEL', '2025-10-16', null),
  ((select id from v), 90, '7402', null, 233.0, 'NEL', '2025-10-16', null),
  ((select id from v), 91, '7404', null, 210.0, 'NEL', '2025-10-16', null),
  ((select id from v), 92, '7416', null, 201.0, 'NEL', '2025-10-17', null),
  ((select id from v), 93, '7418', null, 251.0, 'NEL', '2025-10-17', null),
  ((select id from v), 94, '7420', null, 192.0, 'NEL', '2025-10-17', null),
  ((select id from v), 95, '7422', null, 245.0, 'NEL', '2025-10-17', null),
  ((select id from v), 96, '7426', null, 230.0, 'NEL', '2025-10-17', null),
  ((select id from v), 97, '7433', null, 228.0, 'NEL', '2025-10-17', null),
  ((select id from v), 98, '7441', null, 229.0, 'NEL', '2025-10-17', null),
  ((select id from v), 99, '7451', null, 208.0, 'NEL', '2025-10-17', null),
  ((select id from v), 100, '7457', null, 223.0, 'NEL', '2025-10-17', null),
  ((select id from v), 101, '7458', null, 208.0, 'NEL', '2025-10-17', null),
  ((select id from v), 102, '7476', null, 234.0, 'NEL', '2025-10-17', null),
  ((select id from v), 103, '7482', null, 230.0, 'NEL', '2025-10-18', null),
  ((select id from v), 104, '7483', null, 211.0, 'NEL', '2025-10-18', 'Mesmo número aparece também na venda "06.05 - NF 5799.5800.09" (provável erro de digitação).'),
  ((select id from v), 105, '7491', null, 239.0, 'NEL', '2025-10-18', null),
  ((select id from v), 106, '7496', null, 208.0, 'NEL', '2025-10-18', null),
  ((select id from v), 107, '7501', null, 233.0, 'NEL', '2025-10-18', null),
  ((select id from v), 108, '7513', null, 248.0, 'NEL', '2025-10-18', null),
  ((select id from v), 109, '7516', null, 190.0, 'NEL', '2025-10-22', null),
  ((select id from v), 110, '7540', null, 232.0, 'NEL', '2025-10-22', null),
  ((select id from v), 111, '7543', null, 315.0, 'NEL', '2025-10-22', null),
  ((select id from v), 112, '7544', null, 297.0, 'NEL', '2025-10-22', null),
  ((select id from v), 113, '7547', null, 304.0, 'NEL', '2025-10-22', null),
  ((select id from v), 114, '7549', null, 249.0, 'NEL', '2025-10-22', null),
  ((select id from v), 115, '7556', null, 240.0, 'NEL', '2025-10-22', null),
  ((select id from v), 116, '7557', null, 271.0, 'NEL', '2025-10-22', null),
  ((select id from v), 117, '7560', null, 275.0, 'NEL', '2025-10-22', null),
  ((select id from v), 118, '7562', null, 286.0, 'NEL', '2025-10-22', null),
  ((select id from v), 119, '7564', null, 308.0, 'NEL', '2025-10-22', null),
  ((select id from v), 120, '7566', null, 242.0, 'NEL', '2025-10-22', null),
  ((select id from v), 121, '7568', null, 292.0, 'NEL', '2025-10-22', null),
  ((select id from v), 122, '7569', null, 269.0, 'NEL', '2025-10-22', null),
  ((select id from v), 123, '7582', null, 239.0, 'NEL', '2025-11-22', null),
  ((select id from v), 124, '7667', null, 252.0, 'NEL', '2025-11-30', null),
  ((select id from v), 125, '7684', null, 217.0, 'NEL', '2025-11-30', null),
  ((select id from v), 126, '7839', null, 249.0, 'NEL', '2025-11-30', null);
with v as (insert into public.vendas (fazenda_id, data, comprador, notas_fiscais, sexo, categoria, quantidade, peso_balanca_kg, peso_frigorifico_kg, rendimento_pct, media_arroba, valor_arroba, valor_total, obs, origem) select id, '2026-08-13', 'CARLOS GARCIA', '5934.5', 'M', 'Bezerro', 169.0, 40904.0, null, null, 8.0679, 465.0, 634012.0, 'NF no nome da aba: "5934.35"; no resumo: "5934.5".', 'Importado de Vendas2026F2.xlsx / aba 13.08 - NF 5934.35' from fz returning id)
insert into public.venda_itens (venda_id, ordem, controle, chip, peso_kg, raca, nascimento, obs) values
  ((select id from v), 1, '7444', '7524', 310.0, 'NEL', '2025-10-17', 'Mesmo número aparece também na venda "06.05 - NF 5799.5800.09" (provável erro de digitação).'),
  ((select id from v), 2, '7571', null, 249.0, 'NEL', '2025-11-22', null),
  ((select id from v), 3, '7572', null, 250.0, 'NEL', '2025-11-22', null),
  ((select id from v), 4, '7573', null, 253.0, 'NEL', '2025-11-22', null),
  ((select id from v), 5, '7575', null, 248.0, 'NEL', '2025-11-22', null),
  ((select id from v), 6, '7577', null, 238.0, 'NEL', '2025-11-22', null),
  ((select id from v), 7, '7578', null, 288.0, 'NEL', '2025-11-22', null),
  ((select id from v), 8, '7580', null, 250.0, 'NEL', '2025-11-22', null),
  ((select id from v), 9, '7581', null, 201.0, 'NEL', '2025-11-22', null),
  ((select id from v), 10, '7583', null, 231.0, 'NEL', '2025-11-22', null),
  ((select id from v), 11, '7586', null, 230.0, 'NEL', '2025-11-22', null),
  ((select id from v), 12, '7587', null, 240.0, 'NEL', '2025-11-22', null),
  ((select id from v), 13, '7588', null, 240.0, 'NEL', '2025-11-22', null),
  ((select id from v), 14, '7591', null, 245.0, 'NEL', '2025-11-22', null),
  ((select id from v), 15, '7592', null, 255.0, 'NEL', '2025-11-22', null),
  ((select id from v), 16, '7593', null, 209.0, 'NEL', '2025-11-22', null),
  ((select id from v), 17, '7594', null, 284.0, 'NEL', '2025-11-22', null),
  ((select id from v), 18, '7596', '7590', 241.0, 'NEL', '2025-11-22', null),
  ((select id from v), 19, '7597', null, 242.0, 'NEL', '2025-11-22', null),
  ((select id from v), 20, '7598', null, 223.0, 'NEL', '2025-11-22', null),
  ((select id from v), 21, '7602', null, 254.0, 'NEL', '2025-11-22', null),
  ((select id from v), 22, '7603', null, 242.0, 'NEL', '2025-11-22', null),
  ((select id from v), 23, '7605', '7615', 236.0, 'NEL', '2025-11-26', null),
  ((select id from v), 24, '7609', null, 281.0, 'NEL', '2025-11-29', null),
  ((select id from v), 25, '7610', null, 303.0, 'NEL', '2025-11-29', null),
  ((select id from v), 26, '7618', null, 271.0, 'NEL', '2025-11-29', null),
  ((select id from v), 27, '7619', null, 249.0, 'NEL', '2025-11-29', null),
  ((select id from v), 28, '7622', '7611', 235.0, 'NEL', '2025-11-29', null),
  ((select id from v), 29, '7628', null, 257.0, 'NEL', '2025-11-29', null),
  ((select id from v), 30, '7632', null, 279.0, 'NEL', '2025-11-29', null),
  ((select id from v), 31, '7633', '7833', 245.0, 'NEL', '2025-11-29', null),
  ((select id from v), 32, '7634', null, 289.0, 'NEL', '2025-11-29', null),
  ((select id from v), 33, '7635', null, 257.0, 'NEL', '2025-11-29', null),
  ((select id from v), 34, '7636', null, 278.0, 'NEL', '2025-11-29', null),
  ((select id from v), 35, '7637', null, 271.0, 'NEL', '2025-11-29', null),
  ((select id from v), 36, '7638', null, 263.0, 'NEL', '2025-11-29', null),
  ((select id from v), 37, '7640', null, 272.0, 'NEL', '2025-11-29', null),
  ((select id from v), 38, '7641', null, 282.0, 'NEL', '2025-11-29', null),
  ((select id from v), 39, '7643', '7846', 256.0, 'NEL', '2025-11-29', null),
  ((select id from v), 40, '7647', null, 268.0, 'NEL', '2025-11-29', null),
  ((select id from v), 41, '7648', null, 249.0, 'NEL', '2025-11-29', null),
  ((select id from v), 42, '7651', null, 279.0, 'NEL', '2025-11-29', null),
  ((select id from v), 43, '7652', null, 235.0, 'NEL', '2025-11-29', null),
  ((select id from v), 44, '7653', null, 270.0, 'NEL', '2025-11-29', null),
  ((select id from v), 45, '7656', null, 304.0, 'NEL', '2025-11-29', null),
  ((select id from v), 46, '7661', '7601', 296.0, 'NEL', '2025-11-29', null),
  ((select id from v), 47, '7664', null, 216.0, 'NEL', '2025-11-29', null),
  ((select id from v), 48, '7665', '7695', 245.0, 'NEL', '2025-11-29', null),
  ((select id from v), 49, '7666', null, 241.0, 'NEL', '2025-11-29', null),
  ((select id from v), 50, '7674', null, 243.0, 'NEL', '2025-11-29', null),
  ((select id from v), 51, '7675', null, 254.0, 'NEL', '2025-11-29', null),
  ((select id from v), 52, '7678', null, 197.0, 'NEL', '2025-11-29', null),
  ((select id from v), 53, '7680', null, 287.0, 'NEL', '2025-12-28', null),
  ((select id from v), 54, '7681', null, 226.0, 'NEL', '2025-12-28', null),
  ((select id from v), 55, '7682', null, 248.0, 'NEL', '2025-12-28', null),
  ((select id from v), 56, '7683', null, 258.0, 'NEL', '2025-12-28', null),
  ((select id from v), 57, '7685', null, 272.0, 'NEL', '2025-12-28', null),
  ((select id from v), 58, '7687', '7567', 265.0, 'NEL', '2025-12-28', null),
  ((select id from v), 59, '7688', null, 297.0, 'NEL', '2025-12-28', null),
  ((select id from v), 60, '7689', '7550', 211.0, 'NEL', '2025-12-28', null),
  ((select id from v), 61, '7690', null, 281.0, 'NEL', '2025-12-28', null),
  ((select id from v), 62, '7696', null, 256.0, 'NEL', '2025-12-28', null),
  ((select id from v), 63, '7705', null, 248.0, 'NEL', '2025-12-28', null),
  ((select id from v), 64, '7706', null, 276.0, 'NEL', '2025-12-28', null),
  ((select id from v), 65, '7708', null, 199.0, 'NEL', '2025-12-28', null),
  ((select id from v), 66, '7711', null, 251.0, 'NEL', '2025-12-28', null),
  ((select id from v), 67, '7713', null, 262.0, 'NEL', '2025-12-28', null),
  ((select id from v), 68, '7715', null, 210.0, 'NEL', '2025-12-28', null),
  ((select id from v), 69, '7718', null, 261.0, 'NEL', '2025-12-28', null),
  ((select id from v), 70, '7719', null, 227.0, 'NEL', '2025-12-28', null),
  ((select id from v), 71, '7720', null, 250.0, 'NEL', '2025-12-28', null),
  ((select id from v), 72, '7722', null, 251.0, 'NEL', '2025-12-28', null),
  ((select id from v), 73, '7723', null, 231.0, 'NEL', '2025-12-28', null),
  ((select id from v), 74, '7725', null, 247.0, 'NEL', '2025-12-28', null),
  ((select id from v), 75, '7727', null, 253.0, 'NEL', '2025-12-28', null),
  ((select id from v), 76, '7728', null, 208.0, 'NEL', '2025-12-28', null),
  ((select id from v), 77, '7736', null, 249.0, 'NEL', '2025-12-30', null),
  ((select id from v), 78, '7737', null, 273.0, 'NEL', '2025-12-30', null),
  ((select id from v), 79, '7743', null, 230.0, 'NEL', '2025-12-30', null),
  ((select id from v), 80, '7744', null, 226.0, 'NEL', '2025-12-30', null),
  ((select id from v), 81, '7745', null, 246.0, 'NEL', '2025-12-30', null),
  ((select id from v), 82, '7746', null, 284.0, 'NEL', '2025-12-30', null),
  ((select id from v), 83, '7747', null, 248.0, 'NEL', '2025-12-30', null),
  ((select id from v), 84, '7751', null, 229.0, 'NEL', '2025-12-30', null),
  ((select id from v), 85, '7752', null, 236.0, 'NEL', '2025-12-30', null),
  ((select id from v), 86, '7754', null, 272.0, 'NEL', '2025-12-30', null),
  ((select id from v), 87, '7755', null, 319.0, 'NEL', '2025-12-30', null),
  ((select id from v), 88, '7757', null, 249.0, 'NEL', '2025-12-30', null),
  ((select id from v), 89, '7760', null, 236.0, 'NEL', '2025-12-30', null),
  ((select id from v), 90, '7761', null, 270.0, 'NEL', '2025-12-30', null),
  ((select id from v), 91, '7762', null, 287.0, 'NEL', '2025-12-30', null),
  ((select id from v), 92, '7764', null, 253.0, 'NEL', '2025-12-30', null),
  ((select id from v), 93, '7766', null, 216.0, 'NEL', '2025-12-30', null),
  ((select id from v), 94, '7768', null, 264.0, 'NEL', '2025-12-30', null),
  ((select id from v), 95, '7769', null, 267.0, 'NEL', '2025-12-30', null),
  ((select id from v), 96, '7770', null, 248.0, 'NEL', '2025-12-30', null),
  ((select id from v), 97, '7772', null, 242.0, 'NEL', '2025-12-30', null),
  ((select id from v), 98, '7773', null, 281.0, 'NEL', '2025-12-30', null),
  ((select id from v), 99, '7777', null, 286.0, 'NEL', '2025-12-30', null),
  ((select id from v), 100, '7778', '7784', 218.0, 'NEL', '2025-12-30', null),
  ((select id from v), 101, '7779', null, 249.0, 'NEL', '2025-12-30', null),
  ((select id from v), 102, '7782', null, 249.0, 'NEL', '2025-12-30', null),
  ((select id from v), 103, '7783', '7786', 228.0, 'NEL', '2025-12-30', null),
  ((select id from v), 104, '7785', null, 230.0, 'NEL', '2025-12-30', null),
  ((select id from v), 105, '7788', null, 239.0, 'NEL', '2025-12-30', null),
  ((select id from v), 106, '7789', null, 289.0, 'NEL', '2025-12-30', null),
  ((select id from v), 107, '7791', null, 251.0, 'NEL', '2025-12-30', null),
  ((select id from v), 108, '7794', null, 221.0, 'NEL', '2025-12-30', null),
  ((select id from v), 109, '7797', null, 255.0, 'NEL', '2025-12-30', null),
  ((select id from v), 110, '7798', null, 196.0, 'NEL', '2025-12-30', null),
  ((select id from v), 111, '7800', null, 203.0, 'NEL', '2025-12-30', null),
  ((select id from v), 112, '7802', '7882', 197.0, 'NEL', '2025-12-30', null),
  ((select id from v), 113, '7807', null, 219.0, 'NEL', '2025-12-30', null),
  ((select id from v), 114, '7808', null, 245.0, 'NEL', '2025-12-30', null),
  ((select id from v), 115, '7811', null, 240.0, 'NEL', '2025-12-30', null),
  ((select id from v), 116, '7812', null, 257.0, 'NEL', '2025-12-30', null),
  ((select id from v), 117, '7813', null, 276.0, 'NEL', '2025-12-30', null),
  ((select id from v), 118, '7814', null, 227.0, 'NEL', '2025-12-30', null),
  ((select id from v), 119, '7821', null, 272.0, 'NEL', '2025-12-30', null),
  ((select id from v), 120, '7822', null, 225.0, 'NEL', '2025-12-30', null),
  ((select id from v), 121, '7824', null, 203.0, 'NEL', '2025-12-30', null),
  ((select id from v), 122, '7825', null, 213.0, 'NEL', '2025-12-31', null),
  ((select id from v), 123, '7828', null, 253.0, 'NEL', '2025-12-31', null),
  ((select id from v), 124, '7829', null, 196.0, 'NEL', '2025-12-31', null),
  ((select id from v), 125, '7832', null, 237.0, 'NEL', '2025-12-31', null),
  ((select id from v), 126, '7834', null, 220.0, 'NEL', '2025-12-31', null),
  ((select id from v), 127, '7837', null, 220.0, 'NEL', '2025-12-31', null),
  ((select id from v), 128, '7838', null, 219.0, 'NEL', '2025-12-31', null),
  ((select id from v), 129, '7841', null, 250.0, 'NEL', '2025-12-31', null),
  ((select id from v), 130, '7842', null, 216.0, 'NEL', '2025-12-31', null),
  ((select id from v), 131, '7843', null, 196.0, 'NEL', '2025-12-31', null),
  ((select id from v), 132, '7845', null, 212.0, 'NEL', '2025-12-31', null),
  ((select id from v), 133, '7850', null, 274.0, 'NEL', '2025-12-31', null),
  ((select id from v), 134, '7852', null, 222.0, 'NEL', '2025-12-31', null),
  ((select id from v), 135, '7854', null, 212.0, 'NEL', '2025-12-31', null),
  ((select id from v), 136, '7857', null, 211.0, 'NEL', '2025-12-31', null),
  ((select id from v), 137, '7860', null, 224.0, 'NEL', '2025-12-31', null),
  ((select id from v), 138, '7863', null, 239.0, 'NEL', '2025-12-31', null),
  ((select id from v), 139, '7866', null, 237.0, 'NEL', '2025-12-31', null),
  ((select id from v), 140, '7872', null, 186.0, 'NEL', '2025-12-31', null),
  ((select id from v), 141, '7874', null, 221.0, 'NEL', '2026-01-31', null),
  ((select id from v), 142, '7880', null, 178.0, 'NEL', '2026-01-31', null),
  ((select id from v), 143, '7881', null, 210.0, 'NEL', '2026-01-31', null),
  ((select id from v), 144, '7883', null, 218.0, 'NEL', '2026-01-31', null),
  ((select id from v), 145, '7886', null, 237.0, 'NEL', '2026-01-31', null),
  ((select id from v), 146, '7888', null, 239.0, 'NEL', '2026-01-31', null),
  ((select id from v), 147, '7889', null, 217.0, 'NEL', '2026-01-31', null),
  ((select id from v), 148, '7892', null, 246.0, 'NEL', '2026-01-31', null),
  ((select id from v), 149, '7893', null, 208.0, 'NEL', '2026-01-31', null),
  ((select id from v), 150, '7894', null, 228.0, 'NEL', '2026-01-31', null),
  ((select id from v), 151, '7896', null, 243.0, 'NEL', '2026-01-31', null),
  ((select id from v), 152, '7898', null, 211.0, 'NEL', '2026-01-31', null),
  ((select id from v), 153, '7899', null, 217.0, 'NEL', '2026-01-31', null),
  ((select id from v), 154, '7900', null, 197.0, 'NEL', '2026-01-31', null),
  ((select id from v), 155, '7903', null, 217.0, 'NEL', '2026-01-31', null),
  ((select id from v), 156, '7904', null, 208.0, 'NEL', '2026-01-31', null),
  ((select id from v), 157, '7905', null, 214.0, 'NEL', '2026-01-31', null),
  ((select id from v), 158, '7908', null, 229.0, 'NEL', '2026-01-31', null),
  ((select id from v), 159, '7910', null, 193.0, 'NEL', '2026-01-31', null),
  ((select id from v), 160, '7912', null, 234.0, 'NEL', '2026-01-31', null),
  ((select id from v), 161, '7913', null, 181.0, 'NEL', '2026-01-31', null),
  ((select id from v), 162, '7916', null, 230.0, 'NEL', '2026-01-31', null),
  ((select id from v), 163, '7919', null, 226.0, 'NEL', '2026-01-31', null),
  ((select id from v), 164, '7923', null, 247.0, 'NEL', '2026-01-31', null),
  ((select id from v), 165, '7924', null, 242.0, 'NEL', '2026-01-31', null),
  ((select id from v), 166, '7925', null, 204.0, 'NEL', '2026-01-31', null),
  ((select id from v), 167, '7926', null, 224.0, 'NEL', '2026-01-31', null),
  ((select id from v), 168, '7928', null, 236.0, 'NEL', '2026-01-31', null),
  ((select id from v), 169, '7931', null, 193.0, 'NEL', '2026-01-31', null);
commit;

-- >>>>>>>>>> migrations/004_offline.sql
-- =====================================================================
-- Etapa 1.2 — suporte a uso SEM INTERNET
-- O celular gera o identificador de cada lançamento. Se o envio for
-- repetido (internet caiu no meio), o banco reconhece e não duplica.
-- Rode depois do 003. Não apaga nenhum dado.
-- =====================================================================

drop function if exists public.registrar_nascimento(uuid, uuid, uuid, text, date, text, text, numeric, text, text, text, text);

create or replace function public.registrar_nascimento(
  p_fazenda_id uuid, p_mae_id uuid, p_pai_id uuid, p_pai_descricao text,
  p_data date, p_sexo text, p_raca text, p_peso numeric,
  p_controle text, p_chip text, p_brinco text, p_obs text,
  p_id uuid default null           -- id do bezerro gerado no celular
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_pasto uuid; v_lote uuid;
begin
  -- reenvio do mesmo lançamento: já existe, só confirma
  if exists (select 1 from public.animais where id = v_id) then
    return v_id;
  end if;
  if p_mae_id is not null then
    select pasto_id, lote_id into v_pasto, v_lote from public.animais where id = p_mae_id;
  end if;
  insert into public.animais (id, fazenda_id, controle, chip, brinco, sexo, raca, nascimento,
                              categoria, mae_id, pai_id, pai_descricao, pasto_id, lote_id, obs)
  values (v_id, p_fazenda_id, nullif(trim(p_controle),''), nullif(trim(p_chip),''), nullif(trim(p_brinco),''),
          p_sexo, p_raca, p_data,
          case when p_sexo = 'M' then 'Bezerro' else 'Bezerra' end,
          p_mae_id, p_pai_id, nullif(trim(p_pai_descricao),''), v_pasto, v_lote, p_obs);

  insert into public.nascimentos (bezerro_id, mae_id, pai_id, pai_descricao, data, peso_nascer_kg, obs)
  values (v_id, p_mae_id, p_pai_id, nullif(trim(p_pai_descricao),''), p_data, p_peso, p_obs);

  if p_peso is not null then
    insert into public.pesagens (animal_id, data, peso_kg, obs) values (v_id, p_data, p_peso, 'Peso ao nascer');
  end if;
  return v_id;
end $$;
grant execute on function public.registrar_nascimento(uuid, uuid, uuid, text, date, text, text, numeric, text, text, text, text, uuid) to authenticated;

-- Registra quando o lançamento foi feito no campo (pode ser antes do envio)
alter table public.pesagens      add column if not exists lancado_em timestamptz;
alter table public.movimentacoes add column if not exists lancado_em timestamptz;
alter table public.nascimentos   add column if not exists lancado_em timestamptz;
