import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { RACAS, SEXO, dataBR, hojeISO, kg } from '../lib/formato'
import { buscarTodos, useListas } from '../lib/dados'
import { enfileirar, lerComCache, novoId, q as consulta } from '../lib/offline'
import type { Animal } from '../lib/tipos'

interface Nasc { id: string; data: string; peso_nascer_kg: number | null; bezerro: Animal | null; mae: { controle: string | null; chip: string | null } | null }

export default function Nascimento() {
  const [params] = useSearchParams()
  const { fazendas } = useListas()
  const [maes, setMaes] = useState<Animal[]>([])
  const [recentes, setRecentes] = useState<Nasc[]>([])
  const [v, setV] = useState({ fazenda_id: '', mae_id: params.get('mae') || '', pai: '', data: hojeISO(), sexo: '', raca: 'NEL', peso: '', controle: '', chip: '', brinco: '', obs: '' })
  const [buscaMae, setBuscaMae] = useState('')
  const [erro, setErro] = useState(''), [ok, setOk] = useState(''), [salvando, setSalvando] = useState(false)

  const carregar = () => lerComCache('nascimentos:recentes', () => consulta<Nasc[]>(supabase.from('nascimentos')
    .select('id, data, peso_nascer_kg, bezerro:bezerro_id(id, controle, chip, brinco, sexo), mae:mae_id(controle, chip)')
    .order('data', { ascending: false }).limit(20)), []).then(r => setRecentes(r.dados))

  useEffect(() => {
    lerComCache('v_animais', () => buscarTodos<Animal>((de, ate) => supabase.from('v_animais').select('*').eq('arquivado', false).order('controle').order('id').range(de, ate)), [] as Animal[])
      .then(r => setMaes(r.dados.filter(a => a.sexo === 'F' && a.situacao === 'ativo')))
    carregar()
  }, [])
  useEffect(() => {
    const m = maes.find(x => x.id === v.mae_id)
    if (m) setV(x => ({ ...x, fazenda_id: m.fazenda_id, raca: m.raca || x.raca }))
    else if (!v.fazenda_id && fazendas.length === 1) setV(x => ({ ...x, fazenda_id: fazendas[0].id }))
  }, [v.mae_id, maes, fazendas, v.fazenda_id])

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value })
  const q = buscaMae.trim().toLowerCase()
  const maesFiltradas = q ? maes.filter(m => [m.controle, m.chip, m.brinco].some(x => x?.toLowerCase().includes(q))).slice(0, 50) : []
  const maeSel = maes.find(m => m.id === v.mae_id)

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setOk('')
    if (v.data > hojeISO()) return setErro('A data do nascimento não pode ser no futuro.')
    const peso = v.peso ? Number(v.peso.replace(',', '.')) : null
    if (peso !== null && !(peso > 0 && peso < 100)) return setErro('Peso ao nascer deve ser entre 1 e 99 kg.')
    if (!v.controle.trim() && !v.chip.trim() && !v.brinco.trim() && !v.mae_id)
      return setErro('Sem número no bezerro, informe pelo menos a mãe para identificá-lo.')
    setSalvando(true)
    const bezerro = novoId()
    const mae = maes.find(m => m.id === v.mae_id)
    const enviado = await enfileirar({ tipo: 'rpc', funcao: 'registrar_nascimento', args: {
      p_fazenda_id: v.fazenda_id, p_mae_id: v.mae_id || null, p_pai_id: null, p_pai_descricao: v.pai,
      p_data: v.data, p_sexo: v.sexo, p_raca: v.raca, p_peso: peso,
      p_controle: v.controle, p_chip: v.chip, p_brinco: v.brinco, p_obs: v.obs || null, p_id: bezerro,
    } }, `Nascimento: ${v.sexo === 'M' ? 'macho' : 'fêmea'} em ${v.data.split('-').reverse().join('/')}${mae ? `, mãe ${mae.controle || mae.chip}` : ''}`, bezerro)
    setSalvando(false)
    setOk(enviado ? 'Nascimento registrado.' : 'Nascimento guardado no aparelho. Será enviado quando houver internet.')
    setV({ ...v, sexo: '', peso: '', controle: '', chip: '', brinco: '', obs: '', mae_id: '' }); setBuscaMae('')
    carregar()
  }

  return (
    <>
      <h1>Registrar nascimento</h1>
      <form className="cartao formulario" onSubmit={salvar}>
        <label>Mãe (matriz) — busque por controle ou chip
          <input placeholder="Digite o número da mãe…" value={maeSel ? (maeSel.controle || maeSel.chip || '') : buscaMae}
            onChange={e => { setBuscaMae(e.target.value); setV({ ...v, mae_id: '' }) }} />
        </label>
        {!maeSel && maesFiltradas.length > 0 && <div className="sugestoes">{maesFiltradas.map(m =>
          <button type="button" key={m.id} className="sec mini" onClick={() => setV({ ...v, mae_id: m.id })}>{m.controle || m.chip || m.brinco}</button>)}</div>}
        <div className="grade">
          <label>Fazenda *<select required value={v.fazenda_id} onChange={set('fazenda_id')}><option value="">Escolha…</option>{fazendas.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></label>
          <label>Data *<input type="date" required max={hojeISO()} value={v.data} onChange={set('data')} /></label>
          <label>Sexo *<select required value={v.sexo} onChange={set('sexo')}><option value="">Escolha…</option><option value="M">Macho</option><option value="F">Fêmea</option></select></label>
          <label>Raça<input list="racas2" value={v.raca} onChange={set('raca')} /><datalist id="racas2">{RACAS.map(r => <option key={r} value={r} />)}</datalist></label>
          <label>Peso ao nascer (kg)<input inputMode="decimal" value={v.peso} onChange={set('peso')} /></label>
          <label>Pai (se souber)<input placeholder="touro, sêmen…" value={v.pai} onChange={set('pai')} /></label>
          <label>Nº de controle<input value={v.controle} onChange={set('controle')} /></label>
          <label>Chip<input value={v.chip} onChange={set('chip')} /></label>
          <label>Brinco<input value={v.brinco} onChange={set('brinco')} /></label>
        </div>
        <label>Observações<textarea rows={2} value={v.obs} onChange={set('obs')} /></label>
        {erro && <p className="erro">{erro}</p>}{ok && <p className="ok">{ok}</p>}
        <div className="acoes"><button disabled={salvando}>{salvando ? 'Salvando…' : 'Registrar nascimento'}</button></div>
      </form>
      <section className="cartao">
        <h2>Últimos nascimentos</h2>
        {recentes.length ? <table><thead><tr><th>Data</th><th>Bezerro</th><th>Sexo</th><th>Mãe</th><th>Peso</th></tr></thead>
          <tbody>{recentes.map(n => <tr key={n.id}><td>{dataBR(n.data)}</td>
            <td>{n.bezerro && <Link to={`/animais/${n.bezerro.id}`}>{n.bezerro.controle || n.bezerro.chip || n.bezerro.brinco || 'sem número'}</Link>}</td>
            <td>{n.bezerro && SEXO[n.bezerro.sexo]}</td><td>{n.mae?.controle || n.mae?.chip || '—'}</td><td className="num">{kg(n.peso_nascer_kg)}</td></tr>)}</tbody></table>
          : <p className="vazio">Nenhum nascimento registrado.</p>}
      </section>
    </>
  )
}
