import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { CATEGORIAS, CATEGORIAS_EQUINOS, RACAS, SITUACAO, hojeISO } from '../lib/formato'
import { useListas } from '../lib/dados'
import { enfileirar, lerComCache, novoId } from '../lib/offline'
import type { Animal } from '../lib/tipos'
import { useAuth } from '../auth'

const VAZIO = { fazenda_id: '', controle: '', chip: '', brinco: '', nome: '', sexo: '', raca: 'NEL', nascimento: '', categoria: '',
  lote_id: '', pasto_id: '', pai_descricao: '', situacao: 'ativo', obs: '', peso_inicial: '', matriz: false as boolean, touro: false as boolean, especie: 'Bovino', uso: '' }

export default function AnimalForm() {
  const { id } = useParams()
  const nav = useNavigate()
  const { gestor } = useAuth()
  const { fazendas, pastos, lotes } = useListas()
  const [params] = useSearchParams()
  const [v, setV] = useState({ ...VAZIO, chip: params.get('chip') || '' })
  const [erro, setErro] = useState(''), [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!id) return
    lerComCache<Animal[]>('v_animais', () => Promise.reject(new Error('fetch')), []).then(async r => {
      const { data } = await supabase.from('animais').select('*').eq('id', id).maybeSingle()
      const d = (data || r.dados.find(x => x.id === id)) as Record<string, unknown> | undefined
      if (!d) return
      setV({ ...VAZIO, ...Object.fromEntries(Object.entries(d).map(([k, x]) => [k, x ?? ''])), matriz: Boolean(d.matriz), touro: Boolean(d.touro) } as typeof VAZIO)
    })
  }, [id])
  useEffect(() => { if (!id && !v.fazenda_id && fazendas.length === 1) setV(x => ({ ...x, fazenda_id: fazendas[0].id })) }, [fazendas, id, v.fazenda_id])

  if (!gestor) return <p>Somente administrador ou gerente cadastra e edita animais.</p>
  const set = (k: keyof typeof VAZIO) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value })

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro('')
    if (!v.controle.trim() && !v.chip.trim() && !v.brinco.trim()) return setErro('Informe pelo menos o nº de controle, o chip ou o brinco.')
    if (v.nascimento && v.nascimento > hojeISO()) return setErro('A data de nascimento não pode ser no futuro.')
    setSalvando(true)
    const limpo = (s: string) => s.trim() || null
    const dados = {
      fazenda_id: v.fazenda_id, controle: limpo(v.controle), chip: limpo(v.chip), brinco: limpo(v.brinco), nome: limpo(v.nome),
      sexo: v.sexo, raca: limpo(v.raca), nascimento: v.nascimento || null, categoria: limpo(v.categoria),
      lote_id: v.lote_id || null, pasto_id: v.pasto_id || null, pai_descricao: limpo(v.pai_descricao), situacao: v.situacao, obs: limpo(v.obs), matriz: v.especie === 'Bovino' && v.sexo === 'F' && v.matriz, touro: v.especie === 'Bovino' && v.sexo === 'M' && v.touro, especie: v.especie, uso: v.especie === 'Equino' ? limpo(v.uso) : null,
    }
    // confere duplicidade com a lista guardada no aparelho (o banco confere de novo no envio)
    const guardados = (await lerComCache<Animal[]>('v_animais', () => Promise.reject(new Error('fetch')), [])).dados
    const igual = (x: string | null, y: string | null) => x && y && x.trim().toLowerCase() === y.trim().toLowerCase()
    const dup = guardados.find(a => a.id !== id && a.situacao === 'ativo' && (igual(a.chip, dados.chip) || igual(a.controle, dados.controle) || igual(a.brinco, dados.brinco)))
    if (dup) { setSalvando(false); return setErro(`Já existe um animal ativo com este número (controle ${dup.controle || '—'}, chip ${dup.chip || '—'}).`) }
    const nome = dados.controle || dados.chip || dados.brinco
    const novo = id || novoId()
    const enviado = id
      ? await enfileirar({ tipo: 'update', tabela: 'animais', alvo: id, dados }, `Alteração no cadastro do animal ${nome}`, id)
      : await enfileirar({ tipo: 'insert', tabela: 'animais', dados: { id: novo, ...dados } }, `Cadastro do animal ${nome}`, novo)
    const peso = Number(v.peso_inicial.replace(',', '.'))
    if (!id && peso > 0) await enfileirar({ tipo: 'insert', tabela: 'pesagens', dados: { id: novoId(), animal_id: novo, peso_kg: peso, data: hojeISO(), obs: 'Peso no cadastro', lancado_em: new Date().toISOString() } }, `Pesagem de ${nome}: ${peso} kg (cadastro)`, novo)
    setSalvando(false)
    nav(enviado ? `/animais/${novo}` : '/pendencias')
  }

  return (
    <form className="cartao formulario" onSubmit={salvar}>
      <h1>{id ? 'Editar animal' : 'Novo animal'}</h1>
      <div className="grade">
        <label>Fazenda *<select required value={v.fazenda_id} onChange={set('fazenda_id')}><option value="">Escolha…</option>{fazendas.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></label>
        <label>Espécie<select value={v.especie} onChange={e => setV({ ...v, especie: e.target.value, categoria: '', raca: e.target.value === 'Equino' && v.raca === 'NEL' ? '' : v.raca })}><option value="Bovino">Bovino</option><option value="Equino">Equino (cavalo, égua, muar)</option></select></label>
        <label>Nº de controle<input value={v.controle} onChange={set('controle')} /></label>
        <label>Chip eletrônico<input value={v.chip} onChange={set('chip')} /></label>
        <label>Brinco visual<input value={v.brinco} onChange={set('brinco')} /></label>
        <label>Nome / apelido<input value={v.nome} onChange={set('nome')} /></label>
        <label>Sexo *<select required value={v.sexo} onChange={set('sexo')}><option value="">Escolha…</option><option value="M">Macho</option><option value="F">Fêmea</option></select></label>
        <label>Raça<input list="racas" value={v.raca} onChange={set('raca')} placeholder={v.especie === 'Equino' ? 'ex.: Quarto de Milha, Mangalarga' : ''} /><datalist id="racas">{RACAS.map(r => <option key={r} value={r} />)}</datalist></label>
        <label>Nascimento<input type="date" max={hojeISO()} value={v.nascimento} onChange={set('nascimento')} /></label>
        {(v.especie === 'Equino' || !v.nascimento) && <label>{v.especie === 'Equino' ? 'Categoria' : 'Categoria (sem data de nascimento)'}<select value={v.categoria} onChange={set('categoria')}><option value="">—</option>{(v.especie === 'Equino' ? CATEGORIAS_EQUINOS : CATEGORIAS).map(c => <option key={c}>{c}</option>)}</select></label>}
        {v.especie === 'Equino' && <label>Uso<input placeholder="ex.: serviço, reprodução, aposentado" value={v.uso} onChange={set('uso')} /></label>}
        {v.especie === 'Bovino' && v.sexo === 'F' && <label className="check"><input type="checkbox" checked={v.matriz} onChange={e => setV({ ...v, matriz: e.target.checked })} /> Matriz (reprodução)</label>}
        {v.especie === 'Bovino' && v.sexo === 'M' && <label className="check"><input type="checkbox" checked={v.touro} onChange={e => setV({ ...v, touro: e.target.checked })} /> Touro</label>}
        <label>Lote<select value={v.lote_id} onChange={set('lote_id')}><option value="">—</option>{lotes.filter(l => l.fazenda_id === v.fazenda_id).map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}</select></label>
        <label>Pasto<select value={v.pasto_id} onChange={set('pasto_id')}><option value="">—</option>{pastos.filter(p => p.fazenda_id === v.fazenda_id).map(p => <option key={p.id} value={p.id}>{p.codigo}</option>)}</select></label>
        <label>Pai (descrição)<input placeholder="ex.: touro, sêmen" value={v.pai_descricao} onChange={set('pai_descricao')} /></label>
        {id && <label>Situação<select value={v.situacao} onChange={set('situacao')}>{Object.entries(SITUACAO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>}
        {!id && <label>Peso atual (kg)<input inputMode="decimal" value={v.peso_inicial} onChange={set('peso_inicial')} /></label>}
      </div>
      <label>Observações<textarea rows={3} value={v.obs} onChange={set('obs')} /></label>
      {erro && <p className="erro">{erro}</p>}
      <div className="acoes"><Link className="botao sec" to={id ? `/animais/${id}` : '/animais'}>Cancelar</Link><button disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button></div>
    </form>
  )
}
