import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { baixarCSV, dataBR, erroAmigavel, hojeISO, num, reais } from '../lib/formato'
import { useListas } from '../lib/dados'
import { enfileirar, lerComCache, novoId, q } from '../lib/offline'
import { useAuth } from '../auth'
import { AvisoCache } from './Pendencias'

interface Insumo { id: string; nome: string; categoria: string | null; unidade: string; estoque_minimo: number | null; obs: string | null; saldo: number; data_inventario: string | null; ultimo_movimento: string | null; proxima_validade: string | null }
interface Mov { id: string; data: string; tipo: string; quantidade: number; valor_unitario: number | null; destino: string | null; fornecedor: string | null; obs: string | null; insumos: { nome: string; unidade: string } | null }
interface Formula { id: string; nome: string; formula_itens: { percentual: number; insumos: { nome: string } | null }[] }
interface Plano { id: string; ano: number; mes: number; categoria: string; lote: string | null; n_animais: number | null; suplemento_texto: string | null; consumo_kg_cab_dia: number | null; dias: number | null; previsto_kg: number | null }
interface Pedido { id: string; data: string; titulo: string; status: string; obs: string | null; pedido_itens: { id: string; produto: string; quantidade: number | null; unidade: string | null; valor_unitario: number | null; quantidade_realizada: number | null; valor_total: number | null }[] }

const CATS = ['Nutrição', 'Adubo/Corretivo', 'Defensivo', 'Semente', 'Medicamento', 'Vacina', 'Combustível', 'Cerca', 'Peça', 'Outro']
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export default function Estoque() {
  const { gestor } = useAuth()
  const { pastos } = useListas()
  const [aba, setAba] = useState<'saldo' | 'movimentos' | 'nutricao' | 'pedidos'>('saldo')
  const [ins, setIns] = useState<Insumo[]>([])
  const [movs, setMovs] = useState<Mov[]>([])
  const [forms, setForms] = useState<Formula[]>([])
  const [plano, setPlano] = useState<Plano[]>([])
  const [peds, setPeds] = useState<Pedido[]>([])
  const [filtro, setFiltro] = useState('')
  const [mov, setMov] = useState<Record<string, string> | null>(null)
  const [novoIns, setNovoIns] = useState<Record<string, string> | null>(null)
  const [cache, setCache] = useState<{ doCache: boolean; em?: string }>({ doCache: false })
  const [erro, setErro] = useState(''), [ok, setOk] = useState('')

  const carregar = useCallback(() => {
    lerComCache('v_insumos', () => q<Insumo[]>(supabase.from('v_insumos').select('*').eq('arquivado', false).order('categoria').order('nome')), [] as Insumo[]).then(r => { setIns(r.dados); setCache(r) })
    lerComCache('movimentos', () => q<Mov[]>(supabase.from('insumo_movimentos').select('*, insumos(nome, unidade)').order('data', { ascending: false }).order('criado_em', { ascending: false }).limit(200)), [] as Mov[]).then(r => setMovs(r.dados))
    lerComCache('formulas', () => q<Formula[]>(supabase.from('formulas').select('id, nome, formula_itens(percentual, insumos(nome))').order('nome')), [] as Formula[]).then(r => setForms(r.dados))
    lerComCache('plano_nutricional', () => q<Plano[]>(supabase.from('plano_nutricional').select('*').order('ano').order('mes')), [] as Plano[]).then(r => setPlano(r.dados))
    if (gestor) lerComCache('pedidos', () => q<Pedido[]>(supabase.from('pedidos_compra').select('*, pedido_itens(*)').eq('arquivado', false).order('data', { ascending: false })), [] as Pedido[]).then(r => setPeds(r.dados))
  }, [gestor])
  useEffect(carregar, [carregar])

  const baixo = (i: Insumo) => i.estoque_minimo != null && i.saldo <= i.estoque_minimo
  const vencendo = (i: Insumo) => i.proxima_validade != null && i.proxima_validade <= new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10)
  const vis = ins.filter(i => !filtro || i.categoria === filtro)

  async function lancar(e: React.FormEvent) {
    e.preventDefault(); if (!mov) return; setErro('')
    const i = ins.find(x => x.id === mov.insumo_id); if (!i) return setErro('Escolha o produto.')
    const qtd = Number(mov.quantidade.replace(/\./g, '').replace(',', '.'))
    if (!(qtd >= 0)) return setErro('Quantidade inválida.')
    if (mov.tipo === 'Saída' && qtd > i.saldo && !confirm(`O saldo de ${i.nome} é ${num(i.saldo, 1)} ${i.unidade}. Lançar saída de ${qtd} mesmo assim?`)) return
    const enviado = await enfileirar({ tipo: 'insert', tabela: 'insumo_movimentos', dados: {
      id: novoId(), insumo_id: i.id, data: mov.data, tipo: mov.tipo, quantidade: qtd,
      valor_unitario: mov.valor_unitario ? Number(mov.valor_unitario.replace(/\./g, '').replace(',', '.')) : null,
      fornecedor: mov.fornecedor || null, nota_fiscal: mov.nota_fiscal || null, lote_produto: mov.lote_produto || null, validade: mov.validade || null,
      destino: mov.destino || null, pasto_id: mov.pasto_id || null, obs: mov.obs || null, lancado_em: new Date().toISOString() } },
      `${mov.tipo} de ${qtd} ${i.unidade} de ${i.nome}`)
    setMov(null); setOk(enviado ? 'Lançado.' : 'Guardado no aparelho; será enviado quando houver internet.'); carregar()
  }
  async function criarInsumo(e: React.FormEvent) {
    e.preventDefault(); if (!novoIns) return
    const { error } = await supabase.from('insumos').insert({ nome: novoIns.nome.trim(), unidade: novoIns.unidade, categoria: novoIns.categoria,
      estoque_minimo: novoIns.estoque_minimo ? Number(novoIns.estoque_minimo.replace(',', '.')) : null })
    if (error) return setErro(error.message.includes('insumos_nome_key') ? 'Já existe um produto com esse nome.' : erroAmigavel(error))
    setNovoIns(null); setOk('Produto cadastrado.'); carregar()
  }
  async function definirMinimo(i: Insumo) {
    const v = prompt(`Estoque mínimo de ${i.nome} (${i.unidade}):`, i.estoque_minimo?.toString() || ''); if (v === null) return
    const { error } = await supabase.from('insumos').update({ estoque_minimo: v.trim() ? Number(v.replace(',', '.')) : null }).eq('id', i.id)
    if (error) setErro(erroAmigavel(error)); else carregar()
  }
  const setM = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => mov && setMov({ ...mov, [k]: e.target.value })
  const abrirMov = (tipo: string, insumo_id = '') => setMov({ tipo, insumo_id, data: hojeISO(), quantidade: '', valor_unitario: '', fornecedor: '', nota_fiscal: '', lote_produto: '', validade: '', destino: '', pasto_id: '', obs: '' })

  return (
    <>
      <div className="titulo-acoes">
        <h1>Estoque e insumos</h1>
        <div>
          <button className="sec" onClick={() => abrirMov('Saída')}>− Saída / uso</button>
          {gestor && <button className="sec" onClick={() => abrirMov('Entrada')}>+ Entrada</button>}
          {gestor && <button className="sec" onClick={() => abrirMov('Inventário')}>Contagem (inventário)</button>}
          {gestor && <button onClick={() => setNovoIns({ nome: '', unidade: 'kg', categoria: 'Nutrição', estoque_minimo: '' })}>+ Produto</button>}
        </div>
      </div>
      <AvisoCache {...cache} />
      {erro && <p className="erro">{erro}</p>}{ok && <p className="ok">{ok}</p>}
      <div className="abas">{([['saldo', 'Saldo'], ['movimentos', 'Movimentações'], ['nutricao', 'Nutrição'], ...(gestor ? [['pedidos', 'Pedidos de compra']] : [])] as [typeof aba, string][])
        .map(([k, t]) => <button key={k} className={aba === k ? '' : 'sec'} onClick={() => setAba(k)}>{t}</button>)}</div>

      {novoIns && <form className="cartao formulario" onSubmit={criarInsumo}>
        <h2>Novo produto</h2>
        <div className="grade">
          <label>Nome *<input required value={novoIns.nome} onChange={e => setNovoIns({ ...novoIns, nome: e.target.value })} /></label>
          <label>Unidade<select value={novoIns.unidade} onChange={e => setNovoIns({ ...novoIns, unidade: e.target.value })}>{['kg', 't', 'L', 'un', 'sc', 'dz', 'm', 'dose', 'fr'].map(u => <option key={u}>{u}</option>)}</select></label>
          <label>Categoria<select value={novoIns.categoria} onChange={e => setNovoIns({ ...novoIns, categoria: e.target.value })}>{CATS.map(c => <option key={c}>{c}</option>)}</select></label>
          <label>Estoque mínimo<input inputMode="decimal" value={novoIns.estoque_minimo} onChange={e => setNovoIns({ ...novoIns, estoque_minimo: e.target.value })} /></label>
        </div>
        <div className="acoes"><button type="button" className="sec" onClick={() => setNovoIns(null)}>Cancelar</button><button>Salvar</button></div>
      </form>}

      {mov && <form className="cartao formulario" onSubmit={lancar}>
        <h2>{mov.tipo === 'Inventário' ? 'Contagem de estoque (o saldo passa a ser o número contado)' : mov.tipo}</h2>
        <div className="grade">
          <label>Produto *<select required value={mov.insumo_id} onChange={setM('insumo_id')}><option value="">Escolha…</option>{ins.map(i => <option key={i.id} value={i.id}>{i.nome} ({i.unidade})</option>)}</select></label>
          <label>Data<input type="date" required max={hojeISO()} value={mov.data} onChange={setM('data')} /></label>
          <label>{mov.tipo === 'Inventário' ? 'Quantidade contada *' : 'Quantidade *'}<input required inputMode="decimal" value={mov.quantidade} onChange={setM('quantidade')} /></label>
          {mov.tipo === 'Entrada' && <>
            <label>Valor unitário (R$)<input inputMode="decimal" value={mov.valor_unitario} onChange={setM('valor_unitario')} /></label>
            <label>Fornecedor<input value={mov.fornecedor} onChange={setM('fornecedor')} /></label>
            <label>Nota fiscal<input value={mov.nota_fiscal} onChange={setM('nota_fiscal')} /></label>
            <label>Lote do produto<input value={mov.lote_produto} onChange={setM('lote_produto')} /></label>
            <label>Validade<input type="date" value={mov.validade} onChange={setM('validade')} /></label>
          </>}
          {mov.tipo === 'Saída' && <>
            <label>Usado em / destino<input placeholder="ex.: lote paridas, cocho P13" value={mov.destino} onChange={setM('destino')} /></label>
            <label>Pasto<select value={mov.pasto_id} onChange={setM('pasto_id')}><option value="">—</option>{pastos.map(p => <option key={p.id} value={p.id}>{p.codigo}</option>)}</select></label>
          </>}
          <label>Observação<input value={mov.obs} onChange={setM('obs')} /></label>
        </div>
        <div className="acoes"><button type="button" className="sec" onClick={() => setMov(null)}>Cancelar</button><button>Lançar</button></div>
      </form>}

      {aba === 'saldo' && <section className="cartao">
        <div className="titulo-acoes">
          <select value={filtro} onChange={e => setFiltro(e.target.value)} style={{ width: 'auto' }}><option value="">Todas as categorias</option>{CATS.map(c => <option key={c}>{c}</option>)}</select>
          <button className="sec" onClick={() => baixarCSV('estoque.csv', ['Produto', 'Categoria', 'Unidade', 'Saldo', 'Mínimo', 'Último movimento', 'Última contagem'], vis.map(i => [i.nome, i.categoria, i.unidade, String(i.saldo).replace('.', ','), i.estoque_minimo, dataBR(i.ultimo_movimento), dataBR(i.data_inventario)]))}>Exportar Excel (CSV)</button>
        </div>
        {ins.some(i => !i.data_inventario) && <p className="aviso">Os produtos ainda não têm contagem inicial. Faça uma <b>Contagem (inventário)</b> de cada um para o saldo ficar certo.</p>}
        <div className="tabela-rolagem"><table className="lista">
          <thead><tr><th>Produto</th><th>Categoria</th><th className="num">Saldo</th><th className="num">Mínimo</th><th>Último mov.</th><th></th></tr></thead>
          <tbody>{vis.map(i => <tr key={i.id} className={baixo(i) ? 'pendente' : ''} title={i.obs || ''}>
            <td><b>{i.nome}</b>{baixo(i) && <small> ⚠️ abaixo do mínimo</small>}{vencendo(i) && <small> ⏰ vence {dataBR(i.proxima_validade)}</small>}{i.obs && <small> ℹ️</small>}</td>
            <td>{i.categoria}</td><td className="num"><b>{num(i.saldo, 1)} {i.unidade}</b>{!i.data_inventario && <small> (sem contagem)</small>}</td>
            <td className="num">{gestor ? <a onClick={() => definirMinimo(i)}>{i.estoque_minimo != null ? num(i.estoque_minimo, 1) : 'definir'}</a> : (i.estoque_minimo ?? '—')}</td>
            <td>{dataBR(i.ultimo_movimento)}</td>
            <td className="acoes-linha"><button className="sec mini" onClick={() => abrirMov('Saída', i.id)}>Saída</button>{gestor && <button className="sec mini" onClick={() => abrirMov('Entrada', i.id)}>Entrada</button>}</td>
          </tr>)}</tbody></table></div>
      </section>}

      {aba === 'movimentos' && <section className="cartao">
        {movs.length ? <div className="tabela-rolagem"><table><thead><tr><th>Data</th><th>Tipo</th><th>Produto</th><th className="num">Quantidade</th><th>Destino / fornecedor</th><th>Obs.</th></tr></thead>
          <tbody>{movs.map(m => <tr key={m.id}><td>{dataBR(m.data)}</td><td>{m.tipo}</td><td>{m.insumos?.nome}</td><td className="num">{m.tipo === 'Saída' ? '−' : ''}{num(m.quantidade, 1)} {m.insumos?.unidade}</td>
            <td>{m.destino || m.fornecedor || '—'}</td><td><small>{m.obs}</small></td></tr>)}</tbody></table></div> : <p className="vazio">Nenhuma movimentação lançada ainda.</p>}
      </section>}

      {aba === 'nutricao' && <>
        <section className="cartao">
          <h2>Fórmulas</h2>
          <div className="duas">{forms.map(f => <div key={f.id}><b>{f.nome}</b><table><tbody>{f.formula_itens.map((i, k) => <tr key={k}><td>{i.insumos?.nome}</td><td className="num">{num(i.percentual * 100, 1)}%</td></tr>)}</tbody></table></div>)}</div>
        </section>
        <section className="cartao">
          <h2>Plano nutricional (consumo previsto)</h2>
          {plano.length ? <div className="tabela-rolagem"><table><thead><tr><th>Mês</th><th>Categoria / lote</th><th className="num">Cabeças</th><th>Suplemento</th><th className="num">kg/cab/dia</th><th className="num">Dias</th><th className="num">Previsto</th></tr></thead>
            <tbody>{plano.map(p => <tr key={p.id}><td>{MESES[p.mes - 1]}/{p.ano}</td><td>{p.categoria}<small> {p.lote}</small></td><td className="num">{p.n_animais}</td><td>{p.suplemento_texto}</td><td className="num">{p.consumo_kg_cab_dia}</td><td className="num">{p.dias}</td><td className="num"><b>{num(p.previsto_kg, 0)} kg</b></td></tr>)}</tbody></table></div>
            : <p className="vazio">Nenhum plano.</p>}
        </section>
      </>}

      {aba === 'pedidos' && gestor && peds.map(p => <section key={p.id} className="cartao">
        <h2>{p.titulo} <small>· {dataBR(p.data)} · {p.status}</small></h2>
        {p.obs && <p><small>{p.obs}</small></p>}
        <div className="tabela-rolagem"><table><thead><tr><th>Produto</th><th className="num">Previsto</th><th className="num">Valor unit.</th><th className="num">Comprado</th><th className="num">Valor total</th></tr></thead>
          <tbody>{p.pedido_itens.map(i => <tr key={i.id}><td>{i.produto}</td><td className="num">{num(i.quantidade, 1)} {i.unidade}</td><td className="num">{reais(i.valor_unitario)}</td><td className="num">{num(i.quantidade_realizada, 1)}</td><td className="num">{reais(i.valor_total)}</td></tr>)}</tbody>
          <tfoot><tr><th colSpan={4}>Total</th><th className="num">{reais(p.pedido_itens.reduce((s, i) => s + (Number(i.valor_total) || 0), 0))}</th></tr></tfoot></table></div>
      </section>)}
    </>
  )
}
