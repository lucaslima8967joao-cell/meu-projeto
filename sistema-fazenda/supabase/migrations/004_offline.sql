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
