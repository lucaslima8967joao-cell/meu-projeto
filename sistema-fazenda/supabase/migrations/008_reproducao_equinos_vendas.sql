-- =====================================================================
-- Etapa 3 — reprodução individual, cavalos (espécie) e lançamento de
-- vendas pelo sistema. Não apaga nada.
-- =====================================================================

-- ---------------------------------------------------------------- espécie e uso (cavalos)
alter table public.animais add column if not exists especie text not null default 'Bovino'
  check (especie in ('Bovino','Equino'));
alter table public.animais add column if not exists uso text;   -- cavalos: serviço, reprodução, aposentado…

-- ---------------------------------------------------------------- reprodução
create table public.reproducao (
  id uuid primary key default gen_random_uuid(),
  animal_id uuid not null references public.animais(id),
  data date not null check (data <= current_date),
  tipo text not null check (tipo in ('Cobertura','Inseminação','Diagnóstico de prenhez','Parto','Aborto','Vacinação','Tratamento','Outro')),
  resultado text check (resultado is null or resultado in ('Prenhe','Vazia')),
  touro_semen text, protocolo text, produto text, responsavel_texto text, obs text,
  criado_por uuid default auth.uid() references public.perfis(id),
  criado_em timestamptz not null default now(), lancado_em timestamptz
);
create index ix_reproducao_animal on public.reproducao (animal_id, data desc);
alter table public.reproducao enable row level security;
create policy ler_reproducao on public.reproducao for select to authenticated using (public.usuario_ativo());
create policy campo_ins_reproducao on public.reproducao for insert to authenticated with check (public.usuario_ativo());
create policy gestor_upd_reproducao on public.reproducao for update to authenticated using (public.eh_gestor()) with check (public.eh_gestor());
create trigger trg_audit_reproducao after insert or update or delete on public.reproducao
  for each row execute function public.registrar_auditoria();

-- ---------------------------------------------------------------- visão de animais (recriada com espécie, uso e reprodução)
drop view if exists public.v_animais;
create view public.v_animais with (security_invoker = true) as
select a.*,
       coalesce(case when a.especie = 'Bovino' then public.categoria_idade(a.sexo, a.nascimento, a.touro) end, a.categoria) as categoria_atual,
       f.nome  as fazenda_nome,
       l.nome  as lote_nome,
       p.codigo as pasto_codigo,
       m.controle as mae_controle,
       up.peso_kg as ultimo_peso_kg,
       up.data    as ultima_pesagem,
       case when a.nascimento is null then null
            else (extract(year from age(current_date, a.nascimento)) * 12
                + extract(month from age(current_date, a.nascimento)))::int end as idade_meses,
       ur.data as ultimo_evento_repro, ur.tipo as ultimo_evento_tipo, ur.resultado as ultimo_diagnostico
from public.animais a
join public.fazendas f on f.id = a.fazenda_id
left join public.lotes l on l.id = a.lote_id
left join public.pastos p on p.id = a.pasto_id
left join public.animais m on m.id = a.mae_id
left join lateral (select peso_kg, data from public.pesagens pe
                    where pe.animal_id = a.id order by data desc, criado_em desc limit 1) up on true
left join lateral (select data, tipo, resultado from public.reproducao r
                    where r.animal_id = a.id order by data desc, criado_em desc limit 1) ur on true;

-- ---------------------------------------------------------------- lançar venda (cabeçalho + animais) de uma vez
-- p_itens: [{"controle":"7444","chip":"","peso_kg":310,"raca":"NEL","nascimento":"2025-10-17"}, …]
-- Se o número bater com um animal ATIVO cadastrado, ele é ligado à venda e passa a "vendido".
create or replace function public.registrar_venda(p_venda jsonb, p_itens jsonb, p_id uuid default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); it jsonb; v_animal uuid; n int := 0;
begin
  if not public.eh_gestor() then raise exception 'Somente administrador ou gerente lança vendas.'; end if;
  if exists (select 1 from public.vendas where id = v_id) then return v_id; end if;  -- reenvio
  insert into public.vendas (id, fazenda_id, data, comprador, notas_fiscais, sexo, categoria, quantidade,
                             peso_balanca_kg, peso_frigorifico_kg, rendimento_pct, media_arroba, valor_arroba, valor_total, forma_pagamento, obs, origem)
  values (v_id, (p_venda->>'fazenda_id')::uuid, (p_venda->>'data')::date, p_venda->>'comprador', nullif(p_venda->>'notas_fiscais',''),
          nullif(p_venda->>'sexo',''), nullif(p_venda->>'categoria',''), (p_venda->>'quantidade')::int,
          (p_venda->>'peso_balanca_kg')::numeric, (p_venda->>'peso_frigorifico_kg')::numeric, (p_venda->>'rendimento_pct')::numeric,
          (p_venda->>'media_arroba')::numeric, (p_venda->>'valor_arroba')::numeric, (p_venda->>'valor_total')::numeric,
          nullif(p_venda->>'forma_pagamento',''), nullif(p_venda->>'obs',''), 'Lançado no sistema');
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    n := n + 1;
    select id into v_animal from public.animais a
     where a.situacao = 'ativo' and not a.arquivado
       and ((nullif(it->>'chip','') is not null and lower(trim(a.chip)) = lower(trim(it->>'chip')))
         or (nullif(it->>'controle','') is not null and lower(trim(a.controle)) = lower(trim(it->>'controle'))))
     limit 1;
    insert into public.venda_itens (venda_id, ordem, animal_id, controle, chip, peso_kg, raca, nascimento, obs)
    values (v_id, n, v_animal, nullif(it->>'controle',''), nullif(it->>'chip',''), (it->>'peso_kg')::numeric,
            nullif(it->>'raca',''), (it->>'nascimento')::date, nullif(it->>'obs',''));
    v_animal := null;
  end loop;
  return v_id;
end $$;
