import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { erroAmigavel } from '../lib/formato'
import { useAuth } from '../auth'

export default function NovaSenha() {
  const { fimRecuperacao } = useAuth()
  const [s1, setS1] = useState(''), [s2, setS2] = useState(''), [erro, setErro] = useState('')
  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (s1.length < 8) return setErro('A senha precisa ter pelo menos 8 caracteres.')
    if (s1 !== s2) return setErro('As senhas não são iguais.')
    const { error } = await supabase.auth.updateUser({ password: s1 })
    if (error) return setErro(erroAmigavel(error))
    fimRecuperacao()
  }
  return (
    <div className="centro"><form className="cartao" onSubmit={salvar}>
      <h1>Criar nova senha</h1>
      <label>Nova senha<input type="password" autoComplete="new-password" value={s1} onChange={e => setS1(e.target.value)} /></label>
      <label>Repita a senha<input type="password" autoComplete="new-password" value={s2} onChange={e => setS2(e.target.value)} /></label>
      {erro && <p className="erro">{erro}</p>}
      <button>Salvar senha</button>
    </form></div>
  )
}
