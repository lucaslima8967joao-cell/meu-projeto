import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { erroAmigavel, hojeISO, num } from '../lib/formato'
import { buscarTodos, useListas } from '../lib/dados'
import { useAuth } from '../auth'
import type { Pasto } from '../lib/tipos'

const PASTO_VAZIO = { id: '', fazenda_id: '', codigo: '', codigo_antigo: '', nome: '', area_ha: '', lotacao_ua_chuva: '', lotacao_ua_seca: '', situacao: '', tipo_solo: '', obs: '' }

export default function Pastos() {
  const { gestor } = useAuth()
  const { fazendas, pastos, lotes, recarregar } = useListas()
  const [ocup, setOcup] = useState<Map<string, number>>(new Map())
  const [fz, setFz] = useState(''), [pf, setPf] = useState<typeof PASTO_VAZIO | null>(null)
  const [novoLote, setNovoLote] = useState({ nome: '', pasto_id: '' })
  const [movLote, setMovLote] = useState({ lote_id: '', destino: '', data: hojeISO(), motivo: '' })
  const [erro, setErro] = useState(''), [ok, setOk] = useState('')

  useEffect(() => {
    buscarTodos<{ pasto_id: string | null }>((de, ate) => supabase.from('animais').select('pasto_id').eq('situacao', 'ativo').eq('arquivado', false).order('id').range(de, ate))
      .then(l => { const m = new Map<string, number>(); l.forEach(a => a.pasto_id && m.set(a.pasto_id, (m.get(a.pasto_id) || 0) + 1)); setOcup(m) })
  }, [pastos])
  useEffect(() => { if (!fz && fazendas.length) setFz(fazendas[0].id) }, [fazendas, fz])

  const msg = (e: unknown, sucesso: string) => { if (e) setErro(erroAmigavel(e)); else { setErro(''); setOk(sucesso); recarregar() } }

  async function novaFazenda() {
    const nome = prompt('Nome da fazenda:')?.trim(); if (!nome) return
    const { error } = await supabase.from('fazendas').insert({ nome }); msg(error, 'Fazenda cadastrada.')
  }
  async function salvarPasto(e: React.FormEvent) {
    e.preventDefault(); if (!pf) return
    const n = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
    const dados = { fazenda_id: pf.fazenda_id || fz, codigo: pf.codigo.trim(), codigo_antigo: pf.codigo_antigo.trim() || null, nome: pf.nome.trim() || null,
      area_ha: n(pf.area_ha), lotacao_ua_chuva: n(pf.lotacao_ua_chuva), lotacao_ua_seca: n(pf.lotacao_ua_seca),
      situacao: pf.situacao || null, tipo_solo: pf.tipo_solo.trim() || null, obs: pf.obs.trim() || null }
    if ([dados.area_ha, dados.lotacao_ua_chuva, dados.lotacao_ua_seca].some(x => x !== null && (isNaN(x) || x < 0))) return setErro('Números inválidos.')
    const { error } = pf.id ? await supabase.from('pastos').update(dados).eq('id', pf.id) : await supabase.from('pastos').insert(dados)
    msg(error, 'Pasto salvo.'); if (!error) setPf(null)
  }
  async function arquivarPasto(p: Pasto) {
    if ((ocup.get(p.id) || 0) > 0) return setErro('Esse pasto ainda tem animais. Mova os animais antes de arquivar.')
    if (!confirm(`Arquivar o pasto ${p.codigo}? O histórico continua guardado.`)) return
    const { error } = await supabase.from('pastos').update({ arquivado: true }).eq('id', p.id); msg(error, 'Pasto arquivado.')
  }
  async function criarLote(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('lotes').insert({ fazenda_id: fz, nome: novoLote.nome.trim(), pasto_id: novoLote.pasto_id || null })
    msg(error, 'Lote criado.'); if (!error) setNovoLote({ nome: '', pasto_id: '' })
  }
  async function moverLote(e: React.FormEvent) {
    e.preventDefault()
    const l = lotes.find(x => x.id === movLote.lote_id)
    const { error } = await supabase.from('movimentacoes').insert({ lote_id: movLote.lote_id, pasto_origem_id: l?.pasto_id || null, pasto_destino_id: movLote.destino, data: movLote.data, motivo: movLote.motivo || null })
    msg(error, 'Lote movido. Todos os animais ativos do lote foram para o novo pasto.'); if (!error) setMovLote({ lote_id: '', destino: '', data: hojeISO(), motivo: '' })
  }

  const ps = pastos.filter(p => p.fazenda_id === fz), ls = lotes.filter(l => l.fazenda_id === fz)
  const total = ps.reduce((s, p) => s + (Number(p.area_ha) || 0), 0)
  const setP = (k: keyof typeof PASTO_VAZIO) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => pf && setPf({ ...pf, [k]: e.target.value })

  return (
    <>
      <div className="titulo-acoes">
        <h1>Pastos e lotes</h1>
        <div>
          <select value={fz} onChange={e => setFz(e.target.value)}>{fazendas.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}</select>
          {gestor && <button className="sec" onClick={novaFazenda}>+ Fazenda</button>}
          {gestor && fz && <button onClick={() => setPf({ ...PASTO_VAZIO, fazenda_id: fz })}>+ Pasto</button>}
        </div>
      </div>
      {erro && <p className="erro">{erro}</p>}{ok && <p className="ok">{ok}</p>}
      {!fazendas.length && <p className="vazio">Nenhuma fazenda cadastrada. {gestor ? 'Comece clicando em “+ Fazenda”.' : 'Peça ao administrador para cadastrar.'}</p>}

      {pf && <form className="cartao formulario" onSubmit={salvarPasto}>
        <h2>{pf.id ? 'Editar pasto' : 'Novo pasto'}</h2>
        <div className="grade">
          <label>Código (nº novo) *<input required placeholder="ex.: A1" value={pf.codigo} onChange={setP('codigo')} /></label>
          <label>Nº antigo<input value={pf.codigo_antigo} onChange={setP('codigo_antigo')} /></label>
          <label>Nome<input value={pf.nome} onChange={setP('nome')} /></label>
          <label>Área (ha)<input inputMode="decimal" value={pf.area_ha} onChange={setP('area_ha')} /></label>
          <label>Lotação chuva (UA)<input inputMode="decimal" value={pf.lotacao_ua_chuva} onChange={setP('lotacao_ua_chuva')} /></label>
          <label>Lotação seca (UA)<input inputMode="decimal" value={pf.lotacao_ua_seca} onChange={setP('lotacao_ua_seca')} /></label>
          <label>Situação do pasto<select value={pf.situacao} onChange={setP('situacao')}><option value="">—</option>{['Bom', 'Regular', 'Sujo/ruim', 'Mato'].map(s => <option key={s}>{s}</option>)}</select></label>
          <label>Tipo de solo<input value={pf.tipo_solo} onChange={setP('tipo_solo')} /></label>
        </div>
        <label>Observações<textarea rows={2} value={pf.obs} onChange={setP('obs')} /></label>
        <div className="acoes"><button type="button" className="sec" onClick={() => setPf(null)}>Cancelar</button><button>Salvar</button></div>
      </form>}

      {fz && <section className="cartao">
        <h2>Pastos ({ps.length}) · {num(total)} ha</h2>
        <div className="tabela-rolagem"><table className="lista">
          <thead><tr><th>Código</th><th>Nº antigo</th><th>Área (ha)</th><th>Situação</th><th>Lotação chuva/seca (UA)</th><th>Animais agora</th><th>Solo</th>{gestor && <th></th>}</tr></thead>
          <tbody>{ps.map(p => <tr key={p.id}>
            <td><b>{p.codigo}</b>{p.nome && <small> {p.nome}</small>}</td><td>{p.codigo_antigo || '—'}</td><td className="num">{num(p.area_ha)}</td>
            <td>{p.situacao || '—'}</td><td>{num(p.lotacao_ua_chuva, 1)} / {num(p.lotacao_ua_seca, 1)}</td><td className="num">{ocup.get(p.id) || 0}</td><td>{p.tipo_solo || '—'}</td>
            {gestor && <td className="acoes-linha">
              <button className="sec mini" onClick={() => setPf(Object.fromEntries(Object.entries({ ...PASTO_VAZIO, ...p }).map(([k, x]) => [k, x === null ? '' : String(x)])) as typeof PASTO_VAZIO)}>Editar</button>
              <button className="perigo mini" onClick={() => arquivarPasto(p)}>Arquivar</button></td>}
          </tr>)}</tbody></table></div>
        {!ps.length && <p className="vazio">Nenhum pasto cadastrado nesta fazenda.</p>}
      </section>}

      {fz && <div className="duas">
        <section className="cartao">
          <h2>Lotes</h2>
          {ls.length ? <table><tbody>{ls.map(l => <tr key={l.id}><td><b>{l.nome}</b></td><td>{pastos.find(p => p.id === l.pasto_id)?.codigo || 'sem pasto'}</td></tr>)}</tbody></table> : <p className="vazio">Nenhum lote.</p>}
          {gestor && <form className="linha" onSubmit={criarLote}>
            <input required placeholder="Nome do lote" value={novoLote.nome} onChange={e => setNovoLote({ ...novoLote, nome: e.target.value })} />
            <select value={novoLote.pasto_id} onChange={e => setNovoLote({ ...novoLote, pasto_id: e.target.value })}><option value="">Pasto…</option>{ps.map(p => <option key={p.id} value={p.id}>{p.codigo}</option>)}</select>
            <button>Criar lote</button></form>}
        </section>
        <section className="cartao">
          <h2>Mover lote de pasto</h2>
          <form className="formulario" onSubmit={moverLote}>
            <select required value={movLote.lote_id} onChange={e => setMovLote({ ...movLote, lote_id: e.target.value })}><option value="">Lote…</option>{ls.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}</select>
            <select required value={movLote.destino} onChange={e => setMovLote({ ...movLote, destino: e.target.value })}><option value="">Pasto de destino…</option>{ps.map(p => <option key={p.id} value={p.id}>{p.codigo}</option>)}</select>
            <input type="date" required max={hojeISO()} value={movLote.data} onChange={e => setMovLote({ ...movLote, data: e.target.value })} />
            <input placeholder="Motivo" value={movLote.motivo} onChange={e => setMovLote({ ...movLote, motivo: e.target.value })} />
            <button>Mover lote</button>
          </form>
        </section>
      </div>}
    </>
  )
}
