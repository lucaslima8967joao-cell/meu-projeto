import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { erroAmigavel } from '../lib/formato'

export default function Login() {
  const [modo, setModo] = useState<'entrar' | 'criar' | 'esqueci'>('entrar')
  const [email, setEmail] = useState(''), [senha, setSenha] = useState(''), [nome, setNome] = useState('')
  const [msg, setMsg] = useState(''), [erro, setErro] = useState(''), [ocupado, setOcupado] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setMsg(''); setOcupado(true)
    try {
      if (modo === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
        if (error) throw new Error(error.message.includes('Invalid') ? 'E-mail ou senha incorretos.' : error.message)
      } else if (modo === 'criar') {
        if (senha.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.')
        const { error } = await supabase.auth.signUp({ email, password: senha, options: { data: { nome } } })
        if (error) throw error
        setMsg('Conta criada. Se for pedido, confirme pelo e-mail. Depois o administrador precisa liberar o acesso.')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })
        if (error) throw error
        setMsg('Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha.')
      }
    } catch (e) { setErro(erroAmigavel(e)) } finally { setOcupado(false) }
  }

  return (
    <div className="centro">
      <form className="cartao" onSubmit={enviar}>
        <h1>🐂 Gestão da Fazenda</h1>
        <h2>{modo === 'entrar' ? 'Entrar' : modo === 'criar' ? 'Criar conta' : 'Recuperar senha'}</h2>
        {modo === 'criar' && <label>Nome<input required value={nome} onChange={e => setNome(e.target.value)} /></label>}
        <label>E-mail<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
        {modo !== 'esqueci' && <label>Senha<input type="password" required autoComplete={modo === 'criar' ? 'new-password' : 'current-password'} value={senha} onChange={e => setSenha(e.target.value)} /></label>}
        {erro && <p className="erro">{erro}</p>}
        {msg && <p className="ok">{msg}</p>}
        <button disabled={ocupado}>{ocupado ? 'Aguarde…' : modo === 'entrar' ? 'Entrar' : modo === 'criar' ? 'Criar conta' : 'Enviar link'}</button>
        <div className="links">
          {modo !== 'entrar' && <a onClick={() => setModo('entrar')}>Já tenho conta</a>}
          {modo !== 'criar' && <a onClick={() => setModo('criar')}>Criar conta</a>}
          {modo !== 'esqueci' && <a onClick={() => setModo('esqueci')}>Esqueci a senha</a>}
        </div>
      </form>
    </div>
  )
}
