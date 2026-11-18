import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { erroAmigavel } from '../lib/formato'
import { useAuth } from '../auth'
import type { Perfil } from '../lib/tipos'

export default function Usuarios() {
  const { perfil } = useAuth()
  const [lista, setLista] = useState<Perfil[]>([])
  const [erro, setErro] = useState('')
  const carregar = () => supabase.from('perfis').select('*').order('ativo').order('nome').then(r => setLista((r.data as Perfil[]) || []))
  useEffect(() => { carregar() }, [])

  async function alterar(p: Perfil, mud: Partial<Perfil>) {
    const { error } = await supabase.from('perfis').update(mud).eq('id', p.id)
    if (error) setErro(erroAmigavel(error)); else { setErro(''); carregar() }
  }

  return (
    <>
      <h1>Usuários</h1>
      <p>Cada pessoa cria a própria conta na tela de entrada (“Criar conta”). Depois ela aparece aqui como <b>aguardando</b> e você libera o acesso e escolhe o perfil.</p>
      <ul className="dicas">
        <li><b>Administrador</b>: vê e gerencia tudo, inclusive usuários.</li>
        <li><b>Gerente</b>: cadastra e edita animais, pastos, lotes e tarefas.</li>
        <li><b>Operador</b>: consulta; registra pesagens, nascimentos e movimentações; atualiza as próprias tarefas.</li>
      </ul>
      {erro && <p className="erro">{erro}</p>}
      <div className="tabela-rolagem"><table className="lista">
        <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Acesso</th></tr></thead>
        <tbody>{lista.map(p => <tr key={p.id} className={p.ativo ? '' : 'pendente'}>
          <td>{p.nome || '—'}</td><td>{p.email}</td>
          <td><select value={p.papel} disabled={p.id === perfil?.id} onChange={e => alterar(p, { papel: e.target.value as Perfil['papel'] })}>
            <option value="admin">Administrador</option><option value="gerente">Gerente</option><option value="operador">Operador</option></select></td>
          <td>{p.id === perfil?.id ? 'Você' : p.ativo
            ? <button className="perigo mini" onClick={() => confirm(`Bloquear o acesso de ${p.nome || p.email}?`) && alterar(p, { ativo: false })}>Bloquear</button>
            : <button className="mini" onClick={() => alterar(p, { ativo: true })}>Liberar acesso</button>}</td>
        </tr>)}</tbody></table></div>
    </>
  )
}
