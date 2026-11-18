import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { dataBR, hojeISO, kg } from '../lib/formato'
import { useAuth } from '../auth'
import { buscarTodos } from '../lib/dados'

interface Resumo {
  ativos: number; machos: number; femeas: number; porCategoria: [string, number][]
  nasc30: number; tarefasHoje: number; atrasadas: number; minhas: number
  pesagens: { data: string; peso_kg: number; animal_id: string; animais: { controle: string | null; chip: string | null } | null }[]
}

export default function Painel() {
  const { perfil } = useAuth()
  const [r, setR] = useState<Resumo | null>(null)

  useEffect(() => {
    const hoje = hojeISO()
    const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
    Promise.all([
      buscarTodos<{ sexo: string; categoria: string | null }>((de, ate) => supabase.from('v_animais').select('sexo, categoria:categoria_atual').eq('situacao', 'ativo').eq('arquivado', false).order('id').range(de, ate)),
      supabase.from('nascimentos').select('id', { count: 'exact', head: true }).gte('data', d30),
      supabase.from('tarefas').select('id', { count: 'exact', head: true }).eq('data', hoje).neq('status', 'concluida').eq('arquivado', false),
      supabase.from('tarefas').select('id', { count: 'exact', head: true }).lt('data', hoje).neq('status', 'concluida').eq('arquivado', false),
      supabase.from('tarefas').select('id', { count: 'exact', head: true }).eq('responsavel_id', perfil!.id).neq('status', 'concluida').eq('arquivado', false),
      supabase.from('pesagens').select('data, peso_kg, animal_id, animais(controle, chip)').order('criado_em', { ascending: false }).limit(8),
    ]).then(([a, n, th, at, mi, pe]) => {
      const lista = a
      const cat = new Map<string, number>()
      lista.forEach(x => cat.set(x.categoria || 'Sem categoria', (cat.get(x.categoria || 'Sem categoria') || 0) + 1))
      setR({
        ativos: lista.length, machos: lista.filter(x => x.sexo === 'M').length, femeas: lista.filter(x => x.sexo === 'F').length,
        porCategoria: [...cat.entries()].sort((x, y) => y[1] - x[1]),
        nasc30: n.count || 0, tarefasHoje: th.count || 0, atrasadas: at.count || 0, minhas: mi.count || 0,
        pesagens: (pe.data || []) as unknown as Resumo['pesagens'],
      })
    })
  }, [perfil])

  if (!r) return <p>Carregando…</p>
  return (
    <>
      <h1>Painel</h1>
      <div className="indicadores">
        <Link to="/animais" className="ind"><b>{r.ativos}</b><span>animais ativos</span><small>{r.machos} machos · {r.femeas} fêmeas</small></Link>
        <Link to="/nascimento" className="ind"><b>{r.nasc30}</b><span>nascimentos</span><small>últimos 30 dias</small></Link>
        <Link to="/tarefas" className="ind"><b>{r.tarefasHoje}</b><span>tarefas para hoje</span><small>{r.minhas} com você</small></Link>
        <Link to="/tarefas" className={'ind' + (r.atrasadas ? ' alerta' : '')}><b>{r.atrasadas}</b><span>tarefas atrasadas</span></Link>
      </div>
      <div className="duas">
        <section className="cartao">
          <h2>Rebanho por categoria</h2>
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
