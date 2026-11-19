import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { baixarCSV, dataBR, erroAmigavel, hojeISO, num, reais } from '../lib/formato'
import { enfileirar, lerComCache, novoId, q } from '../lib/offline'
import { useAuth } from '../auth'
import { AvisoCache } from './Pendencias'

interface Produto { id: string; nome: string; unidade: string; preco_venda: number; custo: number | null; estoque_minimo: number | null; ativo: boolean; saldo: number; data_inventario: string | null }
interface Pessoa { id: string; nome: string; funcao: string | null }
interface Mov { id: string; produto_id: string; data: string; tipo: string; quantidade: number; valor_unitario: number | null; colaborador_id: string | null; forma_pagamento: string | null; obs: string | null }
interface Fech { id: string; colaborador_id: string; mes: string; total: number; status: string }
type Aba = 'vender' | 'produtos' | 'contas' | 'minha'
const FORMAS = ['Desconto em folha', 'Dinheiro', 'Pix']
const mesAtual = () => hojeISO().slice(0, 8) + '01'
const nomeMes = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
const fimMes = (iso: string) => { const d = new Date(iso + 'T12:00:00'); d.setMonth(d.getMonth() + 1); d.setDate(0); return d.toISOString().slice(0, 10) }
const n = (v: string) => (v.trim() ? Number(v.replace(/\./g, '').replace(',', '.')) : NaN)

export default function Cantina() {
  const { gestor: ehGestor, cantina } = useAuth()
  const gestor = ehGestor || cantina   // pode cadastrar produtos, ver custos e todas as contas da cantina
  const [aba, setAba] = useState<Aba>('vender')
  const [prods, setProds] = useState<Produto[]>([])
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [movs, setMovs] = useState<Mov[]>([])
  const [fechs, setFechs] = useState<Fech[]>([])
  const [mes, setMes] = useState(mesAtual())
  const [cache, setCache] = useState<{ doCache: boolean; em?: string }>({ doCache: false })
  const [erro, setErro] = useState(''), [ok, setOk] = useState('')
  // caixa
  const [cliente, setCliente] = useState(''), [forma, setForma] = useState('Desconto em folha')
  const [carrinho, setCarrinho] = useState<{ produto_id: string; qtd: number }[]>([])
  const [busca, setBusca] = useState('')
  // cadastro / estoque
  const [novo, setNovo] = useState<Record<string, string> | null>(null)
  const [mov, setMov] = useState<Record<string, string> | null>(null)

  const carregar = useCallback(() => {
    lerComCache('cantina:produtos', () => q<Produto[]>(supabase.from('v_cantina_produtos').select('*').order('nome')), [] as Produto[]).then(r => { setProds(r.dados); setCache(r) })
    lerComCache('cantina:pessoas', () => q<Pessoa[]>(supabase.rpc('colaboradores_para_cantina')), [] as Pessoa[]).then(r => setPessoas(r.dados))
    const ini = mes, fim = fimMes(mes)
    lerComCache('cantina:movs:' + mes, () => q<Mov[]>(supabase.from('cantina_movimentos').select('*').gte('data', ini).lte('data', fim).order('data', { ascending: false }).order('criado_em', { ascending: false })), [] as Mov[]).then(r => setMovs(r.dados))
    lerComCache('cantina:fech', () => q<Fech[]>(supabase.from('cantina_fechamentos').select('*').order('mes', { ascending: false })), [] as Fech[]).then(r => setFechs(r.dados))
  }, [mes])
  useEffect(carregar, [carregar])

  const prod = (id: string) => prods.find(p => p.id === id)
  const nome = (id: string | null) => pessoas.find(p => p.id === id)?.nome || '—'
  const totalCarrinho = carrinho.reduce((s, c) => s + c.qtd * (prod(c.produto_id)?.preco_venda || 0), 0)
  const vendas = movs.filter(m => m.tipo === 'Venda')
  const contas = useMemo(() => {
    const m = new Map<string, { folha: number; dinheiro: number; pix: number; itens: number }>()
    vendas.forEach(v => {
      const c = m.get(v.colaborador_id!) || { folha: 0, dinheiro: 0, pix: 0, itens: 0 }
      const val = v.quantidade * (v.valor_unitario || 0)
      if (v.forma_pagamento === 'Desconto em folha') c.folha += val; else if (v.forma_pagamento === 'Pix') c.pix += val; else c.dinheiro += val
      c.itens += v.quantidade; m.set(v.colaborador_id!, c)
    })
    return [...m.entries()].map(([id, c]) => ({ id, ...c })).sort((a, b) => nome(a.id).localeCompare(nome(b.id)))
  }, [vendas, pessoas]) // eslint-disable-line react-hooks/exhaustive-deps
  const fechado = (colab: string) => fechs.find(f => f.colaborador_id === colab && f.mes === mes)

  function adicionar(p: Produto) {
    setCarrinho(c => c.some(x => x.produto_id === p.id) ? c.map(x => x.produto_id === p.id ? { ...x, qtd: x.qtd + 1 } : x) : [...c, { produto_id: p.id, qtd: 1 }])
    setBusca('')
  }
  async function finalizar() {
    setErro(''); setOk('')
    if (!cliente) return setErro('Escolha o funcionário.')
    if (!carrinho.length) return setErro('Adicione pelo menos um produto.')
    const semEstoque = carrinho.filter(c => (prod(c.produto_id)?.saldo ?? 0) < c.qtd).map(c => prod(c.produto_id)?.nome)
    if (semEstoque.length && !confirm(`Estoque insuficiente no sistema para: ${semEstoque.join(', ')}. Vender mesmo assim?`)) return
    if (fechado(cliente) && mes === mesAtual() && !confirm('A conta deste funcionário já foi fechada neste mês. Lançar mesmo assim?')) return
    let todos = true
    for (const c of carrinho) {
      const p = prod(c.produto_id)!
      const env = await enfileirar({ tipo: 'insert', tabela: 'cantina_movimentos', dados: { id: novoId(), produto_id: p.id, data: hojeISO(), tipo: 'Venda', quantidade: c.qtd,
        valor_unitario: p.preco_venda, colaborador_id: cliente, forma_pagamento: forma, lancado_em: new Date().toISOString() } },
        `Cantina: ${c.qtd} ${p.unidade} ${p.nome} para ${nome(cliente)} (${forma}) — ${reais(c.qtd * p.preco_venda)}`)
      todos = todos && env
    }
    setOk(`Venda de ${reais(totalCarrinho)} para ${nome(cliente)} ${todos ? 'registrada.' : 'guardada no aparelho; será enviada quando houver internet.'}`)
    setCarrinho([]); setCliente(''); carregar()
  }
  async function salvarProduto(e: React.FormEvent) {
    e.preventDefault(); if (!novo) return
    const preco = n(novo.preco_venda); if (!(preco >= 0)) return setErro('Preço inválido.')
    const dados = { nome: novo.nome.trim(), unidade: novo.unidade, preco_venda: preco, custo: isNaN(n(novo.custo)) ? null : n(novo.custo), estoque_minimo: isNaN(n(novo.estoque_minimo)) ? null : n(novo.estoque_minimo) }
    const { error } = novo.id ? await supabase.from('cantina_produtos').update(dados).eq('id', novo.id) : await supabase.from('cantina_produtos').insert(dados)
    if (error) return setErro(error.message.includes('cantina_produtos_nome_key') ? 'Já existe um produto com esse nome.' : erroAmigavel(error) + ' (Precisa de internet.)')
    setNovo(null); setOk('Produto salvo.'); carregar()
  }
  async function lancarEstoque(e: React.FormEvent) {
    e.preventDefault(); if (!mov) return
    const p = prod(mov.produto_id); const qtd = n(mov.quantidade)
    if (!p || !(qtd >= 0)) return setErro('Escolha o produto e a quantidade.')
    const env = await enfileirar({ tipo: 'insert', tabela: 'cantina_movimentos', dados: { id: novoId(), produto_id: p.id, data: hojeISO(), tipo: mov.tipo, quantidade: qtd,
      valor_unitario: mov.tipo === 'Entrada' && !isNaN(n(mov.custo)) ? n(mov.custo) : null, obs: mov.obs || null, lancado_em: new Date().toISOString() } },
      `Cantina: ${mov.tipo} de ${qtd} ${p.unidade} ${p.nome}`)
    setMov(null); setOk(env ? 'Lançado.' : 'Guardado no aparelho; será enviado quando houver internet.'); carregar()
  }
  async function fecharMes() {
    const abertas = contas.filter(c => c.folha > 0 && !fechado(c.id))
    if (!abertas.length) return setErro('Não há contas em aberto de desconto em folha neste mês.')
    if (!confirm(`Fechar ${nomeMes(mes)}: ${abertas.length} funcionário(s), total ${reais(abertas.reduce((s, c) => s + c.folha, 0))} para desconto em folha?`)) return
    const { error } = await supabase.from('cantina_fechamentos').insert(abertas.map(c => ({ colaborador_id: c.id, mes, total: Math.round(c.folha * 100) / 100, status: 'Descontado' })))
    if (error) return setErro(erroAmigavel(error) + ' (Fechar o mês precisa de internet.)')
    setOk('Mês fechado. Use 🖨️ PDF para imprimir a lista de descontos.'); carregar()
  }

  const achados = busca.trim() ? prods.filter(p => p.ativo && p.nome.toLowerCase().includes(busca.trim().toLowerCase())).slice(0, 12) : prods.filter(p => p.ativo).slice(0, 12)
  const meses = [...new Set([mesAtual(), ...fechs.map(f => f.mes)])].sort().reverse()

  return (
    <>
      <div className="titulo-acoes">
        <h1>Cantina</h1>
        <div>
          <select value={mes} onChange={e => setMes(e.target.value)} style={{ width: 'auto' }}>
            {[...new Set([...meses, ...Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return d.toISOString().slice(0, 8) + '01' })])].sort().reverse()
              .map(m => <option key={m} value={m}>{nomeMes(m)}</option>)}
          </select>
        </div>
      </div>
      <AvisoCache {...cache} />
      {erro && <p className="erro">{erro}</p>}{ok && <p className="ok">{ok}</p>}
      <div className="abas">{([['vender', '🛒 Vender'], ['produtos', 'Produtos e estoque'], ['contas', gestor ? 'Contas do mês' : 'Minhas vendas'], ...(cantina ? [] : [['minha', 'Minha conta']])] as [Aba, string][])
        .map(([k, t]) => <button key={k} className={aba === k ? '' : 'sec'} onClick={() => { setAba(k); setErro(''); setOk('') }}>{t}</button>)}</div>

      {aba === 'vender' && <div className="duas">
        <section className="cartao">
          <h2>1. Para quem</h2>
          <select value={cliente} onChange={e => setCliente(e.target.value)}><option value="">Escolha o funcionário…</option>{pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}{p.funcao ? ` (${p.funcao})` : ''}</option>)}</select>
          {!pessoas.length && <p className="aviso">Nenhum colaborador ativo. {ehGestor ? 'Cadastre em Colaboradores.' : 'Peça ao administrador para cadastrar os funcionários.'}</p>}
          <h2 style={{ marginTop: '1rem' }}>2. Produtos</h2>
          <input placeholder="Buscar produto…" value={busca} onChange={e => setBusca(e.target.value)} />
          <div className="sugestoes" style={{ marginTop: '.5rem' }}>{achados.map(p => <button type="button" key={p.id} className="sec mini" onClick={() => adicionar(p)}>{p.nome} · {reais(p.preco_venda)}</button>)}</div>
          {!prods.length && <p className="vazio">Nenhum produto cadastrado.</p>}
        </section>
        <section className="cartao">
          <h2>3. Conferir e finalizar</h2>
          {carrinho.length ? <table><tbody>{carrinho.map(c => { const p = prod(c.produto_id)!; return <tr key={c.produto_id}>
            <td>{p.nome}</td>
            <td className="acoes-linha"><button className="sec mini" onClick={() => setCarrinho(carrinho.map(x => x.produto_id === c.produto_id ? { ...x, qtd: Math.max(0, x.qtd - 1) } : x).filter(x => x.qtd > 0))}>−</button> <b>{c.qtd}</b> <button className="sec mini" onClick={() => adicionar(p)}>+</button></td>
            <td className="num">{reais(c.qtd * p.preco_venda)}</td></tr> })}</tbody>
            <tfoot><tr><th colSpan={2}>Total</th><th className="num">{reais(totalCarrinho)}</th></tr></tfoot></table> : <p className="vazio">Carrinho vazio.</p>}
          <label>Forma de pagamento<select value={forma} onChange={e => setForma(e.target.value)}>{FORMAS.map(f => <option key={f}>{f}</option>)}</select></label>
          <button onClick={finalizar} disabled={!carrinho.length || !cliente}>Finalizar venda{carrinho.length ? ` · ${reais(totalCarrinho)}` : ''}</button>
        </section>
      </div>}

      {aba === 'produtos' && <>
        <div className="abas">
          <button className="sec" onClick={() => setMov({ tipo: 'Entrada', produto_id: '', quantidade: '', custo: '', obs: '' })}>+ Entrada (compra)</button>
          <button className="sec" onClick={() => setMov({ tipo: 'Inventário', produto_id: '', quantidade: '', custo: '', obs: '' })}>Contagem</button>
          <button className="sec" onClick={() => setMov({ tipo: 'Perda', produto_id: '', quantidade: '', custo: '', obs: '' })}>Perda / vencido</button>
          {gestor && <button onClick={() => setNovo({ id: '', nome: '', unidade: 'un', preco_venda: '', custo: '', estoque_minimo: '' })}>+ Produto</button>}
        </div>
        {novo && <form className="cartao formulario" onSubmit={salvarProduto}>
          <div className="grade">
            <label>Nome *<input required value={novo.nome} onChange={e => setNovo({ ...novo, nome: e.target.value })} /></label>
            <label>Unidade<select value={novo.unidade} onChange={e => setNovo({ ...novo, unidade: e.target.value })}>{['un', 'kg', 'pct', 'cx', 'L', 'dz'].map(u => <option key={u}>{u}</option>)}</select></label>
            <label>Preço de venda (R$) *<input required inputMode="decimal" value={novo.preco_venda} onChange={e => setNovo({ ...novo, preco_venda: e.target.value })} /></label>
            <label>Custo (R$)<input inputMode="decimal" value={novo.custo} onChange={e => setNovo({ ...novo, custo: e.target.value })} /></label>
            <label>Estoque mínimo<input inputMode="decimal" value={novo.estoque_minimo} onChange={e => setNovo({ ...novo, estoque_minimo: e.target.value })} /></label>
          </div>
          <div className="acoes"><button type="button" className="sec" onClick={() => setNovo(null)}>Cancelar</button><button>Salvar</button></div>
        </form>}
        {mov && <form className="cartao formulario" onSubmit={lancarEstoque}>
          <h2>{mov.tipo === 'Inventário' ? 'Contagem (o saldo passa a ser o número contado)' : mov.tipo}</h2>
          <div className="grade">
            <label>Produto *<select required value={mov.produto_id} onChange={e => setMov({ ...mov, produto_id: e.target.value })}><option value="">Escolha…</option>{prods.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
            <label>Quantidade *<input required inputMode="decimal" value={mov.quantidade} onChange={e => setMov({ ...mov, quantidade: e.target.value })} /></label>
            {mov.tipo === 'Entrada' && <label>Custo unitário (R$)<input inputMode="decimal" value={mov.custo} onChange={e => setMov({ ...mov, custo: e.target.value })} /></label>}
            <label>Observação<input value={mov.obs} onChange={e => setMov({ ...mov, obs: e.target.value })} /></label>
          </div>
          <div className="acoes"><button type="button" className="sec" onClick={() => setMov(null)}>Cancelar</button><button>Lançar</button></div>
        </form>}
        <section className="cartao"><div className="tabela-rolagem"><table className="lista">
          <thead><tr><th>Produto</th><th className="num">Preço</th>{gestor && <th className="num">Custo</th>}<th className="num">Estoque</th><th className="num">Mínimo</th></tr></thead>
          <tbody>{prods.map(p => { const baixo = p.estoque_minimo != null && p.saldo <= p.estoque_minimo; return <tr key={p.id} className={baixo ? 'pendente' : ''} onClick={() => gestor && setNovo({ id: p.id, nome: p.nome, unidade: p.unidade, preco_venda: String(p.preco_venda).replace('.', ','), custo: p.custo != null ? String(p.custo).replace('.', ',') : '', estoque_minimo: p.estoque_minimo != null ? String(p.estoque_minimo) : '' })}>
            <td><b>{p.nome}</b>{baixo && <small> ⚠️ repor</small>}{!p.data_inventario && <small> (sem contagem)</small>}</td><td className="num">{reais(p.preco_venda)}</td>{gestor && <td className="num">{reais(p.custo)}</td>}
            <td className="num"><b>{num(p.saldo, 0)} {p.unidade}</b></td><td className="num">{p.estoque_minimo ?? '—'}</td></tr> })}</tbody></table></div>
          {gestor && <p><small>Toque num produto para mudar preço ou estoque mínimo.</small></p>}</section>
      </>}

      {aba === 'contas' && <section className="cartao">
        <div className="titulo-acoes"><h2>{gestor ? `Contas de ${nomeMes(mes)}` : `Vendas que você lançou em ${nomeMes(mes)}`}</h2>
          <div>
            <button className="sec" onClick={() => baixarCSV(`cantina-${mes}.csv`, ['Funcionário', 'Desconto em folha', 'Dinheiro', 'Pix', 'Itens', 'Situação'],
              contas.map(c => [nome(c.id), c.folha.toFixed(2).replace('.', ','), c.dinheiro.toFixed(2).replace('.', ','), c.pix.toFixed(2).replace('.', ','), c.itens, fechado(c.id) ? 'Fechado' : 'Em aberto']))}>Exportar Excel (CSV)</button>
            {ehGestor && <button onClick={fecharMes}>Fechar mês (desconto em folha)</button>}
          </div></div>
        {contas.length ? <table><thead><tr><th>Funcionário</th><th className="num">Desconto em folha</th><th className="num">Dinheiro</th><th className="num">Pix</th><th>Situação</th></tr></thead>
          <tbody>{contas.map(c => <tr key={c.id}><td><b>{nome(c.id)}</b></td><td className="num"><b>{reais(c.folha)}</b></td><td className="num">{reais(c.dinheiro)}</td><td className="num">{reais(c.pix)}</td>
            <td>{fechado(c.id) ? `Fechado (${reais(fechado(c.id)!.total)})` : 'Em aberto'}</td></tr>)}</tbody>
          <tfoot><tr><th>Total</th><th className="num">{reais(contas.reduce((s, c) => s + c.folha, 0))}</th><th className="num">{reais(contas.reduce((s, c) => s + c.dinheiro, 0))}</th><th className="num">{reais(contas.reduce((s, c) => s + c.pix, 0))}</th><th></th></tr></tfoot></table>
          : <p className="vazio">Nenhuma venda neste mês.</p>}
        <h2 style={{ marginTop: '1rem' }}>Vendas do mês</h2>
        {vendas.length ? <div className="tabela-rolagem"><table><tbody>{vendas.map(v => <tr key={v.id}><td>{dataBR(v.data)}</td><td>{nome(v.colaborador_id)}</td><td>{num(v.quantidade, 0)} {prod(v.produto_id)?.nome}</td><td>{v.forma_pagamento}</td><td className="num">{reais(v.quantidade * (v.valor_unitario || 0))}</td></tr>)}</tbody></table></div> : <p className="vazio">—</p>}
      </section>}

      {aba === 'minha' && <MinhaConta mes={mes} prods={prods} />}
    </>
  )
}

/** O funcionário vê só as próprias compras (o banco garante isso). */
function MinhaConta({ mes, prods }: { mes: string; prods: Produto[] }) {
  const [movs, setMovs] = useState<Mov[] | null>(null)
  const [eu, setEu] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    supabase.rpc('meu_colaborador').then(r => setEu((r.data as string) || null))
  }, [])
  useEffect(() => {
    if (!eu) return
    lerComCache(`cantina:minha:${mes}`, () => q<Mov[]>(supabase.from('cantina_movimentos').select('*').eq('colaborador_id', eu).eq('tipo', 'Venda').gte('data', mes).lte('data', fimMes(mes)).order('data', { ascending: false })), [] as Mov[]).then(r => setMovs(r.dados))
  }, [eu, mes])
  if (eu === undefined) return <p>Carregando…</p>
  if (eu === null) return <p className="aviso">Seu usuário ainda não está ligado a um cadastro de colaborador. Peça ao administrador para ligar em Colaboradores → “Usuário no sistema”.</p>
  const total = (movs || []).reduce((s, v) => s + v.quantidade * (v.valor_unitario || 0), 0)
  const folha = (movs || []).filter(v => v.forma_pagamento === 'Desconto em folha').reduce((s, v) => s + v.quantidade * (v.valor_unitario || 0), 0)
  return (
    <section className="cartao">
      <h2>Minhas compras em {nomeMes(mes)}</h2>
      <p>Total: <b>{reais(total)}</b> · para desconto em folha: <b>{reais(folha)}</b></p>
      {movs?.length ? <table><tbody>{movs.map(v => <tr key={v.id}><td>{dataBR(v.data)}</td><td>{num(v.quantidade, 0)} {prods.find(p => p.id === v.produto_id)?.nome}</td><td>{v.forma_pagamento}</td><td className="num">{reais(v.quantidade * (v.valor_unitario || 0))}</td></tr>)}</tbody></table> : <p className="vazio">Nenhuma compra.</p>}
    </section>
  )
}
