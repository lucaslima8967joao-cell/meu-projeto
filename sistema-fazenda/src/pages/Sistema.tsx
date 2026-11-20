import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { buscarTodos } from '../lib/dados'

const TABELAS = ['fazendas', 'pastos', 'lotes', 'animais', 'pesagens', 'nascimentos', 'movimentacoes', 'reproducao', 'tarefas', 'vendas', 'venda_itens',
  'rebanho_mensal', 'ocorrencias', 'insumos', 'insumo_movimentos', 'formulas', 'formula_itens', 'plano_nutricional', 'servicos', 'servico_itens',
  'pedidos_compra', 'pedido_itens', 'maquinas', 'manutencoes', 'colaboradores', 'cantina_produtos', 'cantina_movimentos', 'cantina_fechamentos', 'perfis']
const NOMES: Record<string, string> = { animais: 'Animal', pesagens: 'Pesagem', nascimentos: 'Nascimento', movimentacoes: 'Troca de pasto', reproducao: 'Reprodução', tarefas: 'Tarefa',
  vendas: 'Venda', venda_itens: 'Animal da venda', pastos: 'Área', lotes: 'Lote', rebanho_mensal: 'Relatório mensal', ocorrencias: 'Morte/baixa', insumos: 'Produto',
  insumo_movimentos: 'Movimento de estoque', servicos: 'Serviço', maquinas: 'Máquina', manutencoes: 'Manutenção', colaboradores: 'Colaborador', cantina_produtos: 'Produto da cantina', cantina_movimentos: 'Venda/estoque da cantina', cantina_fechamentos: 'Fechamento da cantina', perfis: 'Usuário' }
const ACAO: Record<string, string> = { INSERT: 'criou', UPDATE: 'alterou', DELETE: 'apagou' }
interface Aud { id: number; tabela: string; acao: string; em: string; usuario_id: string | null; antes: Record<string, unknown> | null; depois: Record<string, unknown> | null }

/** Somente administrador: cópia de segurança e histórico de alterações. */
export default function Sistema() {
  const [aud, setAud] = useState<Aud[]>([])
  const [pessoas, setPessoas] = useState<Record<string, string>>({})
  const [tabela, setTabela] = useState('')
  const [baixando, setBaixando] = useState(''), [erro, setErro] = useState('')

  useEffect(() => {
    supabase.from('perfis').select('id, nome, email').then(r => setPessoas(Object.fromEntries(((r.data as { id: string; nome: string; email: string }[]) || []).map(p => [p.id, p.nome || p.email]))))
  }, [])
  useEffect(() => {
    let q = supabase.from('auditoria').select('*').order('em', { ascending: false }).limit(300)
    if (tabela) q = q.eq('tabela', tabela)
    q.then(r => setAud((r.data as Aud[]) || []))
  }, [tabela])

  async function copia() {
    setErro(''); const tudo: Record<string, unknown[]> = {}
    try {
      for (const t of TABELAS) { setBaixando(t); tudo[t] = await buscarTodos((de, ate) => supabase.from(t).select('*').order('id').range(de, ate)) }
      const nome = `copia-fazenda-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([JSON.stringify({ gerado_em: new Date().toISOString(), tabelas: tudo }, null, 1)], { type: 'application/json' }))
      a.download = nome; a.click()
    } catch (e) { setErro('Não foi possível gerar a cópia: ' + (e as Error).message) } finally { setBaixando('') }
  }
  const resumo = (x: Aud) => {
    const d = x.depois || x.antes || {}
    const nome = d.controle || d.codigo || d.titulo || d.nome || d.comprador || d.categoria || ''
    if (x.acao !== 'UPDATE' || !x.antes || !x.depois) return String(nome)
    const mud = Object.keys(x.depois).filter(k => !['atualizado_em', 'criado_em'].includes(k) && JSON.stringify(x.antes![k]) !== JSON.stringify(x.depois![k]))
    return `${nome} — ${mud.map(k => `${k}: ${x.antes![k] ?? '—'} → ${x.depois![k] ?? '—'}`).join('; ')}`
  }
  return (
    <>
      <h1>Sistema</h1>
      <section className="cartao">
        <h2>Cópia de segurança</h2>
        <p>Baixa um arquivo com <b>todos os dados</b> do sistema. Guarde no computador ou no Google Drive. Recomendado uma vez por semana.</p>
        <p><small>O banco também faz cópia automática diária no Supabase.</small></p>
        <button onClick={copia} disabled={!!baixando}>{baixando ? `Baixando ${baixando}…` : 'Baixar cópia completa'}</button>
        {erro && <p className="erro">{erro}</p>}
      </section>
      <section className="cartao">
        <div className="titulo-acoes"><h2>Histórico de alterações</h2>
          <select value={tabela} onChange={e => setTabela(e.target.value)} style={{ width: 'auto' }}><option value="">Tudo</option>{Object.entries(NOMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="tabela-rolagem"><table><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Detalhe</th></tr></thead>
          <tbody>{aud.map(x => <tr key={x.id}><td>{new Date(x.em).toLocaleString('pt-BR')}</td><td>{x.usuario_id === '00000000-0000-0000-0000-00000000a551' ? '🤖 Assistente' : x.usuario_id ? pessoas[x.usuario_id] || 'usuário' : 'sistema/importação'}</td>
            <td>{ACAO[x.acao] || x.acao} {NOMES[x.tabela] || x.tabela}</td><td><small>{resumo(x)}</small></td></tr>)}</tbody></table></div>
        {!aud.length && <p className="vazio">Nenhum registro.</p>}
      </section>
    </>
  )
}
