import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { baixarCSV, dataBR, idade, kg, num, reais } from '../lib/formato'
import type { Venda, VendaItem } from '../lib/tipos'

const SEXO_V: Record<string, string> = { M: 'Macho', F: 'Fêmea', Misto: 'Misto' }
const mesesEntre = (nasc: string | null, data: string) => {
  if (!nasc) return null
  const a = new Date(nasc + 'T12:00:00'), b = new Date(data + 'T12:00:00')
  return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() - (b.getDate() < a.getDate() ? 1 : 0)
}

export function Vendas() {
  const [lista, setLista] = useState<Venda[] | null>(null)
  const [ano, setAno] = useState(String(new Date().getFullYear()))
  useEffect(() => {
    supabase.from('vendas').select('*').eq('arquivado', false).gte('data', `${ano}-01-01`).lte('data', `${ano}-12-31`).order('data')
      .then(r => setLista((r.data as Venda[]) || []))
  }, [ano])
  if (!lista) return <p>Carregando…</p>
  const t = (k: keyof Venda) => lista.reduce((s, v) => s + (Number(v[k]) || 0), 0)
  const exportar = () => baixarCSV(`vendas-${ano}.csv`, ['Data', 'Comprador', 'NFs', 'Sexo', 'Categoria', 'Cabeças', 'Peso balança (kg)', 'Peso frigorífico (kg)', 'Rendimento %', 'Média (@)', 'Valor @', 'Valor total', 'Obs.'],
    lista.map(v => [dataBR(v.data), v.comprador, v.notas_fiscais, SEXO_V[v.sexo || ''] || v.sexo, v.categoria, v.quantidade, v.peso_balanca_kg, v.peso_frigorifico_kg, v.rendimento_pct, v.media_arroba, v.valor_arroba, v.valor_total, v.obs]
      .map(x => typeof x === 'number' ? String(x).replace('.', ',') : x)))
  return (
    <>
      <div className="titulo-acoes">
        <h1>Vendas</h1>
        <div>
          <select value={ano} onChange={e => setAno(e.target.value)}>{[0, 1, 2].map(i => String(new Date().getFullYear() - i)).map(a => <option key={a}>{a}</option>)}</select>
          <button className="sec" onClick={exportar} disabled={!lista.length}>Exportar Excel (CSV)</button>
        </div>
      </div>
      <div className="indicadores">
        <div className="ind"><b>{lista.length}</b><span>vendas em {ano}</span></div>
        <div className="ind"><b>{num(t('quantidade'), 0)}</b><span>cabeças vendidas</span></div>
        <div className="ind"><b>{reais(t('valor_total'))}</b><span>valor total</span></div>
      </div>
      <div className="tabela-rolagem"><table className="lista">
        <thead><tr><th>Data</th><th>Comprador</th><th>NFs</th><th>Lote</th><th className="num">Cabeças</th><th className="num">Peso balança</th><th className="num">Média @</th><th className="num">Valor @</th><th className="num">Valor total</th></tr></thead>
        <tbody>{lista.map(v => <tr key={v.id} onClick={() => (location.hash = `#/vendas/${v.id}`)}>
          <td><Link to={`/vendas/${v.id}`}>{dataBR(v.data)}</Link>{v.obs && <small> ⚠️</small>}</td><td>{v.comprador}</td><td>{v.notas_fiscais || '—'}</td>
          <td>{SEXO_V[v.sexo || ''] || ''} · {v.categoria}</td><td className="num">{v.quantidade}</td><td className="num">{kg(v.peso_balanca_kg)}</td>
          <td className="num">{num(v.media_arroba)}</td><td className="num">{v.valor_arroba ? reais(v.valor_arroba) : '—'}</td><td className="num"><b>{reais(v.valor_total)}</b></td>
        </tr>)}</tbody>
        {lista.length > 0 && <tfoot><tr><th colSpan={4}>Total</th><th className="num">{num(t('quantidade'), 0)}</th><th className="num">{kg(t('peso_balanca_kg'))}</th><th></th><th></th><th className="num">{reais(t('valor_total'))}</th></tr></tfoot>}
      </table></div>
      {!lista.length && <p className="vazio">Nenhuma venda em {ano}.</p>}
      <p><small>Lançamento de novas vendas e compras entra na próxima etapa. ⚠️ = venda com observação.</small></p>
    </>
  )
}

export function VendaDetalhe() {
  const { id } = useParams()
  const [v, setV] = useState<Venda | null>(null)
  const [itens, setItens] = useState<VendaItem[]>([])
  useEffect(() => {
    supabase.from('vendas').select('*').eq('id', id!).single().then(r => setV(r.data as Venda))
    supabase.from('venda_itens').select('*').eq('venda_id', id!).order('ordem').then(r => setItens((r.data as VendaItem[]) || []))
  }, [id])
  if (!v) return <p>Carregando…</p>
  const comPeso = itens.filter(i => i.peso_kg)
  const exportar = () => baixarCSV(`venda-${v.data}-${v.comprador}.csv`, ['Nº', 'Controle', 'Chip', 'Peso (kg)', 'Raça', 'Nascimento', 'Idade na venda (meses)', 'Obs.'],
    itens.map(i => [i.ordem, i.controle, i.chip, i.peso_kg?.toString().replace('.', ','), i.raca, dataBR(i.nascimento), mesesEntre(i.nascimento, v.data), i.obs]))
  return (
    <>
      <div className="titulo-acoes">
        <h1>Venda {dataBR(v.data)} · {v.comprador}</h1>
        <div><Link className="botao sec" to="/vendas">← Voltar</Link><button className="sec" onClick={exportar}>Exportar Excel (CSV)</button></div>
      </div>
      {v.obs && <p className="aviso">⚠️ {v.obs}</p>}
      <div className="duas">
        <section className="cartao"><dl className="ficha">
          <dt>Notas fiscais</dt><dd>{v.notas_fiscais || '—'}</dd>
          <dt>Animais</dt><dd>{SEXO_V[v.sexo || '']} · {v.categoria} · {v.quantidade} cab.</dd>
          <dt>Peso balança</dt><dd>{kg(v.peso_balanca_kg)}{comPeso.length > 0 && <small> (média {kg(comPeso.reduce((s, i) => s + Number(i.peso_kg), 0) / comPeso.length)} por cabeça)</small>}</dd>
          {v.peso_frigorifico_kg && <><dt>Peso frigorífico</dt><dd>{kg(v.peso_frigorifico_kg)}</dd></>}
          {v.rendimento_pct && <><dt>Rendimento</dt><dd>{num(v.rendimento_pct, 1)}%</dd></>}
        </dl></section>
        <section className="cartao"><dl className="ficha">
          <dt>Média</dt><dd>{num(v.media_arroba)} @/cab.</dd>
          <dt>Valor da @</dt><dd>{v.valor_arroba ? reais(v.valor_arroba) : '—'}</dd>
          <dt>Valor por cabeça</dt><dd>{v.valor_total && v.quantidade ? reais(v.valor_total / v.quantidade) : '—'}</dd>
          <dt>Valor total</dt><dd><b>{reais(v.valor_total)}</b></dd>
          {v.origem && <><dt>Origem</dt><dd><small>{v.origem}</small></dd></>}
        </dl></section>
      </div>
      <section className="cartao">
        <h2>Animais ({itens.length})</h2>
        <div className="tabela-rolagem"><table>
          <thead><tr><th>Nº</th><th>Controle</th><th>Chip</th><th className="num">Peso</th><th>Raça</th><th>Nascimento</th><th>Idade na venda</th><th>Obs.</th></tr></thead>
          <tbody>{itens.map(i => <tr key={i.id} className={i.obs ? 'pendente' : ''}>
            <td>{i.ordem}</td><td><b>{i.controle}</b></td><td>{i.chip || '—'}</td><td className="num">{kg(i.peso_kg)}</td><td>{i.raca}</td>
            <td>{dataBR(i.nascimento)}</td><td>{idade(mesesEntre(i.nascimento, v.data))}</td><td><small>{i.obs}</small></td></tr>)}</tbody>
        </table></div>
      </section>
    </>
  )
}
