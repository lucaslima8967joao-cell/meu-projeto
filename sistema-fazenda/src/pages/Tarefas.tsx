import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PRIORIDADE, STATUS, dataBR, erroAmigavel, hojeISO } from '../lib/formato'
import { useListas } from '../lib/dados'
import { enfileirar, lerComCache, novoId, q as consulta, useSincronizacao } from '../lib/offline'
import { AvisoCache } from './Pendencias'
import { useAuth } from '../auth'
import type { Tarefa } from '../lib/tipos'

type Visao = 'hoje' | 'atrasadas' | 'proximas' | 'semana' | 'mes' | 'pessoa' | 'concluidas'
const somaDias = (iso: string, d: number) => { const x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10) }
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const VAZIA = { categoria: 'Geral', titulo: '', descricao: '', data: hojeISO(), hora: '', prioridade: 'media', pasto_id: '', local_texto: '', responsavel_id: '', equipe: '', materiais: '' }

export default function Tarefas() {
  const { perfil, gestor } = useAuth()
  const { pastos, pessoas } = useListas()
  const [visao, setVisao] = useState<Visao>('hoje')
  const [soMinhas, setSoMinhas] = useState(!gestor)
  const [params] = useSearchParams()
  const [cat, setCat] = useState(params.get('categoria') || '')
  useEffect(() => { setCat(params.get('categoria') || '') }, [params])
  const [lista, setLista] = useState<Tarefa[]>([])
  const [nova, setNova] = useState<typeof VAZIA | null>(null)
  const [erro, setErro] = useState(''), [ok, setOk] = useState('')
  const [cache, setCache] = useState<{ doCache: boolean; em?: string }>({ doCache: false })
  const { pendentes } = useSincronizacao()
  const hoje = hojeISO()

  const pedido = useRef(0)
  const carregar = useCallback(() => {
    const meu = ++pedido.current
    let q = supabase.from('tarefas').select('*').eq('arquivado', false)
    if (visao === 'hoje') q = q.eq('data', hoje)
    if (visao === 'atrasadas') q = q.lt('data', hoje).neq('status', 'concluida')
    if (visao === 'proximas') q = q.gt('data', hoje).lte('data', somaDias(hoje, 7))
    if (visao === 'semana') q = q.gte('data', hoje).lte('data', somaDias(hoje, 6))
    if (visao === 'mes') q = q.gte('data', hoje).lte('data', somaDias(hoje, 30))
    if (cat) q = q.eq('categoria', cat)
    if (visao === 'pessoa') q = q.gte('data', somaDias(hoje, -1)).neq('status', 'concluida')
    if (visao === 'concluidas') q = q.eq('status', 'concluida').gte('data', somaDias(hoje, -30))
    if (soMinhas && perfil) q = q.eq('responsavel_id', perfil.id)
    lerComCache(`tarefas:${visao}:${cat}:${soMinhas ? 'minhas' : 'todas'}`, () => consulta<Tarefa[]>(q.order('data', { ascending: visao !== 'concluidas' }).order('hora', { nullsFirst: false }).limit(500)), [] as Tarefa[])
      .then(r => {
        if (meu !== pedido.current) return // chegou uma resposta mais nova; ignora esta
        // aplica por cima as mudanças de status que ainda estão na fila do aparelho
        const mud = new Map<string, Record<string, unknown>>()
        pendentes.forEach(p => { if (p.op.tipo === 'update' && p.op.tabela === 'tarefas') mud.set(p.op.alvo, { ...(mud.get(p.op.alvo) || {}), ...p.op.dados }) })
        setLista(r.dados.map(t => (mud.has(t.id) ? { ...t, ...mud.get(t.id) } as Tarefa : t))); setCache(r)
      }, e => setErro(String(e)))
  }, [visao, soMinhas, perfil, hoje, pendentes, cat])
  useEffect(carregar, [carregar])

  async function status(t: Tarefa, s: Tarefa['status']) {
    let obs = t.obs_execucao
    if (s === 'concluida') { const o = prompt('Observação da execução (opcional):', obs || ''); if (o === null) return; obs = o || null }
    setLista(l => l.map(x => (x.id === t.id ? { ...x, status: s, obs_execucao: obs } : x))) // mostra na hora
    const enviado = await enfileirar({ tipo: 'update', tabela: 'tarefas', alvo: t.id, dados: { status: s, obs_execucao: obs } }, `Tarefa "${t.titulo}": ${STATUS[s]}`)
    setOk(enviado ? '' : 'Mudança guardada no aparelho. Será enviada quando houver internet.'); carregar()
  }
  async function arquivar(t: Tarefa) {
    if (!confirm(`Arquivar a tarefa "${t.titulo}"?`)) return
    const { error } = await supabase.from('tarefas').update({ arquivado: true }).eq('id', t.id)
    if (error) setErro(erroAmigavel(error)); else carregar()
  }
  async function criar(e: React.FormEvent) {
    e.preventDefault(); if (!nova) return
    const d = { ...nova, titulo: nova.titulo.trim(), hora: nova.hora || null, pasto_id: nova.pasto_id || null, responsavel_id: nova.responsavel_id || null,
      descricao: nova.descricao || null, local_texto: nova.local_texto || null, equipe: nova.equipe || null, materiais: nova.materiais || null }
    const enviado = await enfileirar({ tipo: 'insert', tabela: 'tarefas', dados: { id: novoId(), ...d } }, `Nova tarefa: ${d.titulo} (${d.data.split('-').reverse().join('/')})`)
    setNova(null); setErro(''); setOk(enviado ? 'Tarefa criada.' : 'Tarefa guardada no aparelho. Será enviada quando houver internet.'); carregar()
  }

  const nomeDe = (id: string | null) => pessoas.find(p => p.id === id)?.nome || pessoas.find(p => p.id === id)?.email || 'Sem responsável'
  const pastoDe = (id: string | null) => pastos.find(p => p.id === id)?.codigo
  const setN = (k: keyof typeof VAZIA) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => nova && setNova({ ...nova, [k]: e.target.value })

  const cartao = (t: Tarefa) => (
    <div key={t.id} className={`tarefa p-${t.prioridade} s-${t.status}${t.data < hoje && t.status !== 'concluida' ? ' atrasada' : ''}`}>
      <div className="t-topo"><b>{t.titulo}</b>{t.categoria && t.categoria !== 'Geral' && <span className="etiqueta">{t.categoria}</span>}<span className="etiqueta">{PRIORIDADE[t.prioridade]}</span></div>
      <small>{dataBR(t.data)}{t.hora ? ` · ${t.hora.slice(0, 5)}` : ''} · {nomeDe(t.responsavel_id)}{t.equipe ? ` (${t.equipe})` : ''}
        {(pastoDe(t.pasto_id) || t.local_texto) && ` · 📍 ${[pastoDe(t.pasto_id), t.local_texto].filter(Boolean).join(' – ')}`}</small>
      {t.descricao && <p>{t.descricao}</p>}
      {t.materiais && <p><small>🧰 {t.materiais}</small></p>}
      {t.obs_execucao && <p><small>📝 {t.obs_execucao}</small></p>}
      <div className="t-acoes">
        <span className={`status st-${t.status}`}>{STATUS[t.status]}</span>
        {(gestor || t.responsavel_id === perfil?.id) && <>
          {t.status !== 'andamento' && t.status !== 'concluida' && <button className="sec mini" onClick={() => status(t, 'andamento')}>Iniciar</button>}
          {t.status !== 'concluida' && <button className="mini" onClick={() => status(t, 'concluida')}>Concluir</button>}
          {t.status === 'concluida' && <button className="sec mini" onClick={() => status(t, 'pendente')}>Reabrir</button>}
        </>}
        {gestor && <button className="perigo mini" onClick={() => arquivar(t)}>Arquivar</button>}
      </div>
    </div>
  )

  const grupos: [string, Tarefa[]][] = visao === 'semana'
    ? Array.from({ length: 7 }, (_, i) => { const d = somaDias(hoje, i); return [`${DIAS[new Date(d + 'T12:00:00').getDay()]} ${dataBR(d)}`, lista.filter(t => t.data === d)] as [string, Tarefa[]] })
    : visao === 'pessoa'
      ? [...new Set(lista.map(t => t.responsavel_id))].map(id => [nomeDe(id), lista.filter(t => t.responsavel_id === id)] as [string, Tarefa[]])
      : [['', lista]]

  return (
    <>
      <div className="titulo-acoes">
        <h1>Tarefas</h1>
        {gestor && <button onClick={() => setNova({ ...VAZIA })}>+ Nova tarefa</button>}
      </div>
      <div className="abas">
        {([['hoje', 'Hoje'], ['atrasadas', 'Atrasadas'], ['proximas', 'Próximos 7 dias'], ['semana', 'Semana'], ['mes', 'Próximos 30 dias'], ['pessoa', 'Por colaborador'], ['concluidas', 'Concluídas']] as [Visao, string][])
          .map(([k, t]) => <button key={k} className={visao === k ? '' : 'sec'} onClick={() => setVisao(k)}>{t}</button>)}
        <select value={cat} onChange={e => setCat(e.target.value)} style={{ width: 'auto' }}><option value="">Todas as categorias</option>{['Geral', 'IATF', 'Manejo', 'Pastagem', 'Cerca', 'Máquinas', 'Nutrição'].map(c => <option key={c}>{c}</option>)}</select>
        <label className="check"><input type="checkbox" checked={soMinhas} onChange={e => setSoMinhas(e.target.checked)} /> Só as minhas</label>
      </div>
      <AvisoCache {...cache} />
      {erro && <p className="erro">{erro}</p>}{ok && <p className="ok">{ok}</p>}

      {nova && <form className="cartao formulario" onSubmit={criar}>
        <h2>Nova tarefa</h2>
        <label>O que fazer *<input required value={nova.titulo} onChange={setN('titulo')} /></label>
        <label>Detalhes<textarea rows={2} value={nova.descricao} onChange={setN('descricao')} /></label>
        <div className="grade">
          <label>Categoria<select value={nova.categoria} onChange={setN('categoria')}>{['Geral', 'IATF', 'Manejo', 'Pastagem', 'Cerca', 'Máquinas', 'Nutrição'].map(c => <option key={c}>{c}</option>)}</select></label>
          <label>Data *<input type="date" required value={nova.data} onChange={setN('data')} /></label>
          <label>Horário<input type="time" value={nova.hora} onChange={setN('hora')} /></label>
          <label>Prioridade<select value={nova.prioridade} onChange={setN('prioridade')}>{Object.entries(PRIORIDADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Responsável<select value={nova.responsavel_id} onChange={setN('responsavel_id')}><option value="">—</option>{pessoas.map(p => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}</select></label>
          <label>Equipe<input value={nova.equipe} onChange={setN('equipe')} /></label>
          <label>Pasto<select value={nova.pasto_id} onChange={setN('pasto_id')}><option value="">—</option>{pastos.map(p => <option key={p.id} value={p.id}>{p.codigo}</option>)}</select></label>
          <label>Outro local<input value={nova.local_texto} onChange={setN('local_texto')} /></label>
          <label>Materiais / equipamentos<input value={nova.materiais} onChange={setN('materiais')} /></label>
        </div>
        <div className="acoes"><button type="button" className="sec" onClick={() => setNova(null)}>Cancelar</button><button>Criar tarefa</button></div>
      </form>}

      {grupos.map(([titulo, ts]) => (
        <section key={titulo || 'todas'} className={titulo ? 'grupo' : ''}>
          {titulo && <h2>{titulo} <small>({ts.length})</small></h2>}
          <div className="tarefas">{ts.map(cartao)}</div>
          {!ts.length && <p className="vazio">Nenhuma tarefa.</p>}
        </section>
      ))}
    </>
  )
}
