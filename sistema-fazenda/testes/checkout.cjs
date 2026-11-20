// Check-out completo: percorre todas as abas e aperta os botões, registrando o resultado de cada passo.
const { chromium, devices } = require('playwright');
const banco = require('./banco-falso.cjs');
const URL = 'http://localhost:4173/';
const DISP = process.argv[2] === 'pc' ? { viewport: { width: 1366, height: 860 } } : devices['iPhone 13'];
const res = [];
(async () => {
  banco.semente();
  const b = await chromium.launch(); const ctx = await b.newContext({ ...DISP, acceptDownloads: true }); const pg = await ctx.newPage(); pg.setDefaultTimeout(4000);
  const problemas = []; const respostas = [];
  pg.on('pageerror', e => problemas.push('ERRO JS: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problemas.push('console: ' + m.text().slice(0, 150)) });
  pg.on('response', r => { if (r.status() >= 400 && r.url().includes('supabase-falso')) respostas.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname.split('/').pop()}`) });
  // respostas automáticas para janelas do celular (prompt/confirm)
  let respostaPrompt = '', apertarCancelar = false;
  pg.on('dialog', d => { problemas.push(`janela: "${d.message().slice(0, 70)}"${apertarCancelar ? ' → apertou CANCELAR' : ''}`); if (apertarCancelar && d.type() === 'prompt') return d.dismiss(); d.type() === 'prompt' ? d.accept(respostaPrompt) : d.accept() });
  await ctx.route('http://supabase-falso.local/**', banco.rota);
  await pg.addInitScript(() => { window.print = () => { window.__imprimiu = (window.__imprimiu || 0) + 1 } });

  const corpo = async () => (await pg.textContent('body')).replace(/\s+/g, ' ');
  async function passo(nome, fn) {
    const ini = problemas.length, iniR = respostas.length;
    try {
      const obs = await fn();
      await pg.waitForTimeout(250);
      const txt = await corpo();
      const quebrado = (txt.match(/\bNaN\b|undefined|\[object Object\]|Invalid Date/g) || []);
      const extra = [...problemas.slice(ini).filter(p => !p.startsWith('janela')), ...respostas.slice(iniR).map(r => 'HTTP ' + r), ...quebrado.map(q => 'texto quebrado: ' + q)];
      res.push({ nome, ok: extra.length === 0, obs: [obs, ...problemas.slice(ini).filter(p => p.startsWith('janela'))].filter(Boolean).join(' | '), extra });
    } catch (e) { res.push({ nome, ok: false, obs: '', extra: ['FALHOU: ' + e.message.split('\n')[0].slice(0, 160)] }) }
    const r = res[res.length - 1]; console.log(`${r.ok ? '✅' : '❌'} ${r.nome}${r.obs ? ' — ' + r.obs : ''}${r.extra.length ? '\n     ⚠️ ' + r.extra.join('\n     ⚠️ ') : ''}`)
  }
  const ir = async rota => { await pg.goto(URL + '#' + rota); await pg.waitForTimeout(700) };
  const btn = (t, n = 0) => pg.locator(`button:has-text("${t}")`).nth(n);
  const campo = rotulo => pg.locator('label', { hasText: rotulo }).first().locator('input, select, textarea').first();
  const msg = async () => (await pg.locator('.ok, .erro, .aviso').allTextContents()).join(' / ').slice(0, 140);
  const baixar = async (t) => { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }), btn(t).click()]); return 'baixou ' + d.suggestedFilename() };

  // ---------------- entrada
  await passo('Login', async () => { await pg.goto(URL); await pg.fill('input[type=email]', 'admin@teste.local'); await pg.fill('input[type=password]', 'x'); await btn('Entrar').click(); await pg.waitForSelector('nav.menu'); return 'entrou' });
  await passo('Painel: indicadores e IATF de hoje', async () => { await ir('/'); const t = await corpo(); return (t.includes('IATF') ? 'IATF ok' : 'SEM IATF') + ' · ' + (t.includes('bovinos no rebanho') ? 'rebanho ok' : 'sem rebanho') });
  await passo('Topo: botão PDF (imprimir)', async () => { await btn('PDF').click(); return 'imprimir chamado: ' + (await pg.evaluate(() => window.__imprimiu || 0)) });
  await passo('Topo: lupa → Busca', async () => { await pg.click('a.lupa'); await pg.fill('input.busca', 'T-001'); await pg.waitForTimeout(400); return (await corpo()).includes('T-001') ? 'achou T-001' : 'NÃO achou' });

  // ---------------- animais
  await passo('Animais: lista e filtros', async () => { await ir('/animais'); for (const s of await pg.locator('.filtros select').all()) { if (await s.locator('option').count() < 2) continue; const o = await s.locator('option').nth(1).getAttribute('value'); if (o !== null) await s.selectOption(o) } await pg.waitForTimeout(200); for (const s of await pg.locator('.filtros select').all()) await s.selectOption(''); return await pg.textContent('.contagem') });
  await passo('Animais: Exportar CSV', async () => baixar('Exportar Excel'));
  await passo('Animais: + Novo animal (bovino)', async () => { await ir('/animais/novo'); await campo('Nº de controle').fill('QA-100'); await campo('Chip eletrônico').fill('CHIPQA'); await campo('Sexo').selectOption('F'); await campo('Nascimento').fill('2024-05-01'); await campo('Peso atual').fill('320'); await btn('Salvar').click(); await pg.waitForTimeout(800); return 'url: ' + pg.url().split('#')[1] });
  await passo('Animais: chip repetido é recusado', async () => { await ir('/animais/novo'); await campo('Nº de controle').fill('QA-101'); await campo('Chip eletrônico').fill('chipqa'); await campo('Sexo').selectOption('M'); await btn('Salvar').click(); await pg.waitForTimeout(500); return await msg() });
  await passo('Animais: + Novo cavalo (equino)', async () => { await ir('/animais/novo'); await campo('Espécie').selectOption('Equino'); await campo('Nº de controle').fill('CAV-1'); await campo('Sexo').selectOption('M'); await campo('Categoria').selectOption('Cavalo'); await campo('Uso').fill('Serviço'); await btn('Salvar').click(); await pg.waitForTimeout(800); return (await corpo()).includes('Equino') ? 'ficha de equino ok' : 'ficha sem espécie' });
  await passo('Ficha: registrar pesagem', async () => { await ir('/animais/a1'); await pg.fill('input[placeholder="Peso (kg)"]', '455'); await btn('Registrar').first().click(); await pg.waitForTimeout(600); return await msg() });
  await passo('Ficha: mudar de pasto', async () => { await pg.locator('section:has-text("Mudar de pasto") select').selectOption({ label: 'P10' }); await btn('Mover').click(); await pg.waitForTimeout(600); return (await msg()) + ' · pasto agora: ' + (banco.T.animais.find(a => a.id === 'a1').pasto_id) });
  await passo('Ficha: reprodução (diagnóstico prenhe)', async () => { const s = pg.locator('section:has-text("Reprodução")'); await s.locator('select').first().selectOption('Diagnóstico de prenhez'); await s.locator('select').nth(1).selectOption('Prenhe'); await s.locator('button:has-text("Registrar")').click(); await pg.waitForTimeout(600); await ir('/animais/a1'); return (await corpo()).includes('Prenhe') ? 'mostra Prenhe' : 'NÃO mostra' });
  await passo('Ficha: + Registrar nascimento (atalho)', async () => { await ir('/animais/a1'); await pg.click('text=+ Registrar nascimento'); await pg.waitForTimeout(500); return 'url: ' + pg.url().split('#')[1] });
  await passo('Ficha: Editar e salvar', async () => { await ir('/animais/a1/editar'); await campo('Nome / apelido').fill('Mimosa'); await btn('Salvar').click(); await pg.waitForTimeout(800); return (await corpo()).includes('Mimosa') ? 'nome salvo' : 'NÃO salvou' });

  // ---------------- nascimento
  await passo('Nascimento: registrar bezerro sem número', async () => { await ir('/nascimento'); await pg.fill('input[placeholder="Digite o número da mãe…"]', 'T-0'); await pg.locator('.sugestoes button').first().click(); await campo('Sexo').selectOption('M'); await campo('Peso ao nascer').fill('31'); await btn('Registrar nascimento').click(); await pg.waitForTimeout(800); return await msg() });

  // ---------------- rebanho
  await passo('Rebanho: relatório e exportar', async () => { await ir('/rebanho'); return baixar('Exportar') });
  await passo('Rebanho: lançar próximo mês e salvar', async () => { await btn('Lançar próximo mês').click(); await pg.locator('input.mini-num').first().fill('5'); await btn('Salvar relatório do mês').click(); await pg.waitForTimeout(800); return (await msg()) + ' · linhas: ' + banco.T.rebanho_mensal.length });
  await passo('Rebanho: registrar morte', async () => { await campo('Número').fill('8888'); await campo('Causa').fill('Raio'); await pg.locator('form:has-text("Causa") button:has-text("Registrar")').click(); await pg.waitForTimeout(600); return await msg() });

  // ---------------- IATF / tarefas
  await passo('IATF: menu abre só tarefas IATF', async () => { await pg.click('nav.menu >> text=IATF'); await pg.waitForTimeout(600); const ativos = await pg.locator('nav.menu a.active').allTextContents(); return 'menu aceso: ' + ativos.join(',') });
  await passo('Tarefas: todas as visões', async () => { await ir('/tarefas'); for (const v of ['Hoje', 'Atrasadas', 'Próximos 7 dias', 'Semana', 'Próximos 30 dias', 'Por colaborador', 'Concluídas']) { await btn(v).first().click(); await pg.waitForTimeout(250) } await btn('Hoje').first().click(); return 'ok' });
  await passo('Tarefas: + Nova tarefa', async () => { await btn('+ Nova tarefa').click(); await campo('O que fazer').fill('Conferir cerca QA'); await btn('Criar tarefa').click(); await pg.waitForTimeout(700); return (await msg()) });
  await passo('Tarefas: Iniciar → Concluir (com observação) → Reabrir', async () => { const c = pg.locator('.tarefa:has-text("IATF · D0 TESTE")'); await c.locator('button:has-text("Iniciar")').click(); await pg.waitForTimeout(400); respostaPrompt = 'feito QA'; await c.locator('button:has-text("Concluir")').click(); await pg.waitForTimeout(500); const st1 = await c.locator('.status').textContent(); await c.locator('button:has-text("Reabrir")').click(); await pg.waitForTimeout(400); return `${st1} → ${await c.locator('.status').textContent()}` });
  await passo('Tarefas: Concluir apertando CANCELAR na janela (deve concluir)', async () => { await btn('+ Nova tarefa').click(); await campo('O que fazer').fill('Tarefa cancelar QA'); await btn('Criar tarefa').click(); await pg.waitForTimeout(600); const c = pg.locator('.tarefa:has-text("Tarefa cancelar QA")'); apertarCancelar = true; await c.locator('button:has-text("Concluir")').click(); await pg.waitForTimeout(500); apertarCancelar = false; return await c.locator('.status').textContent() });
  await passo('Tarefas: Arquivar', async () => { const n = await pg.locator('.tarefa').count(); await pg.locator('.tarefa button:has-text("Arquivar")').last().click(); await pg.waitForTimeout(600); return `${n} → ${await pg.locator('.tarefa').count()} cartões` });

  // ---------------- áreas
  await passo('Áreas: ordem P1, P2, P10', async () => { await ir('/pastos'); return (await pg.locator('table.lista tbody tr td:first-child b').allTextContents()).join(', ') });
  await passo('Áreas: filtro Todos os tipos + Exportar', async () => { await pg.locator('.cartao select').first().selectOption(''); return baixar('Exportar') });
  await passo('Áreas: + Pasto', async () => { await btn('+ Pasto').click(); await campo('Código').fill('P99'); await campo('Área total').fill('12,5'); await btn('Salvar').click(); await pg.waitForTimeout(700); return await msg() });
  await passo('Áreas: Editar pasto', async () => { await pg.locator('tr:has-text("P99") button:has-text("Editar")').click(); await campo('Nome').fill('Pasto QA'); await btn('Salvar').click(); await pg.waitForTimeout(700); return await msg() });
  await passo('Áreas: Arquivar pasto vazio', async () => { await pg.locator('tr:has-text("P99") button:has-text("Arquivar")').click(); await pg.waitForTimeout(700); return await msg() });
  await passo('Áreas: Arquivar pasto COM animal (deve recusar)', async () => { await pg.locator('tr:has-text("P10") button:has-text("Arquivar")').click(); await pg.waitForTimeout(500); return await msg() });
  await passo('Lotes: criar e mover lote', async () => { await pg.fill('input[placeholder="Nome do lote"]', 'Lote QA'); await btn('Criar lote').click(); await pg.waitForTimeout(800); const f = pg.locator('form:has-text("Mover lote")'); await f.locator('select').first().selectOption({ label: 'Lote QA' }); await f.locator('select').nth(1).selectOption({ label: 'P2' }); await btn('Mover lote').click(); await pg.waitForTimeout(600); return await msg() });
  await passo('Áreas: + Fazenda (prompt)', async () => { respostaPrompt = 'Fazenda QA'; await btn('+ Fazenda').click(); await pg.waitForTimeout(600); return await msg() });

  // ---------------- vendas
  await passo('Vendas: lista, totais e exportar', async () => { await ir('/vendas'); return baixar('Exportar') });
  await passo('Vendas: detalhe e exportar', async () => { await pg.locator('table.lista tbody tr').first().click(); await pg.waitForTimeout(600); return baixar('Exportar') });
  await passo('Vendas: + Nova venda (cálculo e salvar)', async () => { await ir('/vendas/nova'); await campo('Comprador').fill('QA COMPRADOR'); await campo('Valor da @').fill('465'); await pg.locator('table.itens-venda input').first().fill('T-001'); await pg.locator('table.itens-venda input').nth(2).fill('300'); const r = await pg.textContent('.contagem'); await btn('Salvar venda').click(); await pg.waitForTimeout(900); return r.replace(/\s+/g, ' ') + ' · T-001 agora: ' + banco.T.animais.find(a => a.controle === 'T-001').situacao });

  // ---------------- serviços
  await passo('Serviços: filtros, ver produtos, exportar', async () => { await ir('/servicos'); await pg.locator('.filtros select').first().selectOption('Manutenção de pasto'); await btn('Ver produtos').first().click(); const t = (await corpo()).includes('Calcário') ? 'produtos aparecem' : 'SEM produtos'; await pg.locator('.filtros select').first().selectOption(''); return t + ' · ' + await baixar('Exportar') });
  await passo('Serviços: Iniciar → Voltar a planejado', async () => { const c = pg.locator('.tarefa').first(); await c.locator('button:has-text("Iniciar")').click(); await pg.waitForTimeout(300); await c.locator('button:has-text("Voltar a planejado")').click(); await pg.waitForTimeout(300); return await c.locator('.status').textContent() });
  await passo('Serviços: Cancelar (confirmação no cartão) → Reabrir', async () => { const c = pg.locator('.tarefa').first(); await c.locator('button:has-text("Cancelar serviço")').click(); await c.locator('button:has-text("Sim, cancelar serviço")').click(); await pg.waitForTimeout(300); const a = await c.locator('.status').textContent(); await c.locator('button:has-text("Reabrir")').click(); await pg.waitForTimeout(300); return `${a} → ${await c.locator('.status').textContent()}` });
  await passo('Serviços: Concluir com custo', async () => { respostaPrompt = '1.234,50'; const c = pg.locator('.tarefa').first(); await c.locator('button:has-text("Concluir")').click(); await pg.waitForTimeout(500); return (await c.locator('.status').textContent()) + ' · custo gravado: ' + banco.T.servicos.find(s => s.id === 's1').custo_realizado });
  await passo('Serviços: + Novo serviço', async () => { await btn('+ Novo serviço').click(); await campo('Descrição curta').fill('Roçada QA'); await campo('Tipo').selectOption('Roçada'); await btn('Salvar').click(); await pg.waitForTimeout(700); return await msg() });
  await passo('Serviços: Concluir apertando CANCELAR na janela (deve concluir)', async () => { const c = pg.locator('.tarefa:has-text("Roçada QA")'); apertarCancelar = true; await c.locator('button:has-text("Concluir")').click(); await pg.waitForTimeout(500); apertarCancelar = false; return await c.locator('.status').textContent() });

  // ---------------- estoque
  await passo('Estoque: + Produto', async () => { await ir('/estoque'); await btn('+ Produto').click(); await campo('Nome').fill('Sal mineral QA'); await btn('Salvar').click(); await pg.waitForTimeout(700); return await msg() });
  await passo('Estoque: Contagem → Entrada → Saída (saldo)', async () => { for (const [b2, q] of [['Contagem (inventário)', '100'], ['+ Entrada', '50'], ['− Saída / uso', '30']]) { await btn(b2).click(); await campo('Produto').selectOption({ label: 'Milho (teste) (kg)' }); await campo('Quantidade').fill(q); await btn('Lançar').click(); await pg.waitForTimeout(500) } await ir('/estoque'); return 'saldo milho: ' + (await pg.locator('tr:has-text("Milho (teste)") td').nth(2).textContent()) });
  await passo('Estoque: definir mínimo (prompt)', async () => { respostaPrompt = '200'; await pg.locator('tr:has-text("Milho (teste)") a').click(); await pg.waitForTimeout(600); return (await pg.locator('tr:has-text("Milho (teste)")').textContent()).includes('abaixo do mínimo') ? 'alerta de mínimo aparece' : 'SEM alerta' });
  await passo('Estoque: abas Movimentações / Nutrição / Pedidos + exportar', async () => { const out = []; for (const a of ['Movimentações', 'Nutrição', 'Pedidos de compra', 'Saldo']) { await btn(a).first().click(); await pg.waitForTimeout(300); out.push(a) } return out.join(', ') + ' · ' + await baixar('Exportar') });

  // ---------------- máquinas
  await passo('Máquinas: + Máquina', async () => { await ir('/maquinas'); await btn('+ Máquina').click(); await campo('Nome').fill('Trator QA'); await campo('Horímetro atual').fill('1000'); await campo('Revisão a cada').fill('250'); await campo('Última revisão em').fill('700'); await btn('Salvar').click(); await pg.waitForTimeout(700); return (await msg()) + ' · ' + ((await corpo()).includes('Vencida') ? 'revisão VENCIDA aparece' : 'sem aviso') });
  await passo('Máquinas: Abastecimento (diesel sai do estoque)', async () => { await pg.locator('.tarefa:has-text("Trator QA") button:has-text("Abastecer")').click(); await campo('Litros').fill('80'); await campo('Horímetro / km').fill('1010'); await btn('Lançar').click(); await pg.waitForTimeout(600); return (await msg()) + ' · horímetro: ' + banco.T.maquinas[0].uso_atual });
  await passo('Máquinas: Manutenção', async () => { await pg.locator('.tarefa:has-text("Trator QA") button:has-text("Manutenção")').click(); await campo('O que foi feito').fill('Troca de óleo'); await btn('Lançar').click(); await pg.waitForTimeout(600); return await msg() });

  // ---------------- cantina
  await passo('Cantina: + Produto e Contagem', async () => { await ir('/cantina'); await btn('Produtos e estoque').click(); await btn('+ Produto').click(); await campo('Nome').fill('Bolacha QA'); await campo('Preço de venda').fill('4,50'); await btn('Salvar').click(); await pg.waitForTimeout(600); await btn('Contagem').click(); await campo('Produto').selectOption({ label: 'Bolacha QA' }); await campo('Quantidade').fill('10'); await btn('Lançar').click(); await pg.waitForTimeout(600); return await msg() });
  await passo('Cantina: vender', async () => { await btn('Vender').first().click(); await pg.locator('section.cartao select').first().selectOption({ label: 'JOAO TESTE (Vaqueiro)' }); await pg.click('text=Bolacha QA · R$ 4,50'); await pg.click('text=Bolacha QA · R$ 4,50'); await btn('Finalizar venda').click(); await pg.waitForTimeout(700); return await msg() });
  await passo('Cantina: contas, exportar, fechar mês', async () => { await btn('Contas do mês').click(); await pg.waitForTimeout(300); const t = await baixar('Exportar'); await btn('Fechar mês').click(); await pg.waitForTimeout(600); return t + ' · ' + await msg() });
  await passo('Cantina: Minha conta', async () => { await btn('Minha conta').last().click(); await pg.waitForTimeout(600); return (await corpo()).match(/Total: R\$ [\d,.]+/)?.[0] || 'sem total' });

  // ---------------- colaboradores / usuários / sistema / conta
  await passo('Colaboradores: + e editar', async () => { await ir('/colaboradores'); await btn('+ Colaborador').click(); await campo('Nome').fill('MARIA QA'); await btn('Salvar').click(); await pg.waitForTimeout(600); await pg.locator('tr:has-text("MARIA QA")').click(); await campo('Função').fill('Cozinheira'); await btn('Salvar').click(); await pg.waitForTimeout(600); return (await corpo()).includes('Cozinheira') ? 'editou' : 'NÃO editou' });
  await passo('Usuários: liberar, mudar perfil, bloquear, definir senha', async () => { await ir('/usuarios'); await btn('Liberar acesso').click(); await pg.waitForTimeout(500); await pg.locator('tr:has-text("Operador Teste") select').selectOption('cantina'); await pg.waitForTimeout(400); await btn('Definir nova senha').click(); await pg.fill('input[placeholder="Nova senha (mín. 8)"]', 'Teste2026'); await btn('Salvar senha').click(); await pg.waitForTimeout(400); const m = await msg(); await btn('Bloquear').click(); await pg.waitForTimeout(500); const op = banco.T.perfis.find(p => p.nome === 'Operador Teste'); return `${m.slice(0, 50)} · papel=${op.papel} ativo=${op.ativo}` });
  await passo('Sistema: cópia completa e histórico', async () => { await ir('/sistema'); const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 15000 }), btn('Baixar cópia completa').click()]); await pg.locator('select').first().selectOption('animais'); return 'baixou ' + d.suggestedFilename() });
  await passo('Minha conta: trocar nome', async () => { await ir('/conta'); await campo('Nome que aparece').fill('Admin QA'); await btn('Salvar').click(); await pg.waitForTimeout(500); return await msg() });
  await passo('Pendências: tela', async () => { await ir('/pendencias'); return (await corpo()).includes('Nada pendente') ? 'nada pendente' : 'há pendências' });

  console.log(`\n=== CHECK-OUT (${process.argv[2] || 'celular'}) ===`);
  console.log(`\n${res.filter(r => r.ok).length}/${res.length} passos sem problema. Banco falso: ${banco.log.join('; ') || 'sem chamadas desconhecidas'}`);
  await b.close();
})();
