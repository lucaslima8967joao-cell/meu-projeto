import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { hojeISO, num, reais } from '../lib/formato'
import { useListas } from '../lib/dados'
import { enfileirar, novoId } from '../lib/offline'

interface Linha { controle: string; chip: string; peso: string; raca: string; nascimento: string }
const LINHA: Linha = { controle: '', chip: '', peso: '', raca: 'NEL', nascimento: '' }
const n = (v: string) => (v.trim() ? Number(v.replace(/\./g, '').replace(',', '.')) : null)

/** Lançamento de venda no mesmo formato da planilha "VENDA": cabeçalho + lista de animais + resumo. */
export default function VendaNova() {
  const nav = useNavigate()
  const { fazendas } = useListas()
  const [v, setV] = useState({ data: hojeISO(), comprador: '', notas_fiscais: '', sexo: 'M', categoria: '', quantidade: '', peso_balanca_kg: '', peso_frigorifico_kg: '', valor_arroba: '', valor_total: '', forma_pagamento: '', obs: '' })
  const [itens, setItens] = useState<Linha[]>([{ ...LINHA }])
  const [colar, setColar] = useState('')
  const [erro, setErro] = useState(''), [salvando, setSalvando] = useState(false)

  const validos = itens.filter(i => i.controle.trim() || i.chip.trim())
  const pesoItens = validos.reduce((s, i) => s + (n(i.peso) || 0), 0)
  const pesoBal = n(v.peso_balanca_kg) ?? (pesoItens || null)
  const cab = n(v.quantidade) ?? validos.length
  const pesoFrig = n(v.peso_frigorifico_kg)
  // @ por cabeça: frigorífico usa peso de carcaça (÷15); venda em pé usa peso vivo ÷30 (padrão de mercado para boi em pé)
  const mediaArroba = cab ? (pesoFrig ? pesoFrig / 15 / cab : pesoBal ? pesoBal / 30 / cab : null) : null
  const valorTotal = n(v.valor_total) ?? (mediaArroba && n(v.valor_arroba) && cab ? mediaArroba * cab * (n(v.valor_arroba) as number) : null)
  const rendimento = pesoFrig && pesoBal ? (pesoFrig / pesoBal) * 100 : null

  const repetidos = (() => { const c = new Map<string, number>(); validos.forEach(i => { const k = (i.controle || i.chip).trim().toLowerCase(); c.set(k, (c.get(k) || 0) + 1) }); return [...c].filter(([, q]) => q > 1).map(([k]) => k) })()

  function importarColado() {
    // aceita linhas copiadas do Excel: controle [tab] chip [tab] peso [tab] raça [tab] nascimento (dd/mm/aaaa)
    const linhas = colar.split(/\r?\n/).map(l => l.split('\t').map(x => x.trim())).filter(c => c.some(Boolean))
    const novos = linhas.map(c => ({ controle: c[0] || '', chip: c[1] || '', peso: c[2] || '', raca: c[3] || 'NEL',
      nascimento: /^\d{2}\/\d{2}\/\d{4}$/.test(c[4] || '') ? c[4].split('/').reverse().join('-') : '' }))
    setItens([...validos, ...novos]); setColar('')
  }
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro('')
    if (!fazendas[0]) return setErro('Cadastre a fazenda primeiro.')
    if (!validos.length) return setErro('Inclua pelo menos um animal (controle ou chip).')
    if (repetidos.length && !confirm(`Número repetido na lista: ${repetidos.join(', ')}. Salvar mesmo assim?`)) return
    if (n(v.quantidade) && n(v.quantidade) !== validos.length && !confirm(`Quantidade informada (${v.quantidade}) é diferente do número de animais na lista (${validos.length}). Salvar mesmo assim?`)) return
    setSalvando(true)
    const id = novoId()
    const enviado = await enfileirar({ tipo: 'rpc', funcao: 'registrar_venda', args: { p_id: id,
      p_venda: { fazenda_id: fazendas[0].id, data: v.data, comprador: v.comprador.trim(), notas_fiscais: v.notas_fiscais, sexo: v.sexo, categoria: v.categoria,
        quantidade: cab, peso_balanca_kg: pesoBal, peso_frigorifico_kg: pesoFrig, rendimento_pct: rendimento, media_arroba: mediaArroba,
        valor_arroba: n(v.valor_arroba), valor_total: valorTotal, forma_pagamento: v.forma_pagamento, obs: v.obs },
      p_itens: validos.map(i => ({ controle: i.controle.trim(), chip: i.chip.trim(), peso_kg: n(i.peso), raca: i.raca.trim(), nascimento: i.nascimento || null })) } },
      `Venda ${v.comprador} · ${validos.length} animais · ${v.data.split('-').reverse().join('/')}`)
    setSalvando(false)
    nav(enviado ? `/vendas/${id}` : '/pendencias')
  }
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value })
  const setI = (k: number, campo: keyof Linha, valor: string) => setItens(itens.map((x, i) => (i === k ? { ...x, [campo]: valor } : x)))

  return (
    <form onSubmit={salvar}>
      <div className="titulo-acoes"><h1>Nova venda</h1><Link className="botao sec" to="/vendas">← Voltar</Link></div>
      <section className="cartao formulario">
        <div className="grade">
          <label>Data *<input type="date" required max={hojeISO()} value={v.data} onChange={set('data')} /></label>
          <label>Comprador *<input required value={v.comprador} onChange={set('comprador')} /></label>
          <label>Notas fiscais<input placeholder="ex.: 5934/35" value={v.notas_fiscais} onChange={set('notas_fiscais')} /></label>
          <label>Sexo<select value={v.sexo} onChange={set('sexo')}><option value="M">Macho</option><option value="F">Fêmea</option><option value="Misto">Misto</option></select></label>
          <label>Categoria<input placeholder="ex.: Bezerro, Vaca/Novilha" value={v.categoria} onChange={set('categoria')} /></label>
          <label>Quantidade (cab.)<input inputMode="numeric" placeholder={String(validos.length)} value={v.quantidade} onChange={set('quantidade')} /></label>
          <label>Peso balança total (kg)<input inputMode="decimal" placeholder={pesoItens ? num(pesoItens, 0) : ''} value={v.peso_balanca_kg} onChange={set('peso_balanca_kg')} /></label>
          <label>Peso frigorífico (kg)<input inputMode="decimal" value={v.peso_frigorifico_kg} onChange={set('peso_frigorifico_kg')} /></label>
          <label>Valor da @ (R$)<input inputMode="decimal" value={v.valor_arroba} onChange={set('valor_arroba')} /></label>
          <label>Valor total (R$)<input inputMode="decimal" placeholder={valorTotal ? num(valorTotal) : ''} value={v.valor_total} onChange={set('valor_total')} /></label>
          <label>Forma de pagamento<input value={v.forma_pagamento} onChange={set('forma_pagamento')} /></label>
          <label>Observação<input value={v.obs} onChange={set('obs')} /></label>
        </div>
        <p className="contagem">Resumo: {validos.length} animais · peso {pesoBal ? `${num(pesoBal, 0)} kg` : '—'}{rendimento ? ` · rendimento ${num(rendimento, 1)}%` : ''}
          {mediaArroba ? ` · média ${num(mediaArroba, 2)} @/cab` : ''}{valorTotal ? ` · total ${reais(valorTotal)}` : ''}</p>
        <p><small>Média @: com peso de frigorífico usa carcaça ÷ 15 kg; sem ele, peso vivo ÷ 30 kg. Se a nota tiver outro valor, digite o valor total direto.</small></p>
      </section>

      <section className="cartao">
        <h2>Animais ({validos.length})</h2>
        {repetidos.length > 0 && <p className="aviso">⚠️ Número repetido na lista: {repetidos.join(', ')}</p>}
        <div className="tabela-rolagem"><table className="itens-venda">
          <thead><tr><th>#</th><th>Controle</th><th>Chip</th><th>Peso (kg)</th><th>Raça</th><th>Nascimento</th><th></th></tr></thead>
          <tbody>{itens.map((i, k) => <tr key={k}>
            <td>{k + 1}</td>
            <td><input value={i.controle} onChange={e => setI(k, 'controle', e.target.value)} /></td>
            <td><input value={i.chip} onChange={e => setI(k, 'chip', e.target.value)} /></td>
            <td><input inputMode="decimal" value={i.peso} onChange={e => setI(k, 'peso', e.target.value)} /></td>
            <td><input value={i.raca} onChange={e => setI(k, 'raca', e.target.value)} /></td>
            <td><input type="date" max={hojeISO()} value={i.nascimento} onChange={e => setI(k, 'nascimento', e.target.value)} /></td>
            <td><button type="button" className="perigo mini" onClick={() => setItens(itens.length > 1 ? itens.filter((_, j) => j !== k) : [{ ...LINHA }])}>×</button></td>
          </tr>)}</tbody>
        </table></div>
        <button type="button" className="sec" onClick={() => setItens([...itens, { ...LINHA, raca: itens[itens.length - 1]?.raca || 'NEL' }])}>+ Animal</button>
        <details><summary>Colar lista do Excel</summary>
          <p><small>Copie as colunas Controle, Chip, Peso, Raça e Nascimento (nessa ordem) da planilha e cole aqui.</small></p>
          <textarea rows={4} value={colar} onChange={e => setColar(e.target.value)} />
          <button type="button" className="sec" onClick={importarColado} disabled={!colar.trim()}>Adicionar à lista</button>
        </details>
      </section>
      {erro && <p className="erro">{erro}</p>}
      <div className="acoes"><Link className="botao sec" to="/vendas">Cancelar</Link><button disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar venda'}</button></div>
    </form>
  )
}
