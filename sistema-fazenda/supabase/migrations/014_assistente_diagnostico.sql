-- Diagnóstico da chave do Assistente: mostra só se o cabeçalho chega,
-- o tamanho e o começo da chave (nunca a chave inteira) e se ela bate
-- com alguma chave ativa. Não grava nem lê dados da fazenda.
create or replace function public.assistente_diagnostico() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  h json := nullif(current_setting('request.headers', true), '')::json;
  bruto text := coalesce(h->>'x-assistente-token', '');
  t text := btrim(regexp_replace(bruto, '^\s*(bearer\s+)?', '', 'i'));
begin
  return jsonb_build_object(
    'versao', 14,
    'cabecalhos', (select jsonb_agg(k order by k) from json_object_keys(coalesce(h, '{}'::json)) k),
    'tamanho_bruto', length(bruto),
    'tamanho', length(t),
    'comeco', left(t, 8),
    'chaves_ativas', (select count(*) from assistente_chaves where ativo),
    'bate', exists(select 1 from assistente_chaves where ativo and hash = encode(digest(t, 'sha256'), 'hex')),
    'bate_desligada', exists(select 1 from assistente_chaves where not ativo and hash = encode(digest(t, 'sha256'), 'hex')));
end $$;
revoke all on function public.assistente_diagnostico() from public;
grant execute on function public.assistente_diagnostico() to anon, authenticated;
