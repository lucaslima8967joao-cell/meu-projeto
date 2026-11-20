// Banco "de mentira" que imita o Supabase (REST + login) em memória: guarda inserts/updates,
// aplica filtros e monta as visões usadas pelo app. Só para teste — dados fictícios.
const crypto = require('crypto');
const hoje = () => new Date().toISOString().slice(0, 10);
const T = {};               // tabelas
const tab = n => (T[n] = T[n] || []);
const novoId = () => crypto.randomUUID();
const ADMIN = '11111111-1111-1111-1111-111111111111';

function semente() {
  tab('perfis').push({ id: ADMIN, nome: 'Admin Teste', email: 'admin@teste.local', papel: 'admin', ativo: true },
    { id: '22222222-2222-2222-2222-222222222222', nome: 'Operador Teste', email: 'op@teste.local', papel: 'operador', ativo: false });
  tab('fazendas').push({ id: 'f1', nome: 'Santa Adriana II', arquivado: false });
  tab('pastos').push({ id: 'p1', fazenda_id: 'f1', codigo: 'P1', tipo: 'Pasto', area_ha: 80, arquivado: false, lotacao_ua_chuva: 1, lotacao_ua_seca: 0.5 },
    { id: 'p2', fazenda_id: 'f1', codigo: 'P10', tipo: 'Pasto', area_ha: 115, arquivado: false }, { id: 'p3', fazenda_id: 'f1', codigo: 'P2', tipo: 'Pasto', area_ha: 50, arquivado: false });
  tab('animais').push({ id: 'a1', fazenda_id: 'f1', controle: 'T-001', chip: 'CHIP1', sexo: 'F', raca: 'NEL', nascimento: '2021-01-10', situacao: 'ativo', arquivado: false, especie: 'Bovino', matriz: true, touro: false, pasto_id: 'p1' });
  tab('tarefas').push({ id: 't1', titulo: 'IATF · D0 TESTE', data: hoje(), prioridade: 'alta', status: 'pendente', categoria: 'IATF', arquivado: false, responsavel_id: ADMIN });
  tab('servicos').push({ id: 's1', fazenda_id: 'f1', tipo: 'Manutenção de pasto', titulo: 'Manutenção de pasto P1 (teste)', status: 'Planejado', prioridade: 1, local_texto: 'P1', area_ha: 80, arquivado: false, custo_material_previsto: 1000 });
  tab('servico_itens').push({ id: 'si1', servico_id: 's1', produto: 'Calcário (teste)', dose: 2, unidade_dose: 't/ha', quantidade: 160, unidade: 't' });
  tab('rebanho_mensal').push(...['Bezerras de 0 a 4 meses', 'Vacas acima de 36 meses'].map((c, i) => ({ id: 'r' + i, fazenda_id: 'f1', mes: '2026-10-01', grupo: 'Fêmeas', categoria: c, ordem: i + 1,
    estoque_anterior: 100, nascimento: 10, compra: 0, transf_entrada: 0, mudanca_menos: 0, mudanca_mais: 0, venda: 0, ajuste_inventario: 0, morte: 1, abate: 0, estoque_atual: 109 })));
  tab('insumos').push({ id: 'i1', nome: 'Milho (teste)', unidade: 'kg', categoria: 'Nutrição', arquivado: false }, { id: 'i2', nome: 'Diesel (teste)', unidade: 'L', categoria: 'Combustível', arquivado: false });
  tab('formulas').push({ id: 'fo1', nome: 'Proteinado (teste)' }); tab('formula_itens').push({ id: 'fi1', formula_id: 'fo1', insumo_id: 'i1', percentual: 0.5 });
  tab('plano_nutricional').push({ id: 'pn1', ano: 2026, mes: 11, categoria: 'VACAS', lote: 'PARIDAS', n_animais: 300, suplemento_texto: 'PROTEINADO', consumo_kg_cab_dia: 2, dias: 30, previsto_kg: 9000 });
  tab('pedidos_compra').push({ id: 'pc1', data: '2026-10-19', titulo: 'Pedido (teste)', status: 'Comprado', arquivado: false });
  tab('pedido_itens').push({ id: 'pi1', pedido_id: 'pc1', produto: 'Calcário (teste)', quantidade: 100, unidade: 't', valor_unitario: 132, quantidade_realizada: 100, valor_total: 13200 });
  tab('vendas').push({ id: 'v1', fazenda_id: 'f1', data: '2026-08-13', comprador: 'COMPRADOR TESTE', notas_fiscais: '1/2', sexo: 'M', categoria: 'Bezerro', quantidade: 2, peso_balanca_kg: 500, media_arroba: 8.33, valor_arroba: 465, valor_total: 7750, arquivado: false });
  tab('venda_itens').push({ id: 'vi1', venda_id: 'v1', ordem: 1, controle: '9001', peso_kg: 250, raca: 'NEL', nascimento: '2025-10-01' }, { id: 'vi2', venda_id: 'v1', ordem: 2, controle: '9002', peso_kg: 250, raca: 'NEL', nascimento: '2025-10-01' });
  tab('colaboradores').push({ id: 'c1', nome: 'JOAO TESTE', funcao: 'Vaqueiro', situacao: 'Ativo', arquivado: false, perfil_id: ADMIN });
  tab('cantina_produtos').push({ id: 'cp1', nome: 'Refrigerante (teste)', unidade: 'un', preco_venda: 12, custo: 8, ativo: true });
  tab('auditoria').push({ id: 1, tabela: 'animais', acao: 'INSERT', em: new Date().toISOString(), usuario_id: ADMIN, antes: null, depois: { controle: 'T-001' } });
}

// ------------------------------------------------------------------ visões calculadas
const idadeMeses = n => { if (!n) return null; const a = new Date(n), b = new Date(); return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() - (b.getDate() < a.getDate() ? 1 : 0) };
function categoria(a) {
  if (a.especie === 'Equino') return a.categoria; if (a.sexo === 'M' && a.touro) return 'Touro'; const m = idadeMeses(a.nascimento); if (m == null) return a.categoria;
  const F = a.sexo === 'F'; return m <= 4 ? (F ? 'Bezerra 0-4 m' : 'Bezerro 0-4 m') : m <= 12 ? (F ? 'Bezerra 5-12 m' : 'Bezerro 5-12 m') : m <= 24 ? (F ? 'Novilha 13-24 m' : 'Garrote 13-24 m') : m <= 36 ? (F ? 'Novilha 25-36 m' : 'Garrote 25-36 m') : (F ? 'Vaca acima de 36 m' : 'Boi acima de 36 m');
}
const ultimo = (lista, chave, id) => lista.filter(x => x[chave] === id).sort((x, y) => (y.data || '').localeCompare(x.data || '') || (y.criado_em || '').localeCompare(x.criado_em || ''))[0];
function saldo(movs, chaveId, id) {
  const ms = movs.filter(m => m[chaveId] === id).sort((x, y) => (x.data + x.criado_em).localeCompare(y.data + y.criado_em));
  let s = 0; ms.forEach(m => { s = m.tipo === 'Inventário' ? Number(m.quantidade) : m.tipo === 'Entrada' ? s + Number(m.quantidade) : s - Number(m.quantidade) }); return s;
}
const VISOES = {
  v_animais: () => tab('animais').map(a => { const p = ultimo(tab('pesagens'), 'animal_id', a.id), r = ultimo(tab('reproducao'), 'animal_id', a.id);
    return { ...a, categoria_atual: categoria(a), fazenda_nome: 'Santa Adriana II', lote_nome: tab('lotes').find(l => l.id === a.lote_id)?.nome || null, pasto_codigo: tab('pastos').find(x => x.id === a.pasto_id)?.codigo || null,
      mae_controle: tab('animais').find(m => m.id === a.mae_id)?.controle || null, ultimo_peso_kg: p?.peso_kg ?? null, ultima_pesagem: p?.data ?? null, idade_meses: idadeMeses(a.nascimento),
      ultimo_evento_repro: r?.data ?? null, ultimo_evento_tipo: r?.tipo ?? null, ultimo_diagnostico: r?.resultado ?? null } }),
  v_pastos: () => tab('pastos').map(p => ({ ...p, area_pasto_ha: 0, capacidade_ua: p.lotacao_ua_chuva != null ? Math.round(p.area_ha * ((p.lotacao_ua_chuva || 0) + (p.lotacao_ua_seca || 0)) / 2) : null,
    animais_agora: tab('animais').filter(a => a.pasto_id === p.id && a.situacao === 'ativo' && !a.arquivado).length })),
  v_insumos: () => tab('insumos').map(i => ({ ...i, saldo: saldo(tab('insumo_movimentos'), 'insumo_id', i.id), data_inventario: ultimo(tab('insumo_movimentos').filter(m => m.tipo === 'Inventário'), 'insumo_id', i.id)?.data ?? null,
    ultimo_movimento: ultimo(tab('insumo_movimentos'), 'insumo_id', i.id)?.data ?? null, proxima_validade: null })),
  v_maquinas: () => tab('maquinas').map(m => { const prox = m.revisao_a_cada ? Number(m.ultima_revisao_uso || 0) + Number(m.revisao_a_cada) : null;
    return { ...m, proxima_revisao: prox, situacao_revisao: prox == null ? 'Sem plano' : m.uso_atual >= prox ? 'Vencida' : m.uso_atual >= prox - m.revisao_a_cada * 0.1 ? 'Próxima' : 'Em dia' } }),
  v_cantina_produtos: () => tab('cantina_produtos').map(p => ({ ...p, saldo: saldo(tab('cantina_movimentos'), 'produto_id', p.id), data_inventario: ultimo(tab('cantina_movimentos').filter(m => m.tipo === 'Inventário'), 'produto_id', p.id)?.data ?? null })),
};
// relações embutidas usadas no app
function embutir(t, linhas) {
  const ins = id => { const i = tab('insumos').find(x => x.id === id); return i ? { nome: i.nome, unidade: i.unidade } : null };
  return linhas.map(r => {
    const x = { ...r };
    if (t === 'servicos') x.servico_itens = tab('servico_itens').filter(i => i.servico_id === r.id);
    if (t === 'pedidos_compra') x.pedido_itens = tab('pedido_itens').filter(i => i.pedido_id === r.id);
    if (t === 'formulas') x.formula_itens = tab('formula_itens').filter(i => i.formula_id === r.id).map(i => ({ ...i, insumos: ins(i.insumo_id) }));
    if (t === 'insumo_movimentos') x.insumos = ins(r.insumo_id);
    if (t === 'pesagens') { const a = tab('animais').find(a => a.id === r.animal_id); x.animais = a ? { controle: a.controle, chip: a.chip } : null }
    if (t === 'nascimentos') { const b = tab('animais').find(a => a.id === r.bezerro_id), m = tab('animais').find(a => a.id === r.mae_id); x.bezerro = b || null; x.mae = m ? { controle: m.controle, chip: m.chip } : null }
    if (t === 'movimentacoes') { x.origem = tab('pastos').find(p => p.id === r.pasto_origem_id) || null; x.destino = tab('pastos').find(p => p.id === r.pasto_destino_id) || null }
    return x;
  });
}
function filtrar(linhas, params) {
  let out = linhas;
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const [op, ...resto] = v.split('.'); const val = resto.join('.');
    const cmp = x => (x[k] === null || x[k] === undefined) ? null : String(x[k]);
    if (op === 'eq') out = out.filter(x => val === 'false' ? (x[k] === false || x[k] == null) : val === 'true' ? x[k] === true : cmp(x) === val);
    else if (op === 'neq') out = out.filter(x => cmp(x) !== val);
    else if (op === 'gte') out = out.filter(x => cmp(x) !== null && cmp(x) >= val);
    else if (op === 'lte') out = out.filter(x => cmp(x) !== null && cmp(x) <= val);
    else if (op === 'gt') out = out.filter(x => cmp(x) !== null && cmp(x) > val);
    else if (op === 'lt') out = out.filter(x => cmp(x) !== null && cmp(x) < val);
    else if (op === 'is' && val === 'null') out = out.filter(x => x[k] == null);
    else if (op === 'not' && val === 'is.null') out = out.filter(x => x[k] != null);
  }
  const off = Number(params.get('offset') || 0), lim = params.get('limit') ? Number(params.get('limit')) : 1e9;
  return out.slice(off, off + lim);
}
// ------------------------------------------------------------------ RPCs
const RPC = {
  registrar_nascimento: a => { const id = a.p_id || novoId(); if (!tab('animais').some(x => x.id === id)) {
    tab('animais').push({ id, fazenda_id: a.p_fazenda_id, controle: a.p_controle || null, chip: a.p_chip || null, brinco: a.p_brinco || null, sexo: a.p_sexo, raca: a.p_raca, nascimento: a.p_data, mae_id: a.p_mae_id, situacao: 'ativo', arquivado: false, especie: 'Bovino', categoria: a.p_sexo === 'M' ? 'Bezerro' : 'Bezerra' });
    tab('nascimentos').push({ id: novoId(), bezerro_id: id, mae_id: a.p_mae_id, data: a.p_data, peso_nascer_kg: a.p_peso }); if (a.p_peso) tab('pesagens').push({ id: novoId(), animal_id: id, data: a.p_data, peso_kg: a.p_peso, criado_em: new Date().toISOString() }) } return id },
  registrar_venda: a => { const id = a.p_id || novoId(); if (!tab('vendas').some(v => v.id === id)) { tab('vendas').push({ id, ...a.p_venda, arquivado: false });
    a.p_itens.forEach((it, k) => { const an = tab('animais').find(x => x.situacao === 'ativo' && ((it.controle && x.controle === it.controle) || (it.chip && x.chip === it.chip))); if (an) an.situacao = 'vendido';
      tab('venda_itens').push({ id: novoId(), venda_id: id, ordem: k + 1, animal_id: an?.id || null, ...it }) }) } return id },
  admin_definir_senha: () => null,
  colaboradores_para_cantina: () => tab('colaboradores').filter(c => c.situacao === 'Ativo' && !c.arquivado).map(c => ({ id: c.id, nome: c.nome, funcao: c.funcao })),
  meu_colaborador: () => tab('colaboradores').find(c => c.perfil_id === ADMIN)?.id || null,
};

const log = [];   // requisições com erro
async function rota(r) {
  const req = r.request(), u = new URL(req.url()), metodo = req.method();
  if (u.pathname.includes('/auth/v1/token')) return r.fulfill({ json: { access_token: 'x.' + Buffer.from(JSON.stringify({ sub: ADMIN, exp: 9999999999 })).toString('base64') + '.y', token_type: 'bearer', expires_in: 3600, expires_at: 9999999999, refresh_token: 'r', user: { id: ADMIN, email: 'admin@teste.local', aud: 'authenticated' } } });
  if (u.pathname.includes('/auth/v1/')) return r.fulfill({ json: { id: ADMIN, email: 'admin@teste.local', aud: 'authenticated' } });
  const partes = u.pathname.split('/'), t = partes.pop();
  const corpo = (() => { try { return req.postDataJSON() } catch { return null } })();
  const objeto = (req.headers()['accept'] || '').includes('pgrst.object');
  const devolve = (dados, st = 200) => r.fulfill({ status: st, json: objeto ? (Array.isArray(dados) ? dados[0] ?? null : dados) : dados });
  if (partes[partes.length - 1] === 'rpc') { if (!RPC[t]) { log.push('RPC desconhecida: ' + t); return r.fulfill({ status: 404, json: { message: 'rpc ' + t } }) } return devolve(RPC[t](corpo || {})) }
  if (metodo === 'GET' || metodo === 'HEAD') { const base = VISOES[t] ? VISOES[t]() : tab(t); return devolve(embutir(t, filtrar(base, u.searchParams))) }
  if (metodo === 'POST') {
    const linhas = (Array.isArray(corpo) ? corpo : [corpo]).map(x => ({ id: x.id || novoId(), arquivado: false, criado_em: new Date().toISOString(), ...x }));
    for (const l of linhas) { if (tab(t).some(x => x.id === l.id)) return r.fulfill({ status: 409, json: { code: '23505', message: `duplicate key value violates unique constraint "${t}_pkey"` } }) }
    if (t === 'animais') for (const l of linhas) { if (l.situacao === undefined) l.situacao = 'ativo'; if (!l.especie) l.especie = 'Bovino'; if (l.chip && tab('animais').some(a => a.situacao === 'ativo' && !a.arquivado && a.chip?.toLowerCase() === l.chip.toLowerCase())) return r.fulfill({ status: 409, json: { code: '23505', message: 'duplicate key value violates unique constraint "ux_animais_chip"' } }) }
    if (t === 'movimentacoes') for (const l of linhas) { if (l.animal_id) { const a = tab('animais').find(a => a.id === l.animal_id); if (a) a.pasto_id = l.pasto_destino_id } if (l.lote_id) tab('animais').filter(a => a.lote_id === l.lote_id).forEach(a => (a.pasto_id = l.pasto_destino_id)) }
    if (t === 'cantina_produtos') linhas.forEach(l => { if (l.ativo === undefined) l.ativo = true });  // padrão do banco real
    if (t === 'tarefas' || t === 'servicos') linhas.forEach(l => { l.status = l.status || (t === 'tarefas' ? 'pendente' : 'Planejado') });
    tab(t).push(...linhas); return devolve(linhas, 201);
  }
  if (metodo === 'PATCH') { const alvo = filtrar(tab(t), u.searchParams); alvo.forEach(x => Object.assign(x, corpo)); return devolve(alvo) }
  log.push(`método não tratado ${metodo} ${t}`); return r.fulfill({ status: 405, json: {} });
}
module.exports = { semente, rota, T, log, ADMIN };
