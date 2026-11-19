import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { buscarTodos } from '../lib/dados'
import { lerComCache, q } from '../lib/offline'
import { dataBR } from '../lib/formato'
import type { Animal, Pasto, Tarefa } from '../lib/tipos'

interface Resultado { tipo: string; titulo: string; detalhe: string; link: string }

/** Busca geral: animais, áreas, máquinas, serviços, tarefas, produtos e vendas — funciona com os dados guardados no aparelho. */
export default function Busca() {
  const [params, setParams] = useSearchParams()
  const [texto, setTexto] = useState(params.get('q') || '')
  const [base, setBase] = useState<{ animais: Animal[]; pastos: Pasto[]; maquinas: { id: string; nome: string; modelo: string | null; placa_serie: string | null }[];
    servicos: { id: string; titulo: string; tipo: string; local_texto: string | null }[]; tarefas: Tarefa[]; insumos: { id: string; nome: string; categoria: string | null }[];
    vendas: { id: string; data: string; comprador: string; notas_fiscais: string | null }[] } | null>(null)

  useEffect(() => {
    Promise.all([
      lerComCache('v_animais', () => buscarTodos<Animal>((de, ate) => supabase.from('v_animais').select('*').eq('arquivado', false).order('controle').order('id').range(de, ate)), [] as Animal[]),
      lerComCache('v_pastos', () => buscarTodos<Pasto>((de, ate) => supabase.from('v_pastos').select('*').eq('arquivado', false).order('codigo').range(de, ate)), [] as Pasto[]),
      lerComCache('busca:maquinas', () => q<{ id: string; nome: string; modelo: string | null; placa_serie: string | null }[]>(supabase.from('maquinas').select('id, nome, modelo, placa_serie').eq('arquivado', false)), []),
      lerComCache('busca:servicos', () => q<{ id: string; titulo: string; tipo: string; local_texto: string | null }[]>(supabase.from('servicos').select('id, titulo, tipo, local_texto').eq('arquivado', false)), []),
      lerComCache('busca:tarefas', () => q<Tarefa[]>(supabase.from('tarefas').select('*').eq('arquivado', false).order('data', { ascending: false }).limit(1000)), [] as Tarefa[]),
      lerComCache('busca:insumos', () => q<{ id: string; nome: string; categoria: string | null }[]>(supabase.from('insumos').select('id, nome, categoria').eq('arquivado', false)), []),
      lerComCache('busca:vendas', () => q<{ id: string; data: string; comprador: string; notas_fiscais: string | null }[]>(supabase.from('vendas').select('id, data, comprador, notas_fiscais').eq('arquivado', false)), []),
    ]).then(([a, p, m, s, t, i, v]) => setBase({ animais: a.dados, pastos: p.dados, maquinas: m.dados, servicos: s.dados, tarefas: t.dados, insumos: i.dados, vendas: v.dados }))
  }, [])

  const res = useMemo<Resultado[]>(() => {
    const t = texto.trim().toLowerCase()
    if (!base || t.length < 2) return []
    const tem = (...v: (string | null | undefined)[]) => v.some(x => x?.toLowerCase().includes(t))
    return [
      ...base.animais.filter(a => tem(a.controle, a.chip, a.brinco, a.nome)).slice(0, 30).map(a => ({ tipo: a.especie === 'Equino' ? 'Cavalo' : 'Animal', titulo: a.controle || a.chip || a.brinco || '—', detalhe: [a.nome, a.categoria_atual, a.pasto_codigo, a.situacao].filter(Boolean).join(' · '), link: `/animais/${a.id}` })),
      ...base.pastos.filter(p => tem(p.codigo, p.codigo_antigo, p.nome)).map(p => ({ tipo: 'Área', titulo: p.codigo, detalhe: [p.tipo, p.codigo_antigo && `nº antigo ${p.codigo_antigo}`, p.area_ha && `${p.area_ha} ha`].filter(Boolean).join(' · '), link: '/pastos' })),
      ...base.maquinas.filter(m => tem(m.nome, m.modelo, m.placa_serie)).map(m => ({ tipo: 'Máquina', titulo: m.nome, detalhe: [m.modelo, m.placa_serie].filter(Boolean).join(' · '), link: '/maquinas' })),
      ...base.servicos.filter(s => tem(s.titulo, s.local_texto)).slice(0, 20).map(s => ({ tipo: 'Serviço', titulo: s.titulo, detalhe: s.tipo, link: '/servicos' })),
      ...base.insumos.filter(i => tem(i.nome)).map(i => ({ tipo: 'Produto', titulo: i.nome, detalhe: i.categoria || '', link: '/estoque' })),
      ...base.vendas.filter(v => tem(v.comprador, v.notas_fiscais)).map(v => ({ tipo: 'Venda', titulo: `${dataBR(v.data)} · ${v.comprador}`, detalhe: v.notas_fiscais ? `NF ${v.notas_fiscais}` : '', link: `/vendas/${v.id}` })),
      ...base.tarefas.filter(x => tem(x.titulo, x.descricao, x.local_texto)).slice(0, 20).map(x => ({ tipo: 'Tarefa', titulo: x.titulo, detalhe: dataBR(x.data), link: '/tarefas' })),
    ]
  }, [texto, base])

  return (
    <>
      <h1>Buscar</h1>
      <input className="busca" autoFocus placeholder="Número do animal, chip, pasto, máquina, produto, comprador…" value={texto}
        onChange={e => { setTexto(e.target.value); setParams(e.target.value ? { q: e.target.value } : {}, { replace: true }) }} />
      {!base && <p>Carregando…</p>}
      {base && texto.trim().length >= 2 && !res.length && <p className="vazio">Nada encontrado.</p>}
      <div className="tabela-rolagem"><table className="lista"><tbody>{res.map((r, i) => <tr key={i} onClick={() => (location.hash = '#' + r.link)}>
        <td><span className="etiqueta">{r.tipo}</span></td><td><Link to={r.link}><b>{r.titulo}</b></Link></td><td><small>{r.detalhe}</small></td></tr>)}</tbody></table></div>
    </>
  )
}
