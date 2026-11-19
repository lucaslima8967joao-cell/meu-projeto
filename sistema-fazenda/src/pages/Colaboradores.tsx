import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { baixarCSV, dataBR, erroAmigavel } from '../lib/formato'
import { useListas } from '../lib/dados'

interface Colab { id: string; nome: string; funcao: string | null; telefone: string | null; situacao: string; admissao: string | null; perfil_id: string | null; obs: string | null }
const VAZIO = { id: '', nome: '', funcao: '', telefone: '', situacao: 'Ativo', admissao: '', perfil_id: '', obs: '' }

/** Só administrador e gerente veem esta tela (dados pessoais). */
export default function Colaboradores() {
  const { pessoas } = useListas()
  const [lista, setLista] = useState<Colab[]>([])
  const [f, setF] = useState<typeof VAZIO | null>(null)
  const [erro, setErro] = useState('')
  const carregar = useCallback(() => { supabase.from('colaboradores').select('*').eq('arquivado', false).order('nome').then(r => setLista((r.data as Colab[]) || [])) }, [])
  useEffect(carregar, [carregar])

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); if (!f) return
    const dados = { nome: f.nome.trim(), funcao: f.funcao || null, telefone: f.telefone || null, situacao: f.situacao, admissao: f.admissao || null, perfil_id: f.perfil_id || null, obs: f.obs || null }
    const { error } = f.id ? await supabase.from('colaboradores').update(dados).eq('id', f.id) : await supabase.from('colaboradores').insert(dados)
    if (error) return setErro(erroAmigavel(error))
    setF(null); setErro(''); carregar()
  }
  const set = (k: keyof typeof VAZIO) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => f && setF({ ...f, [k]: e.target.value })
  return (
    <>
      <div className="titulo-acoes"><h1>Colaboradores</h1>
        <div><button className="sec" onClick={() => baixarCSV('colaboradores.csv', ['Nome', 'Função', 'Telefone', 'Situação', 'Admissão', 'Obs.'], lista.map(c => [c.nome, c.funcao, c.telefone, c.situacao, dataBR(c.admissao), c.obs]))}>Exportar Excel (CSV)</button>
          <button onClick={() => setF({ ...VAZIO })}>+ Colaborador</button></div></div>
      <p><small>Somente administrador e gerente veem esta tela. Ligar o colaborador ao usuário dele permite atribuir tarefas e serviços.</small></p>
      {erro && <p className="erro">{erro}</p>}
      {f && <form className="cartao formulario" onSubmit={salvar}>
        <div className="grade">
          <label>Nome *<input required value={f.nome} onChange={set('nome')} /></label>
          <label>Função<input placeholder="ex.: vaqueiro, tratorista" value={f.funcao} onChange={set('funcao')} /></label>
          <label>Telefone<input inputMode="tel" value={f.telefone} onChange={set('telefone')} /></label>
          <label>Situação<select value={f.situacao} onChange={set('situacao')}>{['Ativo', 'Afastado', 'Desligado'].map(s => <option key={s}>{s}</option>)}</select></label>
          <label>Admissão<input type="date" value={f.admissao} onChange={set('admissao')} /></label>
          <label>Usuário no sistema<select value={f.perfil_id} onChange={set('perfil_id')}><option value="">— sem acesso —</option>{pessoas.map(p => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}</select></label>
          <label>Observação<input value={f.obs} onChange={set('obs')} /></label>
        </div>
        <div className="acoes"><button type="button" className="sec" onClick={() => setF(null)}>Cancelar</button><button>Salvar</button></div>
      </form>}
      <div className="tabela-rolagem"><table className="lista"><thead><tr><th>Nome</th><th>Função</th><th>Telefone</th><th>Situação</th><th>Usuário</th></tr></thead>
        <tbody>{lista.map(c => <tr key={c.id} onClick={() => setF(Object.fromEntries(Object.keys(VAZIO).map(k => [k, String((c as unknown as Record<string, unknown>)[k] ?? '')])) as typeof VAZIO)}>
          <td><b>{c.nome}</b></td><td>{c.funcao || '—'}</td><td>{c.telefone || '—'}</td><td>{c.situacao}</td><td>{pessoas.find(p => p.id === c.perfil_id)?.nome || '—'}</td></tr>)}</tbody></table></div>
      {!lista.length && <p className="vazio">Nenhum colaborador cadastrado.</p>}
    </>
  )
}
