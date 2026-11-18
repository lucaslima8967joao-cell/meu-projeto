"""Gera supabase/migrations/003_importacao_fazenda2.sql a partir das planilhas originais.

Uso:  python3 -I importacao/gerar_sql.py <Áreas Faz. 2 ... .xlsx> <Vendas2026F2.xlsx> <saida.sql>

Regras: copia os dados como estão na planilha, sem inventar nada.
Dúvidas encontradas viram observação no próprio registro.
"""
import sys, datetime, re, collections, warnings
import openpyxl
warnings.filterwarnings('ignore')

def q(v):
    if v is None or v == '':
        return 'null'
    if isinstance(v, (int, float)):
        return repr(round(float(v), 4))
    return "'" + str(v).replace("'", "''").strip() + "'"

def data_excel(v):
    if isinstance(v, datetime.datetime): return v.date()
    if isinstance(v, datetime.date): return v
    if isinstance(v, (int, float)): return (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(v)))
    return None

def qd(v):
    d = data_excel(v)
    return f"'{d.isoformat()}'" if d else 'null'

TIPO = {'A': 'Agricultura', 'D': 'Desmatado/Sem definição', 'M': 'Reflorestamento/Mata', 'P': 'Pasto', 'RE': 'Eucalipto'}

def areas(caminho, out):
    ws = openpyxl.load_workbook(caminho, data_only=True)['2025.26']
    n = 0
    for r in range(7, ws.max_row + 1):
        cod = ws.cell(r, 1).value
        if not cod or str(cod).strip().lower().startswith('tota'):
            continue
        cod = str(cod).strip()
        prefixo = re.match(r'[A-Z]+', cod).group(0)
        v = {c: ws.cell(r, i).value for c, i in
             dict(antigo=2, total=3, refl=5, soja=6, semdef=7, boa=8, media=9, ruim=10, degr=11, chuva=12, seca=13, solo=17).items()}
        obs = []
        partes = sum(float(v[k] or 0) for k in ('refl', 'soja', 'semdef', 'boa', 'media', 'ruim', 'degr'))
        if v['total'] and partes and abs(partes - float(v['total'])) > 0.05:
            obs.append(f'Na planilha a soma dos usos ({partes:.2f} ha) difere do total ({float(v["total"]):.2f} ha).')
        if not partes:
            obs.append('Uso da área não informado na planilha 2025.26.')
        out.append(
            "insert into public.pastos (fazenda_id, codigo, codigo_antigo, tipo, area_ha, area_reflorest_ha, area_soja_ha, area_sem_def_ha, "
            "pasto_boa_ha, pasto_media_ha, pasto_ruim_ha, pasto_degradada_ha, lotacao_ua_chuva, lotacao_ua_seca, tipo_solo, obs) "
            f"select id, {q(cod)}, {q(None if v['antigo'] is None else str(v['antigo']))}, {q(TIPO.get(prefixo, 'Outro'))}, {q(v['total'])}, "
            f"{q(v['refl'])}, {q(v['soja'])}, {q(v['semdef'])}, {q(v['boa'])}, {q(v['media'])}, {q(v['ruim'])}, {q(v['degr'])}, "
            f"{q(v['chuva'])}, {q(v['seca'])}, {q(v['solo'])}, {q(' '.join(obs) or None)} from fz "
            "on conflict (fazenda_id, codigo) do nothing;")
        n += 1
    return n

ROTULOS = {'NFs': 'nfs', 'Peso Bal.': 'peso_bal', 'Peso Frig.': 'peso_frig', 'Média (@)': 'media_arroba',
           'Rendimento:': 'rend', 'Valor @': 'valor_arroba', 'Valor total': 'valor_total'}

def vendas(caminho, out, nome_arquivo):
    wb = openpyxl.load_workbook(caminho, data_only=True)
    total_itens, resumo = 0, []
    vistos_global = collections.defaultdict(list)
    planilhas = []
    for ws in wb.worksheets:
        itens = []
        for r in range(12, ws.max_row + 1):
            a, b = ws.cell(r, 1).value, ws.cell(r, 2).value
            if isinstance(a, int) and b not in (None, 0, ''):
                itens.append(dict(ordem=a, controle=str(int(b)) if isinstance(b, (int, float)) else str(b).strip(),
                                  chip=ws.cell(r, 3).value, peso=ws.cell(r, 4).value, raca=ws.cell(r, 5).value,
                                  nasc=ws.cell(r, 6).value))
        if not itens:
            continue  # aba "Venda" é o modelo em branco
        planilhas.append((ws, itens))
        for it in itens:
            vistos_global[it['controle']].append(ws.title)

    for ws, itens in planilhas:
        rot = {}
        for row in ws.iter_rows(min_row=max(1, ws.max_row - 30)):
            for c in row:
                if isinstance(c.value, str) and c.value.strip() in ROTULOS:
                    viz = ws.cell(c.row, c.column + 1).value
                    rot[ROTULOS[c.value.strip()]] = viz
        sexo = {'macho': 'M', 'fêmea': 'F', 'femea': 'F'}.get(str(ws['C7'].value or '').strip().lower())
        data = ws['F8'].value
        titulo_nf = ws.title.split('NF', 1)[1].strip() if 'NF' in ws.title else None
        nf_res = rot.get('nfs')
        if isinstance(nf_res, float) and nf_res.is_integer():
            nf_res = int(nf_res)
        if nf_res is not None:
            rot['nfs'] = str(nf_res)
        nfs = rot.get('nfs') or titulo_nf
        obs = []
        if rot.get('nfs') and titulo_nf and str(rot['nfs']).strip() != titulo_nf:
            obs.append(f'NF no nome da aba: "{titulo_nf}"; no resumo: "{rot["nfs"]}".')
        m = re.match(r'(\d{1,2})\.(\d{1,2})', ws.title)
        d = data_excel(data)
        if m and d and (int(m.group(1)), int(m.group(2))) != (d.day, d.month):
            obs.append(f'Nome da aba indica {m.group(1)}/{m.group(2)}, mas a data preenchida na planilha é {d.strftime("%d/%m/%Y")}.')
        if ws['C9'].value is not None and int(ws['C9'].value) != len(itens):
            obs.append(f'Quantidade no cabeçalho ({ws["C9"].value}) difere do nº de animais listados ({len(itens)}).')
        def num(k):
            v = rot.get(k)
            return v if isinstance(v, (int, float)) else None
        rend = num('rend')
        out.append(
            "with v as (insert into public.vendas (fazenda_id, data, comprador, notas_fiscais, sexo, categoria, quantidade, "
            "peso_balanca_kg, peso_frigorifico_kg, rendimento_pct, media_arroba, valor_arroba, valor_total, obs, origem) "
            f"select id, {qd(data)}, {q(ws['C6'].value)}, {q(nfs)}, {q(sexo)}, {q(ws['C8'].value)}, {q(ws['C9'].value)}, "
            f"{q(num('peso_bal'))}, {q(num('peso_frig'))}, {q(rend)}, {q(num('media_arroba'))}, {q(num('valor_arroba'))}, {q(num('valor_total'))}, "
            f"{q(' '.join(obs) or None)}, {q(f'Importado de {nome_arquivo} / aba {ws.title}')} from fz returning id)\n"
            "insert into public.venda_itens (venda_id, ordem, controle, chip, peso_kg, raca, nascimento, obs) values")
        linhas = []
        cont = collections.Counter(i['controle'] for i in itens)
        for it in itens:
            o = []
            if cont[it['controle']] > 1:
                o.append('Número repetido nesta venda (provável erro de digitação, conforme a fazenda).')
            outras = [t for t in vistos_global[it['controle']] if t != ws.title]
            if outras:
                o.append(f'Mesmo número aparece também na venda "{outras[0]}" (provável erro de digitação).')
            chip = None if it['chip'] in (None, '') else str(it['chip']).strip()
            linhas.append(f"  ((select id from v), {it['ordem']}, {q(it['controle'])}, {q(chip)}, "
                          f"{q(it['peso'] if isinstance(it['peso'], (int, float)) else None)}, {q(it['raca'])}, {qd(it['nasc'])}, {q(' '.join(o) or None)})")
        out.append(',\n'.join(linhas) + ';')
        total_itens += len(itens)
        resumo.append(f'{ws.title}: {len(itens)} animais')
    return total_itens, resumo

if __name__ == '__main__':
    arq_areas, arq_vendas, saida = sys.argv[1:4]
    out = ["-- Importação da Fazenda 2 (gerado por importacao/gerar_sql.py — não editar à mão)",
           "-- Rode UMA vez, depois do 001 e do 002. Se rodar de novo, as áreas não duplicam,",
           "-- mas as vendas sim: por isso há uma trava logo abaixo.",
           "do $$ begin if exists (select 1 from public.vendas where origem like 'Importado de %') then",
           "  raise exception 'Importação já foi feita antes. Nada foi alterado.'; end if; end $$;",
           "insert into public.fazendas (nome, municipio) values ('Santa Adriana II', 'Diamantino - MT') on conflict (nome) do nothing;",
           "create temp table fz on commit drop as select id from public.fazendas where nome = 'Santa Adriana II';"]
    out.insert(3, 'begin;')
    n_areas = areas(arq_areas, out)
    import os
    n_itens, resumo = vendas(arq_vendas, out, 'Vendas2026F2.xlsx')
    out.append('commit;')
    open(saida, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
    print(f'Áreas: {n_areas} | Vendas: {len(resumo)} | Animais vendidos: {n_itens}')
    print('\n'.join(resumo))
