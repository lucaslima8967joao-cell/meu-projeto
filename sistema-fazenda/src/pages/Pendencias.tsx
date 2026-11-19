import { Link } from 'react-router-dom'
import { descartar, sincronizar, useSincronizacao } from '../lib/offline'

/** Faixa no topo: mostra se está sem internet e quantos lançamentos esperam envio. */
export function StatusSincronizacao() {
  const { online, pendentes, enviando } = useSincronizacao()
  const comErro = pendentes.filter(p => p.erro).length
  if (online && !pendentes.length) return null
  return (
    <div className={'sinc ' + (comErro ? 'sinc-erro' : online ? 'sinc-envio' : 'sinc-off')}>
      <span>
        {!online && '📵 Sem internet. '}
        {pendentes.length > 0 && <Link to="/pendencias">{pendentes.length} lançamento{pendentes.length > 1 ? 's' : ''} aguardando envio{comErro ? ` (${comErro} com problema)` : ''}</Link>}
        {!online && !pendentes.length && 'Você está vendo os dados guardados no aparelho.'}
      </span>
      {online && pendentes.length > 0 && <button className="mini" disabled={enviando} onClick={() => sincronizar()}>{enviando ? 'Enviando…' : 'Enviar agora'}</button>}
    </div>
  )
}

export default function Pendencias() {
  const { online, pendentes, enviando } = useSincronizacao()
  return (
    <>
      <h1>Lançamentos aguardando envio</h1>
      <p>{online ? 'Com internet: os lançamentos são enviados automaticamente.' : '📵 Sem internet. Tudo fica guardado neste aparelho e será enviado quando o sinal voltar.'}</p>
      {online && pendentes.length > 0 && <p><button disabled={enviando} onClick={() => sincronizar()}>{enviando ? 'Enviando…' : 'Enviar agora'}</button></p>}
      {!pendentes.length && <p className="ok">Nada pendente. Tudo foi enviado.</p>}
      {pendentes.map(p => (
        <div key={p.id} className={'cartao ' + (p.erro ? 'pendente' : '')}>
          <b>{p.descricao}</b><br />
          <small>Lançado em {new Date(p.criado_em).toLocaleString('pt-BR')}</small>
          {p.erro && <>
            <p className="erro">Não foi aceito: {traduzir(p.erro)}</p>
            <button className="perigo mini" onClick={() => confirm('Descartar este lançamento? Ele não será enviado.') && descartar(p.id)}>Descartar</button>
          </>}
        </div>
      ))}
    </>
  )
}

function traduzir(msg: string) {
  if (msg.includes('ux_animais_chip')) return 'já existe um animal ativo com este chip. Confira o número e lance de novo.'
  if (msg.includes('ux_animais_controle')) return 'já existe um animal ativo com este nº de controle.'
  if (msg.includes('ux_animais_brinco')) return 'já existe um animal ativo com este brinco.'
  if (msg.includes('row-level security') || msg.includes('permission')) return 'seu usuário não tem permissão para este lançamento.'
  if (msg.includes('foreign key')) return 'o animal, pasto ou lote ligado a este lançamento não existe mais (ou o lançamento anterior dele falhou).'
  return msg
}

/** Aviso exibido quando a tela está mostrando a cópia guardada no aparelho. */
export function AvisoCache({ doCache, em }: { doCache: boolean; em?: string }) {
  const { online, pendentes } = useSincronizacao()
  if (!doCache) return null
  const quando = em ? `de ${new Date(em).toLocaleString('pt-BR')}` : 'guardados no aparelho'
  if (online && !pendentes.length) return <p className="dados-salvos">🔄 A internet voltou. Mostrando dados {quando}. <button className="mini" onClick={() => location.reload()}>Atualizar agora</button></p>
  return <p className="dados-salvos">📵 Sem internet — mostrando dados {quando}.</p>
}
