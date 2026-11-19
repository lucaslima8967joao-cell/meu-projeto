"""Gera supabase/migrations/007_importacao_planos.sql a partir das planilhas da Fazenda 2.

Uso: python3 -I importacao/gerar_sql_planos.py <IATF.xlsx> <Rel1026.xlsx> <Plano_Pastagens.xlsx> <Nutricao.xlsx> <Programa_Cercas.docx> <saida.sql>

Copia os dados como estão. Não inventa valores: o que a planilha não tem fica em branco.
"""
import sys, re, zipfile, datetime, warnings
import openpyxl
warnings.filterwarnings('ignore')

def q(v):
    if v is None or v == '':
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(round(float(v), 4))
    if isinstance(v, datetime.date):
        return f"'{v.isoformat()}'"
    return "'" + str(v).replace("'", "''").strip() + "'"

FZ = "(select id from public.fazendas where nome = 'Santa Adriana II')"
PASTO = "(select id from public.pastos where codigo = {c} and fazenda_id = " + FZ + ")"
out = []

# ------------------------------------------------------------------ IATF -> tarefas
def iatf(caminho):
    MES = {'OUTUBRO': (2026, 10), 'NOVEMBRO': (2026, 11), 'DEZEMBRO': (2026, 12), 'JANEIRO': (2027, 1), 'FEVEREIRO': (2027, 2)}
    wb = openpyxl.load_workbook(caminho, data_only=True)
    n = 0
    for ws in wb.worksheets:
        ano, mes = MES[ws.title.strip().upper()]
        dias = {}
        for r in range(3, ws.max_row + 1):
            vals = {c: ws.cell(r, c).value for c in range(1, 8)}
            nums = {c: v for c, v in vals.items() if isinstance(v, int) and 1 <= v <= 31}
            txt = {c: v for c, v in vals.items() if isinstance(v, str) and v.strip()}
            if nums and not txt:
                dias = nums
                continue
            for c, v in txt.items():
                d = dias.get(c)
                if not d:
                    continue
                data = datetime.date(ano, mes, d)
                assert data.isoweekday() % 7 == c - 1, (ws.title, r, c)
                titulo = 'IATF · ' + ' '.join(v.split())
                out.append("insert into public.tarefas (titulo, descricao, data, prioridade, categoria, local_texto) values "
                           f"({q(titulo)}, {q('Programação IATF (planilha IATF - PROGRAMAÇÃO, aba ' + ws.title + ')')}, {q(data)}, 'alta', 'IATF', null);")
                n += 1
    return n

# ------------------------------------------------------------------ Relatório mensal + mortes
COLS = ['estoque_anterior', 'nascimento', 'compra', 'transf_entrada', 'mudanca_menos', 'mudanca_mais',
        'venda', 'ajuste_inventario', 'morte', 'abate', 'estoque_atual']

def data_excel(v):
    if isinstance(v, datetime.datetime): return v.date()
    if isinstance(v, (int, float)): return datetime.date(1899, 12, 30) + datetime.timedelta(days=int(v))
    return None

def rebanho(caminho):
    wb = openpyxl.load_workbook(caminho, data_only=True)
    ws = wb['Fazenda 2 - Sta Adriana']
    dia = data_excel(ws['L1'].value) or data_excel(ws['K1'].value) or data_excel(ws['M1'].value)
    if not dia:
        for row in ws.iter_rows(min_row=1, max_row=2):
            for c in row:
                if data_excel(c.value) and not isinstance(c.value, str): dia = data_excel(c.value)
    mes = dia.replace(day=1)
    grupo, ordem, n = None, 0, 0
    for r in range(6, ws.max_row + 1):
        rot = ws.cell(r, 1).value
        if not isinstance(rot, str):
            continue
        t = ' '.join(rot.split())
        tu = t.upper()
        if tu in ('FÊMEAS', 'FEMEAS'): grupo = 'Fêmeas'; continue
        if tu == 'MACHOS': grupo = 'Machos'; continue
        if tu == 'EQUINOS': grupo = 'Equinos'; continue
        if 'TOTAL' in tu.replace(' ', '') or tu in ('BOVINOS',) or grupo is None:
            continue
        valores = [ws.cell(r, c).value for c in range(2, 13)]
        nums = [int(v) if isinstance(v, (int, float)) else 0 for v in valores]
        ordem += 1
        cats = ', '.join(COLS)
        out.append(f"insert into public.rebanho_mensal (fazenda_id, mes, grupo, categoria, ordem, {cats}, origem) values "
                   f"({FZ}, {q(mes)}, {q(grupo)}, {q(t.capitalize())}, {ordem}, "
                   + ', '.join(str(x) for x in nums) + ", 'Rel1026.xlsx / aba Fazenda 2 - Sta Adriana') on conflict do nothing;")
        n += 1
    # mortes da aba Movimento
    wm = wb['Movimento Sta Adriana']
    mortes = 0
    for r in range(8, 21):
        num = wm.cell(r, 3).value
        if num in (None, ''):
            continue
        out.append("insert into public.ocorrencias (fazenda_id, data, tipo, numero, sexo, chip, idade_texto, causa, obs, origem) values "
                   f"({FZ}, {q(dia)}, 'Morte', {q(str(num))}, {q(wm.cell(r, 4).value)}, {q(None if wm.cell(r, 5).value is None else str(wm.cell(r, 5).value))}, "
                   f"{q(wm.cell(r, 6).value)}, {q(str(wm.cell(r, 7).value or '').capitalize())}, "
                   f"'Data exata não informada; registrado no relatório de {dia.strftime('%m/%Y')}.', 'Rel1026.xlsx / aba Movimento Sta Adriana');")
        mortes += 1
    return n, mortes, mes

# ------------------------------------------------------------------ Insumos
INSUMOS = {}
def insumo(nome, unidade, categoria):
    nome = ' '.join(nome.split())
    if nome not in INSUMOS:
        INSUMOS[nome] = (unidade, categoria)
        out.append(f"insert into public.insumos (nome, unidade, categoria) values ({q(nome)}, {q(unidade)}, {q(categoria)}) on conflict (nome) do nothing;")
    return f"(select id from public.insumos where nome = {q(nome)})"

def unidade_de(u):
    u = (u or '').strip().lower()
    return {'ton': 't', 'litros': 'L', 'lt': 'L', 'kg': 'kg'}.get(u, u or None)

def cat_de(nome):
    n = nome.lower()
    if 'calc' in n or 'adubo' in n or 'map' in n: return 'Adubo/Corretivo'
    if 'herb' in n or 'tordon' in n or 'dominum' in n or 'adjuvante' in n or 'tucson' in n or 'imaz' in n: return 'Defensivo'
    if 'semente' in n: return 'Semente'
    return 'Outro'

# ------------------------------------------------------------------ Plano de pastagens
def pastagens(caminho):
    wb = openpyxl.load_workbook(caminho, data_only=True)
    ws = wb['2026.27 - final']
    safra = '2026/27'
    n = 0
    for bloco, linha_prod, linha_unid, ini, tipo in (('MANUTENÇÃO', 5, 6, 7, 'Manutenção de pasto'), ('REFORMA', 22, 23, 24, 'Reforma de pasto')):
        produtos = {}
        for c in range(4, 20, 2):
            nome = ws.cell(linha_prod, c).value
            if nome:
                und = ws.cell(linha_unid, c).value or ''
                m = re.search(r'\((\w+)\)', und)
                produtos[c] = (' '.join(str(nome).split()), m.group(1) if m else None)
        r = ini
        while isinstance(ws.cell(r, 1).value, int):
            prio, pasto, area = ws.cell(r, 1).value, ws.cell(r, 2).value, ws.cell(r, 3).value
            sid = f"(select id from public.servicos where origem = {q(f'Plano_Pastagens_2026.27 / {bloco} / {pasto} / linha {r}')})"
            out.append("insert into public.servicos (fazenda_id, tipo, titulo, safra, prioridade, pasto_id, local_texto, area_ha, status, origem) values "
                       f"({FZ}, {q(tipo)}, {q(f'{tipo} {pasto}')}, {q(safra)}, {prio}, {PASTO.format(c=q(pasto))}, {q(pasto)}, {q(area)}, 'Planejado', "
                       f"{q(f'Plano_Pastagens_2026.27 / {bloco} / {pasto} / linha {r}')});")
            for c, (prod, und_dose) in produtos.items():
                dose, total = ws.cell(r, c).value, ws.cell(r, c + 1).value
                if not isinstance(dose, (int, float)) or not dose:
                    continue
                und_total = {'Ton': 't', 'ton': 't', 'Lt': 'L', 'Kg': 'kg'}.get(und_dose or '', und_dose)
                ins = insumo(prod, und_total or 'un', cat_de(prod))
                out.append("insert into public.servico_itens (servico_id, insumo_id, produto, dose, unidade_dose, quantidade, unidade) values "
                           f"({sid}, {ins}, {q(prod)}, {q(dose)}, {q((und_total or '') + '/ha')}, {q(total)}, {q(und_total)});")
            n += 1
            r += 1
    # resumo de compras (previsto x realizado)
    pid = "(select id from public.pedidos_compra where origem = 'Plano_Pastagens_2026.27 / RESUMO')"
    out.append("insert into public.pedidos_compra (data, titulo, safra, status, obs, origem) values "
               f"({q(data_excel(ws['U1'].value))}, 'Insumos do Plano de Pastagens 2026/27', '2026/27', 'Comprado', "
               "'Quantidade prevista e valor unitário conforme o resumo da planilha; quantidade e valor realizados conforme coluna REALIZADO.', "
               "'Plano_Pastagens_2026.27 / RESUMO');")
    for r in range(35, 44):
        prod = ws.cell(r, 17).value
        if not prod:
            continue
        prod = ' '.join(str(prod).split())
        und = unidade_de(ws.cell(r, 20).value)
        ins = insumo(prod, und or 'un', cat_de(prod))
        out.append("insert into public.pedido_itens (pedido_id, insumo_id, produto, quantidade, unidade, valor_unitario, quantidade_realizada, valor_total) values "
                   f"({pid}, {ins}, {q(prod)}, {q(ws.cell(r, 19).value)}, {q(und)}, {q(ws.cell(r, 21).value)}, {q(ws.cell(r, 22).value)}, {q(ws.cell(r, 23).value)});")
    return n

# ------------------------------------------------------------------ Nutrição
MESES = ['JAN', 'FEV', 'MAR', 'ABRIL', 'MAIO', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']
def nutricao(caminho):
    ws = openpyxl.load_workbook(caminho, data_only=True)['CALENDARIO 2026']
    nomes = {'MILHO': 'Milho', 'RESIDUO SOJA BOM': 'Resíduo de soja', 'RESIDUO DE SOJA BOM': 'Resíduo de soja',
             'NUCLEO CONNAN MULT': 'Núcleo Connan Mult', 'UREIA': 'Ureia', 'SAL BRANCO': 'Sal branco'}
    formulas = {}
    for r in range(60, ws.max_row + 1):
        a = ws.cell(r, 1).value
        if isinstance(a, str) and a.strip().upper() in ('PROTEINADO AGUAS', 'PROTEINADO SECA', 'RAÇÃO ENGORDA'):
            fnome = {'PROTEINADO AGUAS': 'Proteinado águas', 'PROTEINADO SECA': 'Proteinado seca', 'RAÇÃO ENGORDA': 'Ração engorda'}[a.strip().upper()]
            formulas[a.strip().upper()] = fnome
            out.append(f"insert into public.formulas (nome, descricao, origem) values ({q(fnome)}, 'Fórmula da planilha Nutrição Connan 10.2026', 'Nutrição Connan 10.2026 F2') on conflict (nome) do nothing;")
            k = r + 1
            while ws.cell(k, 2).value:
                nome = nomes.get(' '.join(str(ws.cell(k, 2).value).split()).upper(), str(ws.cell(k, 2).value).title())
                ins = insumo(nome, 'kg', 'Nutrição')
                out.append(f"insert into public.formula_itens (formula_id, insumo_id, percentual) values ((select id from public.formulas where nome = {q(fnome)}), {ins}, {q(ws.cell(k, 3).value)});")
                k += 1
    # plano mensal: suplemento (linha 11-16), dias (31-36), consumo (41-46), previsto kg (61-66)
    n = 0
    for i in range(6):
        cat, lote, anim = ws.cell(11 + i, 1).value, ws.cell(11 + i, 2).value, ws.cell(11 + i, 3).value
        for m in range(12):
            col = 4 + m
            prev = ws.cell(61 + i, col).value
            if not isinstance(prev, (int, float)) or not prev:
                continue
            sup = ws.cell(11 + i, col).value
            # suplemento vigente: último texto à esquerda na linha do calendário
            if not sup:
                for cc in range(col, 3, -1):
                    if ws.cell(11 + i, cc).value: sup = ws.cell(11 + i, cc).value; break
            sup_txt = ' '.join(str(sup).split()) if sup else None
            fnome = None
            if sup_txt:
                if 'RAÇÃO' in sup_txt.upper(): fnome = 'Ração engorda'
                elif 'SECA' in sup_txt.upper() and 'AGUAS' not in sup_txt.upper(): fnome = 'Proteinado seca'
                elif 'AGUAS' in sup_txt.upper() and 'SECA' not in sup_txt.upper(): fnome = 'Proteinado águas'
            f_sql = f"(select id from public.formulas where nome = {q(fnome)})" if fnome else 'null'
            out.append("insert into public.plano_nutricional (ano, mes, categoria, lote, n_animais, formula_id, suplemento_texto, consumo_kg_cab_dia, dias, previsto_kg, origem) values "
                       f"(2026, {m + 1}, {q(' '.join(str(cat).split()))}, {q(' '.join(str(lote).split()))}, {q(anim)}, {f_sql}, {q(sup_txt)}, "
                       f"{q(ws.cell(41 + i, col).value)}, {q(ws.cell(31 + i, col).value)}, {q(prev)}, 'Nutrição Connan 10.2026 F2 / CALENDARIO 2026');")
            n += 1
    # estoque informado em 25/08 (referência, não vira saldo)
    ref = []
    for r in range(98, 105):
        nome, est = ws.cell(r, 2).value, ws.cell(r, 17).value
        if nome and isinstance(est, (int, float)):
            ref.append(f"{nomes.get(' '.join(str(nome).split()).upper(), nome)}: {est:g} kg")
    if ref:
        out.append(f"update public.insumos set obs = 'Estoque informado na planilha de nutrição em 25/08: ' || {q('; '.join(ref))} where categoria = 'Nutrição';")
    return n

# ------------------------------------------------------------------ Programa de cercas (docx)
def cercas(caminho):
    xml = zipfile.ZipFile(caminho).read('word/document.xml').decode('utf8')
    pars = []
    for p in re.findall(r'<w:p[ >].*?</w:p>', xml, flags=re.S):
        t = ''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', p))
        t = ' '.join(t.replace('\xa0', ' ').split())
        if t: pars.append(t)
    data_doc = None
    for t in pars[:3]:
        m = re.search(r'(\d{2})/(\d{2})/(\d{4})', t)
        if m: data_doc = datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    def valor(t):
        m = re.search(r'R\$\s*([\d\.]+)(?:,(\d+))?', t)
        if not m: return None
        return float(m.group(1).replace('.', '') + ('.' + m.group(2) if m.group(2) else ''))
    n, atual, secao = 0, None, None
    itens = []
    def fechar():
        nonlocal atual, itens, n
        if not atual: return
        t = atual
        pastos = re.findall(r'\bP\d+[a-z]?\b', t['titulo'])
        metr = re.search(r'\(([\d\.]+)\s*mt', t['titulo'])
        tipo = 'Cerca' if secao == 'CERCAS' else 'Benfeitoria'
        orig = f"Programa Cercas 10.2026 F2 / {t['titulo']}"
        out.append("insert into public.servicos (fazenda_id, tipo, titulo, safra, pasto_id, local_texto, metragem_m, status, data_prevista, "
                   "custo_material_previsto, custo_mo_previsto, descricao, origem) values "
                   f"({FZ}, {q(tipo)}, {q(t['titulo'])}, null, {PASTO.format(c=q(pastos[0])) if pastos else 'null'}, "
                   f"{q(', '.join(pastos) if pastos else None)}, {q(float(metr.group(1).replace('.', '')) if metr else None)}, 'Planejado', null, "
                   f"{q(t.get('material'))}, {q(t.get('mo'))}, {q(chr(10).join(itens) if itens else None)}, {q(orig)});")
        n += 1
        atual, itens = None, []
    for t in pars:
        tu = t.upper()
        if tu.startswith('* CERCAS'): secao = 'CERCAS'; continue
        if tu.startswith('* BENFEITORIAS'): fechar(); secao = 'BENF'; continue
        if secao is None or t.startswith('*') or t.startswith('|') or tu.startswith('ESTOQUE FAZENDA') or tu.startswith('PREÇO MÉDIO'):
            if t.startswith('*') and secao: fechar()
            continue
        if re.match(r'^(Cerca|Divisa|\d+ Divis|Diversos|Porteiras|Curral|Remanga)', t):
            fechar(); atual = {'titulo': t}; continue
        if atual is None:
            continue
        if t.lower().startswith('total material'):
            atual['material'] = valor(t)
        elif t.startswith('M.O'):
            atual['mo'] = valor(t)
        else:
            if re.search(r'R\$', t) and 'material' not in atual and atual['titulo'].startswith('Porteiras'):
                atual['material'] = valor(t)
            itens.append(t)
    fechar()
    return n, data_doc

if __name__ == '__main__':
    a_iatf, a_rel, a_past, a_nut, a_cerca, saida = sys.argv[1:7]
    out.append('-- Importação dos planos da Fazenda 2 (gerado por importacao/gerar_sql_planos.py — não editar à mão)')
    out.append('begin;')
    out.append("do $$ begin if exists (select 1 from public.tarefas where categoria = 'IATF' and descricao like 'Programação IATF%') then "
               "raise exception 'Planos já importados antes. Nada foi alterado.'; end if; end $$;")
    n_iatf = iatf(a_iatf)
    n_reb, n_mortes, mes = rebanho(a_rel)
    n_serv = pastagens(a_past)
    n_nut = nutricao(a_nut)
    n_cerca, data_doc = cercas(a_cerca)
    out.append('commit;')
    open(saida, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
    print(f'IATF: {n_iatf} eventos | Rebanho {mes:%m/%Y}: {n_reb} categorias, {n_mortes} mortes | '
          f'Pastagens: {n_serv} serviços | Nutrição: {n_nut} linhas | Cercas/benfeitorias: {n_cerca} | Insumos: {len(INSUMOS)}')
