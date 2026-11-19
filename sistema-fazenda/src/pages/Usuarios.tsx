import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { erroAmigavel } from '../lib/formato'
import { useAuth } from '../auth'
import type { Perfil } from '../lib/tipos'

export default function Usuarios() {
  const { perfil } = useAuth()
  const [lista, setLista] = useState<Perfil[]>([])
  const [erro, setErro] = useState(''), [ok, setOk] = useState('')
  const [senhaDe, setSenhaDe] = useState<string | null>(null), [nova, setNova] = useState('')
  const carregar = () => supabase.from('perfis').select('*').order('ativo').order('nome').then(r => setLista((r.data as Perfil[]) || []))
  useEffect(() => { carregar() }, [])

  async function alterar(p: Perfil, mud: Partial<Perfil>) {
    const { error } = await supabase.from('perfis').update(mud).eq('id', p.id)
    if (error) setErro(erroAmigavel(error)); else { setErro(''); carregar() }
  }

  async function definirSenha(p: Perfil) {
    setErro(''); setOk('')
    if (nova.length < 8) return setErro('A senha precisa ter pelo menos 8 caracteres.')
    const { error } = await supabase.rpc('admin_definir_senha', { p_usuario: p.id, p_senha: nova })
    if (error) return setErro(error.message)
    setOk(`Nova senha definida para ${p.nome || p.email}. Passe a senha para a pessoa pessoalmente (não por grupo de mensagens) e peça para ela trocar em "Minha conta".`)
    setSenhaDe(null); setNova('')
  }

  return (
    <>
      <h1>Usuários</h1>
      <p>Cada pessoa cria a própria conta na tela de entrada (“Criar conta”). Depois ela aparece aqui como <b>aguardando</b> e você libera o acesso e escolhe o perfil.</p>
      <ul className="dicas">
        <li><b>Administrador</b>: vê e gerencia tudo, inclusive usuários.</li>
        <li><b>Gerente</b>: cadastra e edita animais, pastos, lotes e tarefas.</li>
        <li><b>Cantina</b>: vê e mexe <b>só na cantina</b> (produtos, preços, vendas, estoque e contas da cantina). Não vê rebanho, vendas de gado, valores nem dados da equipe.</li>
        <li><b>Operador</b>: consulta; registra pesagens, nascimentos e movimentações; atualiza as próprias tarefas.</li>
      </ul>
      {erro && <p className="erro">{erro}</p>}{ok && <p className="ok">{ok}</p>}
      <div className="tabela-rolagem"><table className="lista">
        <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Acesso</th></tr></thead>
        <tbody>{lista.map(p => <tr key={p.id} className={p.ativo ? '' : 'pendente'}>
          <td>{p.nome || '—'}</td><td>{p.email}</td>
          <td><select value={p.papel} disabled={p.id === perfil?.id} onChange={e => alterar(p, { papel: e.target.value as Perfil['papel'] })}>
            <option value="admin">Administrador</option><option value="gerente">Gerente</option><option value="operador">Operador</option><option value="cantina">Cantina</option></select></td>
          <td>{p.id === perfil?.id ? 'Você' : p.ativo
            ? <button className="perigo mini" onClick={() => confirm(`Bloquear o acesso de ${p.nome || p.email}?`) && alterar(p, { ativo: false })}>Bloquear</button>
            : <button className="mini" onClick={() => alterar(p, { ativo: true })}>Liberar acesso</button>}
            {p.id !== perfil?.id && (senhaDe === p.id
              ? <div className="confirmacao"><input type="text" autoComplete="off" placeholder="Nova senha (mín. 8)" value={nova} onChange={e => setNova(e.target.value)} style={{ width: 'auto' }} />
                  <button className="mini" onClick={() => definirSenha(p)}>Salvar senha</button><button className="sec mini" onClick={() => { setSenhaDe(null); setNova('') }}>Não</button></div>
              : <button className="sec mini" onClick={() => { setSenhaDe(p.id); setNova('') }}>Definir nova senha</button>)}</td>
        </tr>)}</tbody></table></div>
    </>
  )
}
