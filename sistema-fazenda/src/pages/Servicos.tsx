import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { baixarCSV, dataBR, hojeISO, num, ordemNatural, reais } from '../lib/formato'
import { useListas } from '../lib/dados'
import { enfileirar, lerComCache, novoId, q } from '../lib/offline'
import { useAuth } from '../auth'
import { AvisoCache } from './Pendencias'

interface Item { id: string; servico_id: string; produto: string; dose: number | null; unidade_dose: string | null; quantidade: number | null; unidade: string | null; valor_total: number | null }
interface Servico {
  id: string; tipo: string; titulo: string; safra: string | null; prioridade: number | null; pasto_id: string | null; local_texto: string | null
  area_ha: number | null; metragem_m: number | null; status: string; data_prevista: string | null; data_realizada: string | null
  custo_material_previsto: number | null; custo_mo_previsto: number | null; custo_realizado: number | null; responsavel_id: string | null
  equipamento: string | null; descricao: string | null; obs: string | null; servico_itens?: Item[]
}
const TIPOS = ['Manutenção de pasto', 'Reforma de pasto', 'Cerca', 'Benfeitoria', 'Roçada', 'Outro']
const STATUS = ['Planejado', 'Em andamento', 'Concluído', 'Cancelado']

export default function Servicos() {
  const { gestor, perfil } = useAuth()
  const { fazendas, pastos, pessoas } = useListas()
  const [lista, setLista] = useState<Servico[]>([])
  const [f, setF] = useState({ tipo: '', status: '' })
  const [aberto, setAberto] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)  // confirmação no próprio cartão (sem janela do celular)
  const [novo, setNovo] = useState<Record<string, string> | null>(null)
  const [cache, setCache] = useState<{ doCache: boolean; em?: string }>({ doCache: false })
  const [erro, setErro] = useState(''), [ok, setOk] = useState('')

  const carregar = useCallback(() => {
    lerComCache('servicos', () => q<Servico[]>(supabase.from('servicos').select('*, servico_itens(*)').eq('arquivado', false).order('tipo').order('prioridade', { nullsFirst: false })), [] as Servico[])
      .then(r => { setLista(r.dados); setCache(r) })
  }, [])
  useEffect(carregar, [carregar])

  const vis = useMemo(() => lista.filter(s => (!f.tipo || s.tipo === f.tipo) && (!f.status || s.status === f.status))
    .sort((a, b) => a.tipo.localeCompare(b.tipo) || (a.prioridade ?? 999) - (b.prioridade ?? 999) || ordemNatural(a.titulo, b.titulo)), [lista, f])
  const tot = (k: keyof Servico) => vis.reduce((s, x) => s + (Number(x[k]) || 0), 0)

  async function mudarStatus(s: Servico, status: string) {
    const dados: Record<string, unknown> = { status }
    setConfirmando(null)
    if (status === 'Planejado') { dados.data_realizada = null }
    if (status === 'Concluído') {
      const c = prompt('Custo realizado (R$), se souber:', s.custo_realizado?.toString() || '')
      if (c === null) return
      if (c.trim()) dados.custo_realizado = Number(c.replace(/\./g, '').replace(',', '.'))
      dados.data_realizada = hojeISO()
    }
    setLista(l => l.map(x => x.id === s.id ? { ...x, ...dados } as Servico : x))
    const enviado = await enfileirar({ tipo: 'update', tabela: 'servicos', alvo: s.id, dados }, `Serviço "${s.titulo}": ${status}`)
    setOk(enviado ? 'Atualizado.' : 'Guardado no aparelho; será enviado quando houver internet.')
  }
  async function criar(e: React.FormEvent) {
    e.preventDefault(); if (!novo) return
    if (!fazendas[0]) return setErro('Cadastre a fazenda primeiro.')
    const n = (v: string) => (v ? Number(v.replace(/\./g, '').replace(',', '.')) : null)
    const pasto = pastos.find(p => p.id === novo.pasto_id)
    const enviado = await enfileirar({ tipo: 'insert', tabela: 'servicos', dados: {
      id: novoId(), fazenda_id: fazendas[0]?.id, tipo: novo.tipo, titulo: novo.titulo, safra: novo.safra || null, pasto_id: novo.pasto_id || null,
      local_texto: pasto?.codigo || novo.local_texto || null, area_ha: n(novo.area_ha), metragem_m: n(novo.metragem_m), data_prevista: novo.data_prevista || null,
      custo_material_previsto: n(novo.custo_material_previsto), custo_mo_previsto: n(novo.custo_mo_previsto), responsavel_id: novo.responsavel_id || null,
      equipamento: novo.equipamento || null, descricao: novo.descricao || null } }, `Novo serviço: ${novo.titulo}`)
    setNovo(null); setOk(enviado ? 'Serviço cadastrado.' : 'Guardado no aparelho; será enviado quando houver internet.'); carregar()
  }
  const exportar = () => baixarCSV('servicos.csv', ['Tipo', 'Prioridade', 'Serviço', 'Local', 'Área (ha)', 'Metragem (m)', 'Status', 'Previsto', 'Realizado em', 'Material previsto', 'M.O. prevista', 'Custo realizado', 'Produtos'],
    vis.map(s => [s.tipo, s.prioridade, s.titulo, s.local_texto, s.area_ha, s.metragem_m, s.status, dataBR(s.data_prevista), dataBR(s.data_realizada), s.custo_material_previsto, s.custo_mo_previsto, s.custo_realizado,
      (s.servico_itens || []).map(i => `${i.produto}: ${i.dose ?? ''} ${i.unidade_dose ?? ''} = ${i.quantidade ?? ''} ${i.unidade ?? ''}`).join(' | ')]
      .map(v => typeof v === 'number' ? String(v).replace('.', ',') : v)))
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => novo && setNovo({ ...novo, [k]: e.target.value })

  return (
    <>
      <div className="titulo-acoes">
        <h1>Serviços — pastagens, cercas e benfeitorias</h1>
        <div>
          <button className="sec" onClick={exportar} disabled={!vis.length}>Exportar Excel (CSV)</button>
          {gestor && <button onClick={() => setNovo({ tipo: 'Manutenção de pasto', titulo: '', safra: '', pasto_id: '', local_texto: '', area_ha: '', metragem_m: '', data_prevista: '', custo_material_previsto: '', custo_mo_previsto: '', responsavel_id: '', equipamento: '', descricao: '' })}>+ Novo serviço</button>}
        </div>
      </div>
      <AvisoCache {...cache} />
      {erro && <p className="erro">{erro}</p>}{ok && <p className="ok">{ok}</p>}
      <div className="filtros">
        <select value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })}><option value="">Todos os tipos</option>{TIPOS.map(t => <option key={t}>{t}</option>)}</select>
        <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">Todas as situações</option>{STATUS.map(t => <option key={t}>{t}</option>)}</select>
      </div>
      <div className="indicadores">
        <div className="ind"><b>{vis.length}</b><span>serviços</span><small>{vis.filter(s => s.status === 'Concluído').length} concluídos</small></div>
        <div className="ind"><b>{num(tot('area_ha'), 0)}</b><span>hectares</span></div>
        <div className="ind"><b>{num(tot('metragem_m') / 1000, 1)}</b><span>km de cerca</span></div>
        {gestor && <div className="ind"><b>{reais(tot('custo_material_previsto') + tot('custo_mo_previsto'))}</b><span>previsto (material + M.O.)</span><small>realizado {reais(tot('custo_realizado'))}</small></div>}
      </div>

      {novo && <form className="cartao formulario" onSubmit={criar}>
        <h2>Novo serviço</h2>
        <div className="grade">
          <label>Tipo<select value={novo.tipo} onChange={set('tipo')}>{TIPOS.map(t => <option key={t}>{t}</option>)}</select></label>
          <label>Descrição curta *<input required value={novo.titulo} onChange={set('titulo')} /></label>
          <label>Pasto<select value={novo.pasto_id} onChange={set('pasto_id')}><option value="">—</option>{pastos.map(p => <option key={p.id} value={p.id}>{p.codigo}</option>)}</select></label>
          <label>Outro local<input value={novo.local_texto} onChange={set('local_texto')} /></label>
          <label>Safra<input placeholder="2026/27" value={novo.safra} onChange={set('safra')} /></label>
          <label>Área (ha)<input inputMode="decimal" value={novo.area_ha} onChange={set('area_ha')} /></label>
          <label>Metragem (m)<input inputMode="decimal" value={novo.metragem_m} onChange={set('metragem_m')} /></label>
          <label>Data prevista<input type="date" value={novo.data_prevista} onChange={set('data_prevista')} /></label>
          <label>Material previsto (R$)<input inputMode="decimal" value={novo.custo_material_previsto} onChange={set('custo_material_previsto')} /></label>
          <label>Mão de obra prevista (R$)<input inputMode="decimal" value={novo.custo_mo_previsto} onChange={set('custo_mo_previsto')} /></label>
          <label>Responsável<select value={novo.responsavel_id} onChange={set('responsavel_id')}><option value="">—</option>{pessoas.map(p => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}</select></label>
          <label>Equipamento<input value={novo.equipamento} onChange={set('equipamento')} /></label>
        </div>
        <label>Materiais / detalhes<textarea rows={3} value={novo.descricao} onChange={set('descricao')} /></label>
        <div className="acoes"><button type="button" className="sec" onClick={() => setNovo(null)}>Cancelar</button><button>Salvar</button></div>
      </form>}

      <div className="tarefas">{vis.map(s => {
        const pode = gestor || s.responsavel_id === perfil?.id
        return (
          <div key={s.id} className={`tarefa s-${s.status === 'Concluído' ? 'concluida' : 'pendente'}`}>
            <div className="t-topo"><b>{s.prioridade ? `${s.prioridade}º · ` : ''}{s.titulo}</b><span className="etiqueta">{s.tipo}</span></div>
            <small>{[s.local_texto && `📍 ${s.local_texto}`, s.area_ha && `${num(s.area_ha)} ha`, s.metragem_m && `${num(s.metragem_m, 0)} m`, s.safra && `safra ${s.safra}`, s.data_prevista && `previsto ${dataBR(s.data_prevista)}`].filter(Boolean).join(' · ')}</small>
            {gestor && (s.custo_material_previsto || s.custo_mo_previsto) ? <p><small>Material {reais(s.custo_material_previsto)}{s.custo_mo_previsto ? ` · M.O. ${reais(s.custo_mo_previsto)}` : ''}{s.custo_realizado ? ` · realizado ${reais(s.custo_realizado)}` : ''}</small></p> : null}
            {(s.servico_itens?.length || s.descricao) && <button className="sec mini" onClick={() => setAberto(aberto === s.id ? null : s.id)}>{aberto === s.id ? 'Esconder' : 'Ver'} produtos/materiais</button>}
            {aberto === s.id && <div>
              {s.servico_itens && s.servico_itens.length > 0 && <table><tbody>{s.servico_itens.map(i => <tr key={i.id}><td>{i.produto}</td><td className="num">{i.dose != null ? `${num(i.dose, 2)} ${i.unidade_dose || ''}` : ''}</td><td className="num"><b>{i.quantidade != null ? `${num(i.quantidade, 1)} ${i.unidade || ''}` : ''}</b></td></tr>)}</tbody></table>}
              {s.descricao && <p style={{ whiteSpace: 'pre-line' }}><small>{s.descricao}</small></p>}
            </div>}
            <div className="t-acoes">
              <span className={`status st-${s.status === 'Concluído' ? 'concluida' : s.status === 'Em andamento' ? 'andamento' : 'pendente'}`}>{s.status}{s.data_realizada ? ` ${dataBR(s.data_realizada)}` : ''}</span>
              {pode && s.status === 'Planejado' && <button className="sec mini" onClick={() => mudarStatus(s, 'Em andamento')}>Iniciar</button>}
              {pode && s.status !== 'Concluído' && s.status !== 'Cancelado' && <button className="mini" onClick={() => mudarStatus(s, 'Concluído')}>Concluir</button>}
              {pode && s.status === 'Em andamento' && <button className="sec mini" onClick={() => mudarStatus(s, 'Planejado')}>↩ Voltar a planejado</button>}
              {gestor && (s.status === 'Cancelado' || s.status === 'Concluído') && <button className="sec mini" onClick={() => mudarStatus(s, 'Planejado')}>Reabrir</button>}
              {gestor && s.status !== 'Cancelado' && s.status !== 'Concluído' && confirmando !== s.id && <button className="perigo mini" onClick={() => setConfirmando(s.id)}>Cancelar serviço</button>}
            </div>
            {confirmando === s.id && <div className="confirmacao">
              <span>Tem certeza que quer <b>cancelar</b> este serviço?</span>
              <button className="perigo mini" onClick={() => mudarStatus(s, 'Cancelado')}>Sim, cancelar serviço</button>
              <button className="sec mini" onClick={() => setConfirmando(null)}>Não</button>
            </div>}
          </div>
        )
      })}</div>
      {!vis.length && <p className="vazio">Nenhum serviço.</p>}
    </>
  )
}
