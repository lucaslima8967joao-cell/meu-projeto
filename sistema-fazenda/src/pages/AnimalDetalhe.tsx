import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { SEXO, SITUACAO, dataBR, erroAmigavel, hojeISO, idade, kg } from '../lib/formato'
import { useListas } from '../lib/dados'
import { useAuth } from '../auth'
import type { Animal, Pesagem } from '../lib/tipos'

interface Mov { id: string; data: string; motivo: string | null; origem: { codigo: string } | null; destino: { codigo: string } | null }

export default function AnimalDetalhe() {
  const { id } = useParams()
  const { gestor } = useAuth()
  const { pastos } = useListas()
  const [a, setA] = useState<Animal | null>(null)
  const [pes, setPes] = useState<Pesagem[]>([])
  const [movs, setMovs] = useState<Mov[]>([])
  const [filhos, setFilhos] = useState<Animal[]>([])
  const [nova, setNova] = useState({ data: hojeISO(), peso: '', obs: '' })
  const [mov, setMov] = useState({ data: hojeISO(), destino: '', motivo: '' })
  const [erro, setErro] = useState(''), [ok, setOk] = useState('')

  const carregar = useCallback(() => {
    supabase.from('v_animais').select('*').eq('id', id!).maybeSingle().then(r => setA(r.data as Animal))
    supabase.from('pesagens').select('*').eq('animal_id', id!).order('data', { ascending: false }).then(r => setPes((r.data as Pesagem[]) || []))
    supabase.from('movimentacoes').select('id, data, motivo, origem:pasto_origem_id(codigo), destino:pasto_destino_id(codigo)')
      .eq('animal_id', id!).order('data', { ascending: false }).then(r => setMovs((r.data as unknown as Mov[]) || []))
    supabase.from('v_animais').select('*').eq('mae_id', id!).order('nascimento', { ascending: false }).then(r => setFilhos((r.data as Animal[]) || []))
  }, [id])
  useEffect(carregar, [carregar])

  async function salvarPesagem(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setOk('')
    const peso = Number(nova.peso.replace(',', '.'))
    if (!(peso > 0 && peso < 2000)) return setErro('Informe um peso válido em kg.')
    if (nova.data > hojeISO()) return setErro('A data da pesagem não pode ser no futuro.')
    const ultimo = pes[0]?.peso_kg
    if (ultimo && Math.abs(peso - ultimo) / ultimo > 0.4 &&
      !confirm(`O peso informado (${peso} kg) é muito diferente da última pesagem (${ultimo} kg). Confirma?`)) return
    const { error } = await supabase.from('pesagens').insert({ animal_id: id, data: nova.data, peso_kg: peso, obs: nova.obs || null })
    if (error) return setErro(erroAmigavel(error))
    setNova({ data: hojeISO(), peso: '', obs: '' }); setOk('Pesagem registrada.'); carregar()
  }

  async function mover(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setOk('')
    if (!mov.destino) return setErro('Escolha o pasto de destino.')
    if (mov.destino === a?.pasto_id) return setErro('O animal já está nesse pasto.')
    const { error } = await supabase.from('movimentacoes').insert({ animal_id: id, pasto_origem_id: a?.pasto_id, pasto_destino_id: mov.destino, data: mov.data, motivo: mov.motivo || null })
    if (error) return setErro(erroAmigavel(error))
    setMov({ data: hojeISO(), destino: '', motivo: '' }); setOk('Movimentação registrada.'); carregar()
  }

  async function arquivar() {
    if (!confirm('Arquivar este animal? Ele sai das listas, mas todo o histórico continua guardado.')) return
    const { error } = await supabase.from('animais').update({ arquivado: true }).eq('id', id!)
    if (error) return setErro(erroAmigavel(error))
    location.hash = '#/animais'
  }

  if (!a) return <p>Carregando…</p>
  const gmd = pes.length >= 2 ? (pes[0].peso_kg - pes[pes.length - 1].peso_kg) /
    Math.max(1, (new Date(pes[0].data).getTime() - new Date(pes[pes.length - 1].data).getTime()) / 864e5) : null
  const max = Math.max(...pes.map(p => p.peso_kg), 1)

  return (
    <>
      <div className="titulo-acoes">
        <h1>{a.controle || a.brinco || a.chip}{a.nome ? ` · ${a.nome}` : ''}</h1>
        <div>
          <Link className="botao sec" to="/animais">← Voltar</Link>
          {gestor && <Link className="botao" to={`/animais/${a.id}/editar`}>Editar</Link>}
          {gestor && <button className="perigo" onClick={arquivar}>Arquivar</button>}
        </div>
      </div>
      {erro && <p className="erro">{erro}</p>}{ok && <p className="ok">{ok}</p>}
      <div className="duas">
        <section className="cartao">
          <h2>Identificação</h2>
          <dl className="ficha">
            <dt>Controle</dt><dd>{a.controle || '—'}</dd>
            <dt>Chip</dt><dd>{a.chip || '—'}</dd>
            <dt>Brinco</dt><dd>{a.brinco || '—'}</dd>
            <dt>Sexo</dt><dd>{SEXO[a.sexo]}</dd>
            <dt>Raça</dt><dd>{a.raca || '—'}</dd>
            <dt>Nascimento</dt><dd>{dataBR(a.nascimento)} ({idade(a.idade_meses)})</dd>
            <dt>Categoria</dt><dd>{a.categoria_atual || '—'}{a.matriz ? ' · Matriz' : ''}</dd>
            <dt>Situação</dt><dd>{SITUACAO[a.situacao]}</dd>
            <dt>Fazenda</dt><dd>{a.fazenda_nome}</dd>
            <dt>Lote</dt><dd>{a.lote_nome || '—'}</dd>
            <dt>Pasto atual</dt><dd>{a.pasto_codigo || '—'}</dd>
            <dt>Mãe</dt><dd>{a.mae_id ? <Link to={`/animais/${a.mae_id}`}>{a.mae_controle || 'ver'}</Link> : '—'}</dd>
            <dt>Pai</dt><dd>{a.pai_id ? <Link to={`/animais/${a.pai_id}`}>ver</Link> : a.pai_descricao || '—'}</dd>
            {a.obs && <><dt>Observações</dt><dd>{a.obs}</dd></>}
          </dl>
        </section>
        <section className="cartao">
          <h2>Pesagens</h2>
          <p>Último peso: <b>{kg(a.ultimo_peso_kg)}</b>{gmd !== null && <> · Ganho médio: <b>{gmd.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg/dia</b></>}</p>
          <form className="linha" onSubmit={salvarPesagem}>
            <input type="date" required max={hojeISO()} value={nova.data} onChange={e => setNova({ ...nova, data: e.target.value })} />
            <input inputMode="decimal" required placeholder="Peso (kg)" value={nova.peso} onChange={e => setNova({ ...nova, peso: e.target.value })} />
            <input placeholder="Obs." value={nova.obs} onChange={e => setNova({ ...nova, obs: e.target.value })} />
            <button>Registrar</button>
          </form>
          {pes.length ? <table><tbody>{pes.map(p => (
            <tr key={p.id}><td>{dataBR(p.data)}</td><td className="barra"><span style={{ width: `${(p.peso_kg / max) * 100}%` }} /></td>
              <td className="num">{kg(p.peso_kg)}</td><td><small>{p.obs}</small></td></tr>))}</tbody></table>
            : <p className="vazio">Nenhuma pesagem.</p>}
        </section>
      </div>
      <div className="duas">
        <section className="cartao">
          <h2>Mudar de pasto</h2>
          <form className="linha" onSubmit={mover}>
            <input type="date" required max={hojeISO()} value={mov.data} onChange={e => setMov({ ...mov, data: e.target.value })} />
            <select required value={mov.destino} onChange={e => setMov({ ...mov, destino: e.target.value })}>
              <option value="">Pasto de destino…</option>
              {pastos.filter(p => p.fazenda_id === a.fazenda_id).map(p => <option key={p.id} value={p.id}>{p.codigo}{p.nome ? ` – ${p.nome}` : ''}</option>)}
            </select>
            <input placeholder="Motivo" value={mov.motivo} onChange={e => setMov({ ...mov, motivo: e.target.value })} />
            <button>Mover</button>
          </form>
          {movs.length ? <table><tbody>{movs.map(m => <tr key={m.id}><td>{dataBR(m.data)}</td><td>{m.origem?.codigo || '—'} → {m.destino?.codigo}</td><td><small>{m.motivo}</small></td></tr>)}</tbody></table>
            : <p className="vazio">Sem movimentações.</p>}
        </section>
        {a.sexo === 'F' && <section className="cartao">
          <h2>Crias</h2>
          {filhos.length ? <table><tbody>{filhos.map(f => <tr key={f.id}><td>{dataBR(f.nascimento)}</td><td><Link to={`/animais/${f.id}`}>{f.controle || f.brinco || 'sem número'}</Link></td><td>{SEXO[f.sexo]}</td></tr>)}</tbody></table>
            : <p className="vazio">Nenhuma cria registrada.</p>}
          <Link className="botao sec" to={`/nascimento?mae=${a.id}`}>+ Registrar nascimento</Link>
        </section>}
      </div>
    </>
  )
}
