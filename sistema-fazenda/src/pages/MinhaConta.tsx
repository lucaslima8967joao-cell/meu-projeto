import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { erroAmigavel } from '../lib/formato'
import { useAuth } from '../auth'

/** Trocar a própria senha e o nome — não depende de e-mail (basta estar logado). */
export default function MinhaConta() {
  const { perfil, sessao, recarregar } = useAuth()
  const [nome, setNome] = useState(perfil?.nome || '')
  const [s1, setS1] = useState(''), [s2, setS2] = useState('')
  const [erro, setErro] = useState(''), [ok, setOk] = useState('')

  async function trocarSenha(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setOk('')
    if (s1.length < 8) return setErro('A senha precisa ter pelo menos 8 caracteres.')
    if (s1 !== s2) return setErro('As duas senhas não são iguais.')
    const { error } = await supabase.auth.updateUser({ password: s1 })
    if (error) return setErro(error.message.includes('different from the old') ? 'A nova senha precisa ser diferente da atual.' : erroAmigavel(error) + ' (Trocar senha precisa de internet.)')
    setS1(''); setS2(''); setOk('Senha trocada. Use a nova senha nos outros aparelhos.')
  }
  async function salvarNome(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setOk('')
    const { error } = await supabase.from('perfis').update({ nome: nome.trim() }).eq('id', perfil!.id)
    if (error) return setErro(erroAmigavel(error))
    setOk('Nome atualizado.'); recarregar()
  }
  return (
    <>
      <h1>Minha conta</h1>
      <p>E-mail de entrada: <b>{sessao?.user.email}</b> · perfil: <b>{perfil?.papel}</b></p>
      {erro && <p className="erro">{erro}</p>}{ok && <p className="ok">{ok}</p>}
      <div className="duas">
        <form className="cartao formulario" onSubmit={trocarSenha}>
          <h2>Trocar senha</h2>
          <label>Nova senha<input type="password" autoComplete="new-password" value={s1} onChange={e => setS1(e.target.value)} /></label>
          <label>Repita a nova senha<input type="password" autoComplete="new-password" value={s2} onChange={e => setS2(e.target.value)} /></label>
          <div className="acoes"><button>Trocar senha</button></div>
        </form>
        <form className="cartao formulario" onSubmit={salvarNome}>
          <h2>Meu nome</h2>
          <label>Nome que aparece no sistema<input required value={nome} onChange={e => setNome(e.target.value)} /></label>
          <div className="acoes"><button>Salvar</button></div>
        </form>
      </div>
    </>
  )
}
