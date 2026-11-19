-- =====================================================================
-- Cantina (mercadinho dos funcionários)
--   * produtos com preço, custo e estoque
--   * vendas por funcionário (desconto em folha, dinheiro, Pix)
--   * fechamento mensal por funcionário
-- Privacidade: funcionário vê só a própria conta; quem lançou vê o que
-- lançou; administrador/gerente veem tudo. Nada é apagado.
-- =====================================================================

create table public.cantina_produtos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  unidade text not null default 'un',
  preco_venda numeric(12,2) not null check (preco_venda >= 0),
  custo numeric(12,2) check (custo is null or custo >= 0),
  estoque_minimo numeric(12,3),
  ativo boolean not null default true,
  criado_por uuid default auth.uid() references public.perfis(id),
  criado_em timestamptz not null default now()
);

create table public.cantina_movimentos (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.cantina_produtos(id),
  data date not null default current_date check (data <= current_date + 1),
  tipo text not null check (tipo in ('Venda','Entrada','Inventário','Perda')),
  quantidade numeric(12,3) not null check (quantidade >= 0),
  valor_unitario numeric(12,2),                     -- venda: preço cobrado; entrada: custo
  colaborador_id uuid references public.colaboradores(id),
  forma_pagamento text check (forma_pagamento is null or forma_pagamento in ('Desconto em folha','Dinheiro','Pix')),
  obs text,
  criado_por uuid default auth.uid() references public.perfis(id),
  criado_em timestamptz not null default now(), lancado_em timestamptz,
  check (tipo <> 'Venda' or (colaborador_id is not null and forma_pagamento is not null and valor_unitario is not null))
);
create index ix_cantina_mov on public.cantina_movimentos (colaborador_id, data);

create table public.cantina_fechamentos (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references public.colaboradores(id),
  mes date not null,                                -- dia 1 do mês
  total numeric(12,2) not null,
  status text not null default 'Descontado' check (status in ('Descontado','Pago','Perdoado')),
  obs text,
  criado_por uuid default auth.uid() references public.perfis(id),
  criado_em timestamptz not null default now(),
  unique (colaborador_id, mes)
);

-- Nomes dos colaboradores ativos para o caixa da cantina (sem telefone e demais dados pessoais)
create or replace function public.colaboradores_para_cantina()
returns table (id uuid, nome text, funcao text)
language sql stable security definer set search_path = public as $$
  select c.id, c.nome, c.funcao from public.colaboradores c
  where public.usuario_ativo() and not c.arquivado and c.situacao = 'Ativo'
  order by c.nome
$$;
grant execute on function public.colaboradores_para_cantina() to authenticated;

-- Quem é o colaborador ligado ao usuário logado
create or replace function public.meu_colaborador() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.colaboradores where perfil_id = auth.uid() and not arquivado limit 1
$$;

-- Saldo dos produtos (mesma regra do estoque: última contagem + entradas − vendas − perdas).
-- Calculado com TODAS as vendas (o saldo não é sigiloso); só usuários ativos enxergam.
create or replace view public.v_cantina_produtos as
with ult as (
  select distinct on (produto_id) produto_id, data, criado_em, quantidade
  from public.cantina_movimentos where tipo = 'Inventário' order by produto_id, data desc, criado_em desc
)
select p.*,
  coalesce(u.quantidade, 0) + coalesce((select sum(case when m.tipo = 'Entrada' then m.quantidade else -m.quantidade end)
     from public.cantina_movimentos m where m.produto_id = p.id and m.tipo <> 'Inventário'
       and (u.produto_id is null or (m.data, m.criado_em) > (u.data, u.criado_em))), 0) as saldo,
  u.data as data_inventario
from public.cantina_produtos p left join ult u on u.produto_id = p.id
where public.usuario_ativo();
grant select on public.v_cantina_produtos to authenticated;

-- ---------------------------------------------------------------- acesso
alter table public.cantina_produtos    enable row level security;
alter table public.cantina_movimentos  enable row level security;
alter table public.cantina_fechamentos enable row level security;

create policy ler_cantina_produtos on public.cantina_produtos for select to authenticated using (public.usuario_ativo());
create policy gestor_ins_cantina_produtos on public.cantina_produtos for insert to authenticated with check (public.eh_gestor());
create policy gestor_upd_cantina_produtos on public.cantina_produtos for update to authenticated using (public.eh_gestor()) with check (public.eh_gestor());

-- movimentos: gestor vê tudo; quem lançou vê o que lançou; funcionário vê as próprias compras
create policy ler_cantina_mov on public.cantina_movimentos for select to authenticated
  using (public.eh_gestor() or (public.usuario_ativo() and (criado_por = auth.uid() or colaborador_id = public.meu_colaborador()
         or tipo in ('Entrada','Inventário','Perda'))));
create policy ins_cantina_mov on public.cantina_movimentos for insert to authenticated with check (public.usuario_ativo());
create policy gestor_upd_cantina_mov on public.cantina_movimentos for update to authenticated using (public.eh_gestor()) with check (public.eh_gestor());

create policy ler_cantina_fech on public.cantina_fechamentos for select to authenticated
  using (public.eh_gestor() or (public.usuario_ativo() and colaborador_id = public.meu_colaborador()));
create policy gestor_ins_cantina_fech on public.cantina_fechamentos for insert to authenticated with check (public.eh_gestor());
create policy gestor_upd_cantina_fech on public.cantina_fechamentos for update to authenticated using (public.eh_gestor()) with check (public.eh_gestor());

create trigger trg_audit_cantina_produtos    after insert or update or delete on public.cantina_produtos    for each row execute function public.registrar_auditoria();
create trigger trg_audit_cantina_movimentos  after insert or update or delete on public.cantina_movimentos  for each row execute function public.registrar_auditoria();
create trigger trg_audit_cantina_fechamentos after insert or update or delete on public.cantina_fechamentos for each row execute function public.registrar_auditoria();
