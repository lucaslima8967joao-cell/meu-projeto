import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { dataBR, hojeISO, kg } from '../lib/formato'
import { useAuth } from '../auth'
import { buscarTodos } from '../lib/dados'
import { lerComCache, q } from '../lib/offline'
import { AvisoCache } from './Pendencias'
import type { Animal } from '../lib/tipos'

interface Resumo {
  ativos: number; machos: number; femeas: number; porCategoria: [string, number][]
  nasc30: number; tarefasHoje: number; atrasadas: number; minhas: number
  iatfHoje: string[]; iatfProx: { data: string; titulo: string }[]; estoqueBaixo: string[]; revisoes: string[]; rebanho: number | null
  pesagens: { data: string; peso_kg: number; animal_id: string; animais: { controle: string | null; chip: string | null } | null }[]
}

export default function Painel() {
  const { perfil } = useAuth()
  const [r, setR] = useState<Resumo | null>(null)

  const [cache, setCache] = useState<{ doCache: boolean; em?: string }>({ doCache: false })
  useEffect(() => {
    const hoje = hojeISO()
    const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
    type T = { responsavel_id: string | null; data: string; status: string; titulo: string; categoria: string }
    Promise.all([
      lerComCache('v_animais', () => buscarTodos<Animal>((de, ate) => supabase.from('v_animais').select('*').eq('arquivado', false).order('controle').order('id').range(de, ate)), [] as Animal[]),
      lerComCache('painel:nasc30', () => q<{ id: string }[]>(supabase.from('nascimentos').select('id').gte('data', d30)), []),
      lerComCache('painel:tarefas', () => q<T[]>(supabase.from('tarefas').select('responsavel_id, data, status, titulo, categoria').neq('status', 'concluida').eq('arquivado', false).lte('data', new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)).order('data')), [] as T[]),
      lerComCache('painel:alertas', async () => {
        const [ins, maq, reb] = await Promise.all([
          q<{ nome: string; saldo: number; estoque_minimo: number | null }[]>(supabase.from('v_insumos').select('nome, saldo, estoque_minimo').not('estoque_minimo', 'is', null)),
          q<{ nome: string; situacao_revisao: string }[]>(supabase.from('v_maquinas').select('nome, situacao_revisao').eq('arquivado', false)),
          q<{ mes: string; grupo: string; estoque_atual: number }[]>(supabase.from('rebanho_mensal').select('mes, grupo, estoque_atual').order('mes', { ascending: false }).limit(40)),
        ])
        const ultimo = reb[0]?.mes
        return { baixo: ins.filter(i => i.estoque_minimo != null && i.saldo <= i.estoque_minimo).map(i => i.nome),
          rev: maq.filter(m => m.situacao_revisao === 'Vencida').map(m => m.nome),
          rebanho: ultimo ? reb.filter(r => r.mes === ultimo && r.grupo !== 'Equinos').reduce((s, r) => s + r.estoque_atual, 0) : null }
      }, { baixo: [] as string[], rev: [] as string[], rebanho: null as number | null }),
      lerComCache('painel:pesagens', () => q<Resumo['pesagens']>(supabase.from('pesagens').select('data, peso_kg, animal_id, animais(controle, chip)').order('criado_em', { ascending: false }).limit(8)), []),
    ]).then(([a, n, t, al, pe]) => {
      const lista = a.dados.filter(x => x.situacao === 'ativo')
      const cat = new Map<string, number>()
      lista.forEach(x => { const c = x.categoria_atual || 'Sem categoria'; cat.set(c, (cat.get(c) || 0) + 1) })
      const tarefas = t.dados.filter(x => x.data <= hoje)
      setCache({ doCache: a.doCache || t.doCache, em: a.em || t.em })
      setR({
        ativos: lista.length, machos: lista.filter(x => x.sexo === 'M').length, femeas: lista.filter(x => x.sexo === 'F').length,
        porCategoria: [...cat.entries()].sort((x, y) => y[1] - x[1]),
        nasc30: n.dados.length, tarefasHoje: tarefas.filter(x => x.data === hoje).length, atrasadas: tarefas.filter(x => x.data < hoje).length,
        minhas: tarefas.filter(x => x.responsavel_id === perfil!.id).length, pesagens: pe.dados,
        iatfHoje: t.dados.filter(x => x.categoria === 'IATF' && x.data === hoje).map(x => x.titulo.replace('IATF · ', '')),
        iatfProx: t.dados.filter(x => x.categoria === 'IATF' && x.data > hoje).slice(0, 6).map(x => ({ data: x.data, titulo: x.titulo.replace('IATF · ', '') })),
        estoqueBaixo: al.dados.baixo, revisoes: al.dados.rev, rebanho: al.dados.rebanho,
      })
    })
  }, [perfil])

  if (!r) return <p>Carregando painel…</p>
  return (
    <>
      <h1>Painel</h1>
      <AvisoCache {...cache} />
      <div className="indicadores">
        {r.rebanho != null && <Link to="/rebanho" className="ind"><b>{r.rebanho.toLocaleString('pt-BR')}</b><span>bovinos no rebanho</span><small>último relatório mensal</small></Link>}
        <Link to="/animais" className="ind"><b>{r.ativos}</b><span>animais identificados</span><small>{r.machos} machos · {r.femeas} fêmeas</small></Link>
        <Link to="/nascimento" className="ind"><b>{r.nasc30}</b><span>nascimentos</span><small>últimos 30 dias</small></Link>
        <Link to="/tarefas" className="ind"><b>{r.tarefasHoje}</b><span>tarefas para hoje</span><small>{r.minhas} pendentes com você</small></Link>
        <Link to="/tarefas" className={'ind' + (r.atrasadas ? ' alerta' : '')}><b>{r.atrasadas}</b><span>tarefas atrasadas</span></Link>
      </div>
      {(r.estoqueBaixo.length > 0 || r.revisoes.length > 0) && <p className="aviso">{r.estoqueBaixo.length > 0 && <>⚠️ Estoque baixo: <Link to="/estoque">{r.estoqueBaixo.join(', ')}</Link>. </>}{r.revisoes.length > 0 && <>🔧 Revisão vencida: <Link to="/maquinas">{r.revisoes.join(', ')}</Link>.</>}</p>}
      <section className="cartao">
        <h2>IATF</h2>
        {r.iatfHoje.length ? <p><b>Hoje:</b> {r.iatfHoje.join(' · ')}</p> : <p className="vazio">Nada de IATF hoje.</p>}
        {r.iatfProx.length > 0 && <table><tbody>{r.iatfProx.map((x, i) => <tr key={i}><td>{dataBR(x.data)}</td><td>{x.titulo}</td></tr>)}</tbody></table>}
        <Link className="botao sec" to="/tarefas?categoria=IATF">Ver calendário da IATF</Link>
      </section>
      <div className="duas">
        <section className="cartao">
          <h2>Animais identificados por categoria</h2>
          {r.porCategoria.length === 0 ? <p className="vazio">Nenhum animal cadastrado ainda.</p> :
            <table><tbody>{r.porCategoria.map(([c, q]) => <tr key={c}><td>{c}</td><td className="num">{q}</td></tr>)}</tbody></table>}
        </section>
        <section className="cartao">
          <h2>Pesagens recentes</h2>
          {r.pesagens.length === 0 ? <p className="vazio">Nenhuma pesagem registrada.</p> :
            <table><tbody>{r.pesagens.map((p, i) => (
              <tr key={i}><td>{dataBR(p.data)}</td>
                <td><Link to={`/animais/${p.animal_id}`}>{p.animais?.controle || p.animais?.chip || 'animal'}</Link></td>
                <td className="num">{kg(p.peso_kg)}</td></tr>))}</tbody></table>}
        </section>
      </div>
    </>
  )
}
