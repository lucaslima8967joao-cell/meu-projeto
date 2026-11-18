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
