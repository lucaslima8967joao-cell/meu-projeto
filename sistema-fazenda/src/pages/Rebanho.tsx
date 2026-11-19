import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { baixarCSV, dataBR, erroAmigavel, hojeISO } from '../lib/formato'
import { useListas } from '../lib/dados'
import { enfileirar, lerComCache, novoId, q } from '../lib/offline'
import { useAuth } from '../auth'
import { AvisoCache } from './Pendencias'

interface Linha {
  id: string; fazenda_id: string; mes: string; grupo: string; categoria: string; ordem: number
  estoque_anterior: number; nascimento: number; compra: number; transf_entrada: number; mudanca_menos: number; mudanca_mais: number
  venda: number; ajuste_inventario: number; morte: number; abate: number; estoque_atual: number
}
interface Ocorrencia { id: string; data: string; tipo: string; numero: string | null; sexo: string | null; chip: string | null; idade_texto: string | null; causa: string | null; obs: string | null }

const MOV: [keyof Linha, string][] = [['nascimento', 'Nasc.'], ['compra', 'Compra'], ['transf_entrada', 'Transf.'], ['mudanca_menos', 'Mud. −'], ['mudanca_mais', 'Mud. +'],
  ['venda', 'Venda'], ['ajuste_inventario', 'Aj. inv.'], ['morte', 'Morte'], ['abate', 'Abate']]
const calcular = (l: Linha) => l.estoque_anterior + l.nascimento + l.compra + l.transf_entrada - l.mudanca_menos + l.mudanca_mais - l.venda - l.ajuste_inventario - l.morte - l.abate
const nomeMes = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
const proximoMes = (iso: string) => { const d = new Date(iso + 'T12:00:00'); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 8) + '01' }

export default function Rebanho() {
  const { gestor } = useAuth()
  const { fazendas } = useListas()
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [mes, setMes] = useState('')
  const [edit, setEdit] = useState<Linha[] | null>(null)
  const [ocorr, setOcorr] = useState<Ocorrencia[]>([])
  const [nova, setNova] = useState({ data: hojeISO(), tipo: 'Morte', numero: '', sexo: '', chip: '', idade_texto: '', causa: '', obs: '' })
  const [cache, setCache] = useState<{ doCache: boolean; em?: string }>({ doCache: false })
  const [erro, setErro] = useState(''), [ok, setOk] = useState('')

  const carregar = useCallback(() => {
    lerComCache('rebanho_mensal', () => q<Linha[]>(supabase.from('rebanho_mensal').select('*').order('mes', { ascending: false }).order('ordem')), [] as Linha[])
      .then(r => { setLinhas(r.dados); setCache(r); setMes(m => m || r.dados[0]?.mes || '') })
    lerComCache('ocorrencias', () => q<Ocorrencia[]>(supabase.from('ocorrencias').select('*').order('data', { ascending: false }).limit(200)), [] as Ocorrencia[]).then(r => setOcorr(r.dados))
  }, [])
  useEffect(carregar, [carregar])

  const meses = useMemo(() => [...new Set(linhas.map(l => l.mes))], [linhas])
  const doMes = (edit || linhas.filter(l => l.mes === mes)).slice().sort((a, b) => a.ordem - b.ordem)
  const grupos = ['Fêmeas', 'Machos', 'Equinos']
  const soma = (ls: Linha[], k: keyof Linha) => ls.reduce((s, l) => s + Number(l[k] || 0), 0)

  function novoMes() {
    const base = linhas.filter(l => l.mes === meses[0])
    if (!base.length) return setErro('Não há mês anterior para copiar as categorias.')
    const m = proximoMes(meses[0])
    if (meses.includes(m)) return setMes(m)
    setEdit(base.map(l => ({ ...l, id: novoId(), mes: m, estoque_anterior: l.estoque_atual, nascimento: 0, compra: 0, transf_entrada: 0, mudanca_menos: 0, mudanca_mais: 0, venda: 0, ajuste_inventario: 0, morte: 0, abate: 0, estoque_atual: l.estoque_atual })))
    setMes(m)
  }
  async function salvarMes() {
    if (!edit) return
    const negativos = edit.filter(l => calcular(l) < 0)
    if (negativos.length) return setErro('Estoque ficaria negativo em: ' + negativos.map(l => l.categoria).join(', '))
    const { error } = await supabase.from('rebanho_mensal').insert(edit.map(l => ({ ...l, estoque_atual: calcular(l), origem: 'Lançado no sistema' })))
    if (error) return setErro(erroAmigavel(error) + ' (Salvar o relatório precisa de internet.)')
    setEdit(null); setOk('Relatório do mês salvo.'); carregar()
  }
  async function registrar(e: React.FormEvent) {
    e.preventDefault(); setErro('')
    const fz = fazendas[0]?.id
    if (!fz) return setErro('Cadastre a fazenda primeiro.')
    const enviado = await enfileirar({ tipo: 'insert', tabela: 'ocorrencias', dados: { id: novoId(), fazenda_id: fz, ...Object.fromEntries(Object.entries(nova).map(([k, v]) => [k, v || null])) } },
      `${nova.tipo} do animal ${nova.numero || '(sem número)'} em ${dataBR(nova.data)}`)
    setOk(enviado ? `${nova.tipo} registrada.` : `${nova.tipo} guardada no aparelho; será enviada quando houver internet.`)
    setNova({ ...nova, numero: '', chip: '', idade_texto: '', causa: '', obs: '' }); carregar()
  }
  const exportar = () => baixarCSV(`rebanho-${mes}.csv`, ['Grupo', 'Categoria', 'Estoque anterior', ...MOV.map(m => m[1]), 'Estoque atual'],
    doMes.map(l => [l.grupo, l.categoria, l.estoque_anterior, ...MOV.map(([k]) => l[k]), edit ? calcular(l) : l.estoque_atual]))

  const celula = (l: Linha, k: keyof Linha) => edit
    ? <input type="number" min="0" inputMode="numeric" className="mini-num" value={Number(l[k])} onChange={e => setEdit(edit.map(x => x.id === l.id ? { ...x, [k]: Math.max(0, Number(e.target.value) || 0) } : x))} />
    : (Number(l[k]) || '·')

  return (
    <>
      <div className="titulo-acoes">
        <h1>Rebanho — relatório mensal</h1>
        <div>
          <select value={mes} onChange={e => { setEdit(null); setMes(e.target.value) }}>{(edit ? [mes, ...meses] : meses).map(m => <option key={m} value={m}>{nomeMes(m)}</option>)}</select>
          <button className="sec" onClick={exportar} disabled={!doMes.length}>Exportar Excel (CSV)</button>
          {gestor && !edit && <button onClick={novoMes}>+ Lançar próximo mês</button>}
        </div>
      </div>
      <AvisoCache {...cache} />
      {erro && <p className="erro">{erro}</p>}{ok && <p className="ok">{ok}</p>}
      {edit && <p className="aviso">Lançando <b>{nomeMes(mes)}</b>: o estoque anterior veio do mês passado. Preencha as entradas e saídas; o estoque atual é calculado sozinho.</p>}
      {!doMes.length && <p className="vazio">Nenhum relatório lançado.</p>}
      {grupos.map(g => {
        const ls = doMes.filter(l => l.grupo === g)
        if (!ls.length) return null
        return (
          <section key={g} className="cartao">
            <h2>{g} · {edit ? ls.reduce((s, l) => s + calcular(l), 0) : soma(ls, 'estoque_atual')} cabeças</h2>
            <div className="tabela-rolagem"><table className="rel">
              <thead><tr><th>Categoria</th><th className="num">Anterior</th>{MOV.map(([, t]) => <th key={t} className="num">{t}</th>)}<th className="num">Atual</th></tr></thead>
              <tbody>{ls.map(l => <tr key={l.id}><td>{l.categoria}</td><td className="num">{l.estoque_anterior}</td>
                {MOV.map(([k]) => <td key={k} className="num">{celula(l, k)}</td>)}
                <td className="num"><b>{edit ? calcular(l) : l.estoque_atual}</b></td></tr>)}</tbody>
              <tfoot><tr><th>Subtotal</th><th className="num">{soma(ls, 'estoque_anterior')}</th>{MOV.map(([k]) => <th key={k} className="num">{soma(ls, k) || '·'}</th>)}
                <th className="num">{edit ? ls.reduce((s, l) => s + calcular(l), 0) : soma(ls, 'estoque_atual')}</th></tr></tfoot>
            </table></div>
          </section>
        )
      })}
      {doMes.length > 0 && <p><b>Total bovinos: {doMes.filter(l => l.grupo !== 'Equinos').reduce((s, l) => s + (edit ? calcular(l) : l.estoque_atual), 0)}</b> · Equinos: {doMes.filter(l => l.grupo === 'Equinos').reduce((s, l) => s + (edit ? calcular(l) : l.estoque_atual), 0)}</p>}
      {edit && <div className="acoes"><button className="sec" onClick={() => { setEdit(null); setMes(meses[0]) }}>Cancelar</button><button onClick={salvarMes}>Salvar relatório do mês</button></div>}

      <div className="duas">
        <section className="cartao">
          <h2>Registrar morte, abate ou perda</h2>
          <form className="formulario" onSubmit={registrar}>
            <div className="grade">
              <label>Tipo<select value={nova.tipo} onChange={e => setNova({ ...nova, tipo: e.target.value })}>{['Morte', 'Abate', 'Descarte', 'Perda'].map(t => <option key={t}>{t}</option>)}</select></label>
              <label>Data<input type="date" required max={hojeISO()} value={nova.data} onChange={e => setNova({ ...nova, data: e.target.value })} /></label>
              <label>Número<input value={nova.numero} onChange={e => setNova({ ...nova, numero: e.target.value })} /></label>
              <label>Sexo<select value={nova.sexo} onChange={e => setNova({ ...nova, sexo: e.target.value })}><option value="">—</option><option value="F">F</option><option value="M">M</option></select></label>
              <label>Chip<input value={nova.chip} onChange={e => setNova({ ...nova, chip: e.target.value })} /></label>
              <label>Idade<input placeholder="ex.: 24m" value={nova.idade_texto} onChange={e => setNova({ ...nova, idade_texto: e.target.value })} /></label>
              <label>Causa<input required value={nova.causa} onChange={e => setNova({ ...nova, causa: e.target.value })} /></label>
            </div>
            <div className="acoes"><button>Registrar</button></div>
          </form>
        </section>
        <section className="cartao">
          <h2>Mortes e baixas registradas</h2>
          {ocorr.length ? <table><thead><tr><th>Data</th><th>Tipo</th><th>Nº</th><th>Sexo</th><th>Idade</th><th>Causa</th></tr></thead>
            <tbody>{ocorr.map(o => <tr key={o.id} title={o.obs || ''}><td>{dataBR(o.data)}</td><td>{o.tipo}</td><td>{o.numero || '—'}{o.chip && <small> chip {o.chip}</small>}</td><td>{o.sexo || '—'}</td><td>{o.idade_texto || '—'}</td><td>{o.causa}</td></tr>)}</tbody></table>
            : <p className="vazio">Nenhuma registrada.</p>}
        </section>
      </div>
    </>
  )
}
