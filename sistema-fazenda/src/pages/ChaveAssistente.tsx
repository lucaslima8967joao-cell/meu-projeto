import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { erroAmigavel } from '../lib/formato'

interface Chave { id: string; nome: string; ativo: boolean; criado_em: string; ultimo_uso: string | null }
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')

/** Administrador gera a chave que o Assistente (Claude) usa para lançar as mensagens do dia. A chave aparece UMA vez; o banco guarda só o "resumo" (hash). */
export default function ChaveAssistente() {
  const [chaves, setChaves] = useState<Chave[]>([])
  const [nova, setNova] = useState(''), [copiado, setCopiado] = useState(false), [erro, setErro] = useState('')
  const carregar = () => { supabase.from('assistente_chaves').select('id, nome, ativo, criado_em, ultimo_uso').order('criado_em', { ascending: false }).then(r => setChaves((r.data as Chave[]) || [])) }
  useEffect(carregar, [])

  async function gerar() {
    setErro(''); setCopiado(false)
    if (chaves.some(c => c.ativo) && !confirm('Já existe uma chave ligada. Gerar outra mesmo assim? (A antiga continua valendo até você desligar.)')) return
    const token = 'fazenda-' + hex(crypto.getRandomValues(new Uint8Array(32)))
    const hash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
    const { error } = await supabase.from('assistente_chaves').insert({ nome: 'Assistente (Claude)', hash })
    if (error) return setErro(erroAmigavel(error))
    setNova(token); carregar()
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(nova); setCopiado(true) } catch { setCopiado(false); setErro('Não consegui copiar sozinho: segure o dedo no código e escolha Copiar.') }
  }
  async function desligar(c: Chave) {
    const { error } = await supabase.from('assistente_chaves').update({ ativo: false }).eq('id', c.id)
    if (error) setErro(erroAmigavel(error)); else carregar()
  }
  return (
    <section className="cartao">
      <h2>🤖 Chave do Assistente</h2>
      <p>Com esta chave o Assistente (Claude) lança no sistema as informações que você mandar na conversa (ex.: “P18 jogou 300 t de calcário”). Ele só grava em serviços, estoque, máquinas, tarefas, pesagens, reprodução, mortes e cantina, e tudo aparece no histórico como 🤖 Assistente. Você pode desligar a qualquer momento.</p>
      {erro && <p className="erro">{erro}</p>}
      {nova ? <div className="aviso">
        <p><b>Copie agora</b> — este código aparece só uma vez:</p>
        <p className="codigo-chave">{nova}</p>
        <button onClick={copiar}>{copiado ? '✔ Copiado' : 'Copiar código'}</button>
        <p><small>Depois volte na conversa com o Claude e cole o código na janela segura que ele abrir. Não mande o código por mensagem.</small></p>
      </div> : <button onClick={gerar}>Gerar chave do Assistente</button>}
      {chaves.length > 0 && <table><tbody>{chaves.map(c => <tr key={c.id}><td>{c.nome}</td><td>criada {new Date(c.criado_em).toLocaleDateString('pt-BR')}</td>
        <td>{c.ultimo_uso ? `último uso ${new Date(c.ultimo_uso).toLocaleString('pt-BR')}` : 'nunca usada'}</td>
        <td>{c.ativo ? <button className="perigo mini" onClick={() => desligar(c)}>Desligar</button> : <small>desligada</small>}</td></tr>)}</tbody></table>}
    </section>
  )
}
