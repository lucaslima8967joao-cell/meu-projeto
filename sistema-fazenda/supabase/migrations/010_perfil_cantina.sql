-- =====================================================================
-- Perfil "cantina": cuida só do mercadinho dos funcionários.
--   * cadastra produtos e preços, vende, faz entrada/contagem/perda
--   * vê as contas da cantina de todos (não fecha o mês: isso é do gestor)
--   * NÃO vê nem lança nada fora da cantina (rebanho, vendas de gado,
--     áreas, estoque da fazenda, máquinas, colaboradores…)
-- =====================================================================

alter table public.perfis drop constraint if exists perfis_papel_check;
alter table public.perfis add constraint perfis_papel_check check (papel in ('admin','gerente','operador','cantina'));

-- "usuário ativo da fazenda" deixa de incluir o perfil cantina
create or replace function public.usuario_ativo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ativo and papel <> 'cantina' from public.perfis where id = auth.uid()), false)
$$;

-- qualquer usuário ativo (inclusive cantina) — usado só nas tabelas da cantina
create or replace function public.pode_cantina() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ativo from public.perfis where id = auth.uid()), false)
$$;

create or replace function public.eh_cantina() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.papel_atual() = 'cantina', false)
$$;

-- o próprio perfil continua visível para quem é da cantina
drop policy if exists perfis_ler_proprio on public.perfis;
create policy perfis_ler_proprio on public.perfis for select to authenticated
  using (id = auth.uid() or public.usuario_ativo());

-- ---------------------------------------------------------------- cantina
create or replace function public.colaboradores_para_cantina()
returns table (id uuid, nome text, funcao text)
language sql stable security definer set search_path = public as $$
  select c.id, c.nome, c.funcao from public.colaboradores c
  where public.pode_cantina() and not c.arquivado and c.situacao = 'Ativo'
  order by c.nome
$$;

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
where public.pode_cantina();

drop policy if exists ler_cantina_produtos on public.cantina_produtos;
drop policy if exists gestor_ins_cantina_produtos on public.cantina_produtos;
drop policy if exists gestor_upd_cantina_produtos on public.cantina_produtos;
create policy ler_cantina_produtos on public.cantina_produtos for select to authenticated using (public.pode_cantina());
create policy cantina_ins_produtos on public.cantina_produtos for insert to authenticated with check (public.eh_gestor() or public.eh_cantina());
create policy cantina_upd_produtos on public.cantina_produtos for update to authenticated using (public.eh_gestor() or public.eh_cantina()) with check (public.eh_gestor() or public.eh_cantina());

drop policy if exists ler_cantina_mov on public.cantina_movimentos;
drop policy if exists ins_cantina_mov on public.cantina_movimentos;
create policy ler_cantina_mov on public.cantina_movimentos for select to authenticated
  using (public.eh_gestor() or public.eh_cantina()
         or (public.usuario_ativo() and (criado_por = auth.uid() or colaborador_id = public.meu_colaborador() or tipo in ('Entrada','Inventário','Perda'))));
create policy ins_cantina_mov on public.cantina_movimentos for insert to authenticated with check (public.pode_cantina());

drop policy if exists ler_cantina_fech on public.cantina_fechamentos;
create policy ler_cantina_fech on public.cantina_fechamentos for select to authenticated
  using (public.eh_gestor() or public.eh_cantina() or (public.usuario_ativo() and colaborador_id = public.meu_colaborador()));
