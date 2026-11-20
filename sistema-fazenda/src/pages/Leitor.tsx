import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { buscarTodos, useListas } from '../lib/dados'
import { enfileirar, lerComCache, novoId } from '../lib/offline'
import { dataBR, hojeISO, kg, num } from '../lib/formato'
import type { Animal } from '../lib/tipos'
import { AvisoCache } from './Pendencias'

type Modo = 'identificar' | 'manejo' | 'conferencia' | 'arquivo'
type Acao = 'Pesagem' | 'Diagnóstico de prenhez' | 'Vacinação' | 'Troca de pasto' | 'Só contar'
interface Leitura { codigo: string; animal: Animal | null; candidatos: Animal[]; valor?: string; hora: string; repetido: boolean }

/** Só os dígitos/letras do código lido (o bastão pode mandar "982 000123456789", com espaços ou prefixos). */
export const normalizar = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '')

/** Procura o animal pelo chip, controle ou brinco; se não achar exato, tenta pelos últimos dígitos do chip. */
export function procurar(lista: Animal[], lido: string): { animal: Animal | null; candidatos: Animal[] } {
  const c = normalizar(lido)
  if (!c) return { animal: null, candidatos: [] }
  const ativos = lista.filter(a => !a.arquivado)
  const exato = ativos.filter(a => [a.chip, a.controle, a.brinco].some(v => v && normalizar(v) === c))
  if (exato.length === 1) return { animal: exato[0], candidatos: [] }
  if (exato.length > 1) return { animal: null, candidatos: exato }
  const parcial = c.length >= 4 ? ativos.filter(a => a.chip && (normalizar(a.chip).endsWith(c) || (normalizar(a.chip).length >= 4 && c.endsWith(normalizar(a.chip))))) : []
  return parcial.length === 1 ? { animal: parcial[0], candidatos: [] } : { animal: null, candidatos: parcial }
}

export default function Leitor() {
  const nav = useNavigate()
  const { pastos, lotes } = useListas()
  const [animais, setAnimais] = useState<Animal[]>([])
  const [cache, setCache] = useState<{ doCache: boolean; em?: string }>({ doCache: false })
  const [modo, setModo] = useState<Modo>('identificar')
  const [acao, setAcao] = useState<Acao>('Pesagem')
  const [extra, setExtra] = useState({ produto: '', destino: '', alvoTipo: 'lote', alvoId: '' })
  const [codigo, setCodigo] = useState('')
  const [atual, setAtual] = useState<Leitura | null>(null)
  const [valor, setValor] = useState('')
  const [sessao, setSessao] = useState<Leitura[]>([])
  const [ok, setOk] = useState('')
  const entrada = useRef<HTMLInputElement>(null), campoValor = useRef<HTMLInputElement>(null)

  useEffect(() => {
    lerComCache('v_animais', () => buscarTodos<Animal>((de, ate) => supabase.from('v_animais').select('*').eq('arquivado', false).order('controle').order('id').range(de, ate)), [] as Animal[])
      .then(r => { setAnimais(r.dados); setCache(r) })
  }, [])
  const focar = () => { setTimeout(() => entrada.current?.focus(), 50) }
  useEffect(focar, [modo])

  function ler(e?: React.FormEvent) {
    e?.preventDefault()
    const c = normalizar(codigo); setCodigo(''); setOk('')
    if (!c) return focar()
    const { animal, candidatos } = procurar(animais, c)
    const repetido = sessao.some(l => (animal && l.animal?.id === animal.id) || l.codigo === c)
    const leitura: Leitura = { codigo: c, animal, candidatos, hora: new Date().toLocaleTimeString('pt-BR'), repetido }
    try { navigator.vibrate?.(animal ? 80 : [80, 60, 80]) } catch { /* sem vibração */ }
    setAtual(leitura)
    if (modo === 'identificar') return focar()
    if (modo === 'conferencia') { if (!repetido) setSessao(s => [leitura, ...s]); return focar() }
    // manejo: se precisa de valor (peso/resultado), espera; senão grava direto
    if (!animal) return focar()
    if (acao === 'Pesagem') { setValor(''); setTimeout(() => campoValor.current?.focus(), 50); return }
    if (acao === 'Diagnóstico de prenhez') return
    gravar(leitura, '')
  }

  async function gravar(l: Leitura, v: string) {
    const a = l.animal!; const nome = a.controle || a.chip || 'animal'; let enviado = true
    if (acao === 'Pesagem') {
      const peso = Number(v.replace(',', '.')); if (!(peso > 0 && peso < 2000)) return
      enviado = await enfileirar({ tipo: 'insert', tabela: 'pesagens', dados: { id: novoId(), animal_id: a.id, data: hojeISO(), peso_kg: peso, obs: 'Leitor de brinco', lancado_em: new Date().toISOString() } }, `Pesagem ${nome}: ${peso} kg`, a.id)
    } else if (acao === 'Diagnóstico de prenhez' || acao === 'Vacinação') {
      enviado = await enfileirar({ tipo: 'insert', tabela: 'reproducao', dados: { id: novoId(), animal_id: a.id, data: hojeISO(), tipo: acao, resultado: acao === 'Diagnóstico de prenhez' ? v : null,
        produto: acao === 'Vacinação' ? extra.produto || null : null, obs: 'Leitor de brinco', lancado_em: new Date().toISOString() } }, `${acao} ${nome}${v ? ': ' + v : ''}`, a.id)
    } else if (acao === 'Troca de pasto') {
      if (!extra.destino) return
      enviado = await enfileirar({ tipo: 'insert', tabela: 'movimentacoes', dados: { id: novoId(), animal_id: a.id, pasto_origem_id: a.pasto_id, pasto_destino_id: extra.destino, data: hojeISO(), motivo: 'Leitor de brinco', lancado_em: new Date().toISOString() } },
        `${nome} → pasto ${pastos.find(p => p.id === extra.destino)?.codigo}`, a.id)
    }
    setSessao(s => [{ ...l, valor: v }, ...s]); setAtual(null); setValor('')
    if (!enviado) setOk('Guardado no aparelho; será enviado quando houver internet.')
    focar()
  }

  // conferência: quem era esperado (lote ou pasto) x quem foi lido
  const esperados = useMemo(() => !extra.alvoId ? [] : animais.filter(a => a.situacao === 'ativo' && (extra.alvoTipo === 'lote' ? a.lote_id === extra.alvoId : a.pasto_id === extra.alvoId)), [animais, extra])
  const lidosIds = new Set(sessao.map(l => l.animal?.id).filter(Boolean))
  const faltam = esperados.filter(a => !lidosIds.has(a.id))
  const foraDoGrupo = sessao.filter(l => !l.animal || !esperados.some(a => a.id === l.animal!.id))
  const pesos = sessao.map(l => Number((l.valor || '').replace(',', '.'))).filter(p => p > 0)
  const nomeA = (a: Animal) => a.controle || a.chip || a.brinco || '—'

  const cartaoAtual = atual && (
    <div className={'cartao leitura ' + (atual.animal ? 'achou' : 'nao-achou')}>
      <div className="lido">{atual.codigo}{atual.repetido && <span className="etiqueta">já lido nesta sessão</span>}</div>
      {atual.animal ? <>
        <h2>{nomeA(atual.animal)}{atual.animal.nome ? ` · ${atual.animal.nome}` : ''}</h2>
        <p>{[atual.animal.especie === 'Equino' ? 'Equino' : null, atual.animal.sexo === 'F' ? 'Fêmea' : 'Macho', atual.animal.categoria_atual, atual.animal.pasto_codigo && `pasto ${atual.animal.pasto_codigo}`,
          atual.animal.lote_nome && `lote ${atual.animal.lote_nome}`, atual.animal.ultimo_peso_kg && `último peso ${kg(atual.animal.ultimo_peso_kg)} (${dataBR(atual.animal.ultima_pesagem)})`, atual.animal.ultimo_diagnostico].filter(Boolean).join(' · ')}</p>
        {modo === 'identificar' && <Link className="botao" to={`/animais/${atual.animal.id}`}>Abrir ficha</Link>}
        {modo === 'manejo' && acao === 'Pesagem' && <form className="linha" onSubmit={e => { e.preventDefault(); gravar(atual, valor) }}>
          <input ref={campoValor} inputMode="decimal" placeholder="Peso (kg)" value={valor} onChange={e => setValor(e.target.value)} /><button>Salvar e próximo</button></form>}
        {modo === 'manejo' && acao === 'Diagnóstico de prenhez' && <div className="linha"><button onClick={() => gravar(atual, 'Prenhe')}>Prenhe</button><button className="sec" onClick={() => gravar(atual, 'Vazia')}>Vazia</button></div>}
      </> : atual.candidatos.length ? <>
        <h2>Número parecido com {atual.candidatos.length} animais</h2>
        <div className="sugestoes">{atual.candidatos.map(a => <button key={a.id} className="sec mini" onClick={() => setAtual({ ...atual, animal: a, candidatos: [] })}>{nomeA(a)} {a.chip ? `· chip ${a.chip}` : ''}</button>)}</div>
      </> : <>
        <h2>Brinco não cadastrado</h2>
        <button onClick={() => nav(`/animais/novo?chip=${encodeURIComponent(atual.codigo)}`)}>Cadastrar animal com este chip</button>
      </>}
    </div>
  )

  return (
    <>
      <h1>Leitor de brinco</h1>
      <AvisoCache {...cache} />
      <div className="abas">{([['identificar', 'Identificar'], ['manejo', 'Manejo no curral'], ['conferencia', 'Conferir lote/embarque'], ['arquivo', 'Arquivo do bastão']] as [Modo, string][])
        .map(([k, t]) => <button key={k} className={modo === k ? '' : 'sec'} onClick={() => { setModo(k); setAtual(null); setSessao([]) }}>{t}</button>)}</div>

      {modo === 'manejo' && <div className="filtros">
        <select value={acao} onChange={e => { setAcao(e.target.value as Acao); setAtual(null) }}>{(['Pesagem', 'Diagnóstico de prenhez', 'Vacinação', 'Troca de pasto', 'Só contar'] as Acao[]).map(a => <option key={a}>{a}</option>)}</select>
        {acao === 'Vacinação' && <input placeholder="Vacina / produto" value={extra.produto} onChange={e => setExtra({ ...extra, produto: e.target.value })} />}
        {acao === 'Troca de pasto' && <select value={extra.destino} onChange={e => setExtra({ ...extra, destino: e.target.value })}><option value="">Pasto de destino…</option>{pastos.map(p => <option key={p.id} value={p.id}>{p.codigo}</option>)}</select>}
      </div>}
      {modo === 'conferencia' && <div className="filtros">
        <select value={extra.alvoTipo} onChange={e => setExtra({ ...extra, alvoTipo: e.target.value, alvoId: '' })}><option value="lote">Conferir um lote</option><option value="pasto">Conferir um pasto</option></select>
        <select value={extra.alvoId} onChange={e => setExtra({ ...extra, alvoId: e.target.value })}><option value="">Escolha…</option>
          {(extra.alvoTipo === 'lote' ? lotes.map(l => ({ id: l.id, t: l.nome })) : pastos.map(p => ({ id: p.id, t: p.codigo }))).map(o => <option key={o.id} value={o.id}>{o.t}</option>)}</select>
      </div>}

      {modo === 'arquivo' ? <ArquivoBastao animais={animais} /> : <>
        <form className="cartao leitor" onSubmit={ler}>
          <label>Aponte o bastão para o brinco (ou digite o número e toque em Ler)
            <input ref={entrada} className="busca" autoFocus autoComplete="off" inputMode="numeric" value={codigo} onChange={e => setCodigo(e.target.value)} placeholder="Aguardando leitura…" />
          </label>
          <button>Ler</button>
        </form>
        {ok && <p className="ok">{ok}</p>}
        {modo === 'manejo' && acao === 'Troca de pasto' && !extra.destino && <p className="aviso">Escolha o pasto de destino antes de ler.</p>}
        {cartaoAtual}
        {sessao.length > 0 && <section className="cartao">
          <h2>{modo === 'conferencia' ? 'Lidos' : 'Nesta sessão'}: {sessao.length}{pesos.length ? ` · peso médio ${kg(pesos.reduce((s, p) => s + p, 0) / pesos.length)} · total ${num(pesos.reduce((s, p) => s + p, 0), 0)} kg` : ''}</h2>
          <table><tbody>{sessao.map((l, i) => <tr key={i} className={l.animal ? '' : 'pendente'}><td>{l.hora}</td><td><b>{l.animal ? nomeA(l.animal) : l.codigo}</b>{!l.animal && <small> não cadastrado</small>}</td><td>{l.valor}</td></tr>)}</tbody></table>
        </section>}
        {modo === 'conferencia' && extra.alvoId && <div className="duas">
          <section className="cartao"><h2>Faltam ler: {faltam.length} de {esperados.length}</h2>{faltam.length ? <p>{faltam.map(nomeA).join(' · ')}</p> : <p className="ok">Todos lidos ✔</p>}</section>
          <section className="cartao"><h2>Lidos fora do grupo: {foraDoGrupo.length}</h2>{foraDoGrupo.length ? <p>{foraDoGrupo.map(l => l.animal ? nomeA(l.animal) : l.codigo).join(' · ')}</p> : <p className="vazio">Nenhum.</p>}</section>
        </div>}
        <details className="cartao"><summary>Como ligar o bastão no celular</summary>
          <ol>
            <li>No bastão, coloque a comunicação Bluetooth no modo <b>teclado / HID</b> (no manual aparece como “HID”, “Keyboard” ou “Teclado”).</li>
            <li>No celular: Ajustes → Bluetooth → toque no bastão para parear.</li>
            <li>Abra esta tela. Cada brinco lido aparece aqui sozinho. Se o número não aparecer, toque na caixa “Aguardando leitura…” uma vez.</li>
          </ol>
          <p><small>Com o bastão pareado como teclado, o teclado da tela do iPhone some — é normal. Funciona sem internet.</small></p>
        </details>
      </>}
    </>
  )
}

/** Importa o arquivo exportado pelo bastão/balança (TXT ou CSV): um brinco por linha, com peso opcional. */
function ArquivoBastao({ animais }: { animais: Animal[] }) {
  const [linhas, setLinhas] = useState<{ codigo: string; peso: number | null; animal: Animal | null }[]>([])
  const [data, setData] = useState(hojeISO()), [ok, setOk] = useState('')
  function abrir(f: File) {
    f.text().then(t => {
      const out = t.split(/\r?\n/).map(l => {
        const tokens = l.split(/[;\t]/.test(l) ? /[;\t]+/ : /,|\s{2,}/).map(x => x.trim()).filter(Boolean)
        // brinco: número longo (8 a 16 dígitos, ex.: 982000123456789 ou "982 000123456789")
        const cod = normalizar(l.match(/\d{3}\s\d{12}/)?.[0] || tokens.find(x => /^\d{8,16}$/.test(normalizar(x))) || '')
        // peso: outro número da linha entre 20 e 2000 (aceita vírgula decimal)
        const peso = tokens.filter(x => normalizar(x) !== cod).map(x => Number(x.replace(',', '.'))).find(n => n > 20 && n < 2000) ?? null
        return cod ? { codigo: cod, peso, animal: procurar(animais, cod).animal } : null
      }).filter(Boolean) as { codigo: string; peso: number | null; animal: Animal | null }[]
      setLinhas(out); setOk('')
    })
  }
  async function lancar() {
    let n = 0
    for (const l of linhas) if (l.animal && l.peso) {
      await enfileirar({ tipo: 'insert', tabela: 'pesagens', dados: { id: novoId(), animal_id: l.animal.id, data, peso_kg: l.peso, obs: 'Arquivo do bastão', lancado_em: new Date().toISOString() } }, `Pesagem ${l.animal.controle || l.codigo}: ${l.peso} kg`, l.animal.id); n++
    }
    setOk(`${n} pesagens lançadas.`)
  }
  const achados = linhas.filter(l => l.animal)
  return (
    <section className="cartao">
      <p>Escolha o arquivo exportado pelo bastão ou pela balança (TXT ou CSV). Cada linha deve ter o número do brinco e, se houver, o peso.</p>
      <div className="linha"><input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={e => e.target.files?.[0] && abrir(e.target.files[0])} />
        <input type="date" max={hojeISO()} value={data} onChange={e => setData(e.target.value)} /></div>
      {linhas.length > 0 && <>
        <p>{linhas.length} leituras · {achados.length} encontradas no cadastro · {linhas.length - achados.length} não cadastradas · {linhas.filter(l => l.peso).length} com peso</p>
        <div className="tabela-rolagem"><table><tbody>{linhas.slice(0, 500).map((l, i) => <tr key={i} className={l.animal ? '' : 'pendente'}><td>{l.codigo}</td><td>{l.animal ? (l.animal.controle || l.animal.chip) : <small>não cadastrado</small>}</td><td className="num">{l.peso ? kg(l.peso) : '—'}</td></tr>)}</tbody></table></div>
        <button onClick={lancar} disabled={!achados.some(l => l.peso)}>Lançar pesagens dos animais encontrados</button>
      </>}
      {ok && <p className="ok">{ok}</p>}
    </section>
  )
}
