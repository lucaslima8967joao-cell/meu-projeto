-- Assistente: aceita a chave com espaços ou com o prefixo "Bearer" (colada de formas diferentes).
create or replace function public.assistente_executar(p_acao text, p_dados jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_token text := btrim(regexp_replace(coalesce(nullif(current_setting('request.headers', true), '')::json->>'x-assistente-token', ''), '^\s*(bearer\s+)?', '', 'i'));
  v_chave uuid; v_tab text; v_cols text; v_ids jsonb; v_res jsonb;
  grava constant text[] := array['servicos','servico_itens','insumo_movimentos','insumos','manutencoes','maquinas','pesagens',
    'movimentacoes','ocorrencias','reproducao','tarefas','cantina_movimentos','lotes'];
  altera constant text[] := array['servicos','tarefas','maquinas','animais','insumos'];
begin
  select id into v_chave from public.assistente_chaves
   where ativo and hash = encode(digest(v_token, 'sha256'), 'hex') and length(v_token) >= 32;
  if v_chave is null then raise exception 'Chave do assistente inválida ou desligada.'; end if;
  update public.assistente_chaves set ultimo_uso = now() where id = v_chave;
  perform set_config('app.ator', public.id_assistente()::text, true);

  if p_acao = 'contexto' then
    -- tudo o que o assistente precisa para entender as mensagens
    return jsonb_build_object(
      'hoje', current_date,
      'fazendas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome)), '[]') from fazendas where not arquivado),
      'pastos', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'codigo_antigo', codigo_antigo, 'tipo', tipo, 'area_ha', area_ha) order by codigo), '[]') from pastos where not arquivado),
      'lotes', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'pasto_id', pasto_id)), '[]') from lotes where not arquivado),
      'insumos', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'unidade', unidade, 'categoria', categoria, 'saldo', saldo)), '[]') from v_insumos where not arquivado),
      'maquinas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'patrimonio', patrimonio, 'tipo', tipo, 'unidade_uso', unidade_uso, 'uso_atual', uso_atual)), '[]') from maquinas where not arquivado),
      'colaboradores', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'funcao', funcao)), '[]') from colaboradores where not arquivado and situacao = 'Ativo'),
      'cantina_produtos', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'preco_venda', preco_venda)), '[]') from cantina_produtos where ativo),
      'tarefas_abertas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'titulo', titulo, 'data', data, 'status', status, 'categoria', categoria) order by data), '[]')
                          from tarefas where not arquivado and status <> 'concluida' and data between current_date - 30 and current_date + 30),
      'servicos_abertos', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'titulo', titulo, 'tipo', tipo, 'local_texto', local_texto, 'status', status)), '[]')
                          from servicos where not arquivado and status in ('Planejado','Em andamento')),
      'animais_ativos', (select count(*) from animais where situacao = 'ativo' and not arquivado));

  elsif p_acao = 'buscar_animal' then
    return (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from (
      select id, controle, chip, brinco, sexo, categoria_atual, pasto_codigo, situacao from v_animais
       where not arquivado and (lower(controle) = lower(p_dados->>'numero') or lower(chip) = lower(p_dados->>'numero')
              or lower(brinco) = lower(p_dados->>'numero') or (length(p_dados->>'numero') >= 4 and chip like '%' || (p_dados->>'numero')))
       limit 20) v);

  elsif p_acao = 'inserir' then
    v_tab := p_dados->>'tabela';
    if not (v_tab = any(grava)) then raise exception 'O assistente não pode gravar em %.', v_tab; end if;
    -- só as colunas enviadas (as demais usam o padrão do banco)
    select string_agg(format('%I', k), ', ') into v_cols
      from (select distinct jsonb_object_keys(x) k from jsonb_array_elements(p_dados->'linhas') x) c
     where k not in ('criado_por');
    execute format('with ins as (insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) returning id) select jsonb_agg(id) from ins', v_tab, v_cols)
      into v_ids using p_dados->'linhas';
    return jsonb_build_object('tabela', v_tab, 'ids', v_ids);

  elsif p_acao = 'atualizar' then
    v_tab := p_dados->>'tabela';
    if not (v_tab = any(altera)) then raise exception 'O assistente não pode alterar %.', v_tab; end if;
    select string_agg(format('%1$I = r.%1$I', k), ', ') into v_cols from jsonb_object_keys(p_dados->'campos') k where k not in ('id','criado_por','criado_em');
    execute format('update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I, $1) r where t.id = $2 returning to_jsonb(t)', v_tab, v_cols)
      into v_res using p_dados->'campos', (p_dados->>'id')::uuid;
    if v_res is null then raise exception 'Registro não encontrado em %.', v_tab; end if;
    return v_res;

  elsif p_acao = 'nascimento' then
    return to_jsonb(public.registrar_nascimento((p_dados->>'fazenda_id')::uuid, (p_dados->>'mae_id')::uuid, null, p_dados->>'pai',
      (p_dados->>'data')::date, p_dados->>'sexo', coalesce(p_dados->>'raca','NEL'), (p_dados->>'peso')::numeric,
      p_dados->>'controle', p_dados->>'chip', p_dados->>'brinco', p_dados->>'obs', null));
  end if;
  raise exception 'Ação desconhecida: %', p_acao;
end $$;

revoke all on function public.assistente_executar(text, jsonb) from public;
grant execute on function public.assistente_executar(text, jsonb) to anon, authenticated;
