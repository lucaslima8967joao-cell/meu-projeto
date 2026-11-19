-- =====================================================================
-- Etapa 2 — módulos: IATF/tarefas por categoria, relatório mensal do
-- rebanho, mortes/abates, insumos e estoque, nutrição, serviços
-- (pastagens, cercas, benfeitorias), pedidos de compra, máquinas,
-- manutenção, diesel/abastecimentos e colaboradores.
-- Nada é apagado: arquivar. Tudo auditado.
-- =====================================================================

-- ---------------------------------------------------------------- tarefas
alter table public.tarefas add column if not exists categoria text not null default 'Geral';
create index if not exists ix_tarefas_categoria on public.tarefas (categoria, data);

-- ---------------------------------------------------------------- rebanho
create table public.rebanho_mensal (
  id uuid primary key default gen_random_uuid(),
  fazenda_id uuid not null references public.fazendas(id),
  mes date not null,                      -- sempre o dia 1 do mês
  grupo text not null check (grupo in ('Fêmeas','Machos','Equinos')),
  categoria text not null,
  ordem int not null default 0,
  estoque_anterior int not null default 0,
  nascimento int not null default 0, compra int not null default 0, transf_entrada int not null default 0,
  mudanca_menos int not null default 0, mudanca_mais int not null default 0,
  venda int not null default 0, ajuste_inventario int not null default 0, morte int not null default 0, abate int not null default 0,
  estoque_atual int not null default 0,
  obs text, origem text,
  criado_por uuid default auth.uid() references public.perfis(id),
  criado_em timestamptz not null default now(),
  unique (fazenda_id, mes, categoria)
);

create table public.ocorrencias (
  id uuid primary key default gen_random_uuid(),
  fazenda_id uuid not null references public.fazendas(id),
  data date not null,
  tipo text not null check (tipo in ('Morte','Abate','Descarte','Perda')),
  numero text, sexo text, chip text, idade_texto text, causa text,
  animal_id uuid references public.animais(id),
  obs text, origem text,
  criado_por uuid default auth.uid() references public.perfis(id),
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------- máquinas
create table public.maquinas (
  id uuid primary key default gen_random_uuid(),
  fazenda_id uuid not null references public.fazendas(id),
  nome text not null,
  tipo text,                              -- Trator, Caminhonete, Implemento, Equipamento…
  patrimonio text, marca text, modelo text, ano int, placa_serie text, localizacao text,
  responsavel_id uuid references public.perfis(id),
  estado text,                            -- Bom, Regular, Ruim, Parado
  unidade_uso text not null default 'h' check (unidade_uso in ('h','km')),
  uso_atual numeric(12,1) not null default 0,
  revisao_a_cada numeric(12,1),
  ultima_revisao_uso numeric(12,1),
  obs text, arquivado boolean not null default false,
  criado_por uuid default auth.uid() references public.perfis(id),
  criado_em timestamptz not null default now()
);

create table public.manutencoes (
  id uuid primary key default gen_random_uuid(),
  maquina_id uuid not null references public.maquinas(id),
  data date not null default current_date,
  tipo text not null check (tipo in ('Preventiva','Corretiva','Revisão')),
  descricao text not null,
  uso numeric(12,1), custo numeric(12,2), prestador text, pecas text, obs text,
  criado_por uuid default auth.uid() references public.perfis(id),
  criado_em timestamptz not null default now(), lancado_em timestamptz
);

-- revisão registra o uso em que foi feita
create or replace function public.aplicar_manutencao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.uso is not null then
    update public.maquinas set uso_atual = greatest(uso_atual, new.uso) where id = new.maquina_id;
    if new.tipo in ('Revisão','Preventiva') then
      update public.maquinas set ultima_revisao_uso = new.uso where id = new.maquina_id;
    end if;
  end if;
  return new;
end $$;
create trigger trg_aplicar_manutencao after insert on public.manutencoes
  for each row execute function public.aplicar_manutencao();

-- ---------------------------------------------------------------- insumos
create table public.insumos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  categoria text,                         -- Nutrição, Adubo/Corretivo, Defensivo, Semente, Medicamento, Combustível, Cerca, Peça, Outro
  unidade text not null,                  -- kg, L, t, un, dz, m…
  estoque_minimo numeric(14,3),
  obs text, arquivado boolean not null default false,
  criado_por uuid default auth.uid() references public.perfis(id),
  criado_em timestamptz not null default now()
);

create table public.servicos (
  id uuid primary key default gen_random_uuid(),
  fazenda_id uuid not null references public.fazendas(id),
  tipo text not null,                     -- Manutenção de pasto, Reforma de pasto, Cerca, Benfeitoria, Roçada, Outro
  titulo text not null,
  safra text,
  prioridade int,
  pasto_id uuid references public.pastos(id),
  local_texto text,
  area_ha numeric(10,2), metragem_m numeric(10,1),
  status text not null default 'Planejado' check (status in ('Planejado','Em andamento','Concluído','Cancelado')),
  data_prevista date, data_realizada date,
  custo_material_previsto numeric(14,2), custo_mo_previsto numeric(14,2), custo_realizado numeric(14,2),
  responsavel_id uuid references public.perfis(id),
  equipamento text, descricao text, obs text, origem text,
  arquivado boolean not null default false,
  criado_por uuid default auth.uid() references public.perfis(id),
  criado_em timestamptz not null default now()
);

create table public.servico_itens (
  id uuid primary key default gen_random_uuid(),
  servico_id uuid not null references public.servicos(id),
  insumo_id uuid references public.insumos(id),
  produto text not null,
  dose numeric(12,3), unidade_dose text,
  quantidade numeric(14,3), unidade text,
  valor_unitario numeric(14,4), valor_total numeric(14,2),
  obs text
);

create table public.insumo_movimentos (
  id uuid primary key default gen_random_uuid(),
  insumo_id uuid not null references public.insumos(id),
  data date not null default current_date,
  tipo text not null check (tipo in ('Entrada','Saída','Inventário')),
  quantidade numeric(14,3) not null check (quantidade >= 0),  -- Inventário = contagem física (saldo passa a ser este)
  valor_unitario numeric(14,4),
  fornecedor text, nota_fiscal text, lote_produto text, validade date,
  destino text, pasto_id uuid references public.pastos(id),
  maquina_id uuid references public.maquinas(id), uso_maquina numeric(12,1),
  servico_id uuid references public.servicos(id),
  responsavel_texto text, obs text,
  criado_por uuid default auth.uid() references public.perfis(id),
  criado_em timestamptz not null default now(), lancado_em timestamptz
);
create index ix_insumo_mov on public.insumo_movimentos (insumo_id, data, criado_em);

-- abastecimento atualiza o horímetro/km da máquina
create or replace function public.aplicar_abastecimento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.maquina_id is not null and new.uso_maquina is not null then
    update public.maquinas set uso_atual = greatest(uso_atual, new.uso_maquina) where id = new.maquina_id;
  end if;
  return new;
end $$;
create trigger trg_aplicar_abastecimento after insert on public.insumo_movimentos
  for each row execute function public.aplicar_abastecimento();

-- saldo: parte do último inventário e soma entradas/saídas posteriores
create or replace view public.v_insumos with (security_invoker = true) as
with ult_inv as (
  select distinct on (insumo_id) insumo_id, data, criado_em, quantidade
  from public.insumo_movimentos where tipo = 'Inventário'
  order by insumo_id, data desc, criado_em desc
)
select i.*,
  coalesce(ui.quantidade, 0)
  + coalesce((select sum(case when m.tipo = 'Entrada' then m.quantidade else -m.quantidade end)
              from public.insumo_movimentos m
              where m.insumo_id = i.id and m.tipo <> 'Inventário'
                and (ui.insumo_id is null or (m.data, m.criado_em) > (ui.data, ui.criado_em))), 0) as saldo,
  ui.data as data_inventario,
  (select max(data) from public.insumo_movimentos m where m.insumo_id = i.id) as ultimo_movimento,
  (select max(validade) filter (where validade >= current_date) from public.insumo_movimentos m where m.insumo_id = i.id and m.tipo = 'Entrada') as validade_mais_longa,
  (select min(validade) filter (where validade >= current_date) from public.insumo_movimentos m where m.insumo_id = i.id and m.tipo = 'Entrada') as proxima_validade
from public.insumos i
left join ult_inv ui on ui.insumo_id = i.id;

create or replace view public.v_maquinas with (security_invoker = true) as
select m.*,
  case when m.revisao_a_cada is null then null else coalesce(m.ultima_revisao_uso, 0) + m.revisao_a_cada end as proxima_revisao,
  case when m.revisao_a_cada is null then 'Sem plano'
       when m.uso_atual >= coalesce(m.ultima_revisao_uso, 0) + m.revisao_a_cada then 'Vencida'
       when m.uso_atual >= coalesce(m.ultima_revisao_uso, 0) + m.revisao_a_cada * 0.9 then 'Próxima'
       else 'Em dia' end as situacao_revisao
from public.maquinas m;

-- ---------------------------------------------------------------- nutrição
create table public.formulas (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique, descricao text, origem text,
  criado_em timestamptz not null default now()
);
create table public.formula_itens (
  id uuid primary key default gen_random_uuid(),
  formula_id uuid not null references public.formulas(id),
  insumo_id uuid not null references public.insumos(id),
  percentual numeric(6,4) not null check (percentual > 0 and percentual <= 1)
);
create table public.plano_nutricional (
  id uuid primary key default gen_random_uuid(),
  ano int not null, mes int not null check (mes between 1 and 12),
  categoria text not null, lote text, n_animais int,
  formula_id uuid references public.formulas(id), suplemento_texto text,
  consumo_kg_cab_dia numeric(8,3), dias int, previsto_kg numeric(14,1),
  obs text, origem text
);

-- ---------------------------------------------------------------- compras
create table public.pedidos_compra (
  id uuid primary key default gen_random_uuid(),
  data date not null default current_date,
  titulo text not null, safra text, centro_custo text,
  status text not null default 'Solicitado' check (status in ('Solicitado','Cotação','Comprado','Recebido','Cancelado')),
  obs text, origem text, arquivado boolean not null default false,
  criado_por uuid default auth.uid() references public.perfis(id),
  criado_em timestamptz not null default now()
);
create table public.pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos_compra(id),
  insumo_id uuid references public.insumos(id),
  produto text not null, quantidade numeric(14,3), unidade text,
  valor_unitario numeric(14,4), quantidade_realizada numeric(14,3), valor_total numeric(14,2), obs text
);

-- ---------------------------------------------------------------- colaboradores
create table public.colaboradores (
  id uuid primary key default gen_random_uuid(),
  nome text not null, funcao text, telefone text,
  situacao text not null default 'Ativo' check (situacao in ('Ativo','Afastado','Desligado')),
  admissao date, perfil_id uuid references public.perfis(id), obs text,
  arquivado boolean not null default false,
  criado_por uuid default auth.uid() references public.perfis(id),
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------- acesso
do $$
declare t text;
begin
  -- leitura para qualquer usuário ativo; escrita de cadastro/planos para gestor
  foreach t in array array['rebanho_mensal','ocorrencias','maquinas','manutencoes','insumos','servicos','servico_itens',
                           'insumo_movimentos','formulas','formula_itens','plano_nutricional'] loop
    execute format('alter table public.%1$s enable row level security', t);
    execute format('create policy ler_%1$s on public.%1$s for select to authenticated using (public.usuario_ativo())', t);
    execute format('create policy gestor_ins_%1$s on public.%1$s for insert to authenticated with check (public.eh_gestor())', t);
    execute format('create policy gestor_upd_%1$s on public.%1$s for update to authenticated using (public.eh_gestor()) with check (public.eh_gestor())', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.registrar_auditoria()', t);
  end loop;
  -- só gestor vê (valores de compra e dados pessoais)
  foreach t in array array['pedidos_compra','pedido_itens','colaboradores'] loop
    execute format('alter table public.%1$s enable row level security', t);
    execute format('create policy gestor_sel_%1$s on public.%1$s for select to authenticated using (public.eh_gestor())', t);
    execute format('create policy gestor_ins_%1$s on public.%1$s for insert to authenticated with check (public.eh_gestor())', t);
    execute format('create policy gestor_upd_%1$s on public.%1$s for update to authenticated using (public.eh_gestor()) with check (public.eh_gestor())', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.registrar_auditoria()', t);
  end loop;
end $$;

-- lançamentos de campo que o operador pode fazer
create policy campo_ins_ocorrencias on public.ocorrencias for insert to authenticated with check (public.usuario_ativo());
create policy campo_ins_manutencoes on public.manutencoes for insert to authenticated with check (public.usuario_ativo());
create policy campo_ins_movimentos  on public.insumo_movimentos for insert to authenticated
  with check (public.usuario_ativo() and (public.eh_gestor() or tipo = 'Saída'));
-- responsável pode atualizar o andamento do serviço
create policy resp_upd_servicos on public.servicos for update to authenticated
  using (public.usuario_ativo() and responsavel_id = auth.uid()) with check (public.usuario_ativo() and responsavel_id = auth.uid());
