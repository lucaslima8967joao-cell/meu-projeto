import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { TIPOS_AREA, baixarCSV, erroAmigavel, hojeISO, num, ordemNatural } from '../lib/formato'
import { buscarTodos, useListas } from '../lib/dados'
import { enfileirar, lerComCache, novoId } from '../lib/offline'
import { AvisoCache } from './Pendencias'
import { useAuth } from '../auth'
import type { Pasto } from '../lib/tipos'

const PASTO_VAZIO = { id: '', fazenda_id: '', codigo: '', codigo_antigo: '', nome: '', tipo: 'Pasto', area_ha: '', area_soja_ha: '', area_reflorest_ha: '', area_sem_def_ha: '',
  pasto_boa_ha: '', pasto_media_ha: '', pasto_ruim_ha: '', pasto_degradada_ha: '', lotacao_ua_chuva: '', lotacao_ua_seca: '', tipo_solo: '', obs: '' }
const NUMS = ['area_ha', 'area_soja_ha', 'area_reflorest_ha', 'area_sem_def_ha', 'pasto_boa_ha', 'pasto_media_ha', 'pasto_ruim_ha', 'pasto_degradada_ha', 'lotacao_ua_chuva', 'lotacao_ua_seca'] as const

export default function Pastos() {
  const { gestor } = useAuth()
  const { fazendas, lotes, recarregar } = useListas()
  const [pastos, setPastos] = useState<Pasto[]>([])
  const [filtroTipo, setFiltroTipo] = useState('Pasto')
  const [fz, setFz] = useState(''), [pf, setPf] = useState<typeof PASTO_VAZIO | null>(null)
  const [novoLote, setNovoLote] = useState({ nome: '', pasto_id: '' })
  const [movLote, setMovLote] = useState({ lote_id: '', destino: '', data: hojeISO(), motivo: '' })
  const [erro, setErro] = useState(''), [ok, setOk] = useState('')

  const [n, setN] = useState(0)
  const [cache, setCache] = useState<{ doCache: boolean; em?: string }>({ doCache: false })
  useEffect(() => {
    lerComCache('v_pastos', () => buscarTodos<Pasto>((de, ate) => supabase.from('v_pastos').select('*').eq('arquivado', false).order('codigo').range(de, ate)), [] as Pasto[])
      .then(r => { setPastos([...r.dados].sort((a, b) => ordemNatural(a.codigo, b.codigo))); setCache(r) }, () => setPastos([]))
  }, [n])
  useEffect(() => { if (!fz && fazendas.length) setFz(fazendas[0].id) }, [fazendas, fz])

  const msg = (e: unknown, sucesso: string) => { if (e) setErro(erroAmigavel(e)); else { setErro(''); setOk(sucesso); recarregar(); setN(x => x + 1) } }

  async function novaFazenda() {
    const nome = prompt('Nome da fazenda:')?.trim(); if (!nome) return
    const { error } = await supabase.from('fazendas').insert({ nome }); msg(error, 'Fazenda cadastrada.')
  }
  async function salvarPasto(e: React.FormEvent) {
    e.preventDefault(); if (!pf) return
    const n = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
    const numeros = Object.fromEntries(NUMS.map(k => [k, n(pf[k])]))
    if (Object.values(numeros).some(x => x !== null && (isNaN(x) || x < 0))) return setErro('Algum número está inválido.')
    const dados = { fazenda_id: pf.fazenda_id || fz, codigo: pf.codigo.trim(), codigo_antigo: pf.codigo_antigo.trim() || null, nome: pf.nome.trim() || null,
      tipo: pf.tipo || null, ...numeros, tipo_solo: pf.tipo_solo.trim() || null, obs: pf.obs.trim() || null }
    const { error } = pf.id ? await supabase.from('pastos').update(dados).eq('id', pf.id) : await supabase.from('pastos').insert(dados)
    msg(error, 'Pasto salvo.'); if (!error) setPf(null)
  }
  async function arquivarPasto(p: Pasto) {
    if ((p.animais_agora || 0) > 0) return setErro('Esse pasto ainda tem animais. Mova os animais antes de arquivar.')
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
    const destino = pastos.find(p => p.id === movLote.destino)?.codigo
    const enviado = await enfileirar({ tipo: 'insert', tabela: 'movimentacoes', dados: { id: novoId(), lote_id: movLote.lote_id, pasto_origem_id: l?.pasto_id || null, pasto_destino_id: movLote.destino, data: movLote.data, motivo: movLote.motivo || null, lancado_em: new Date().toISOString() } },
      `Lote ${l?.nome} mudou para o pasto ${destino}`)
    msg(null, enviado ? 'Lote movido. Todos os animais ativos do lote foram para o novo pasto.' : 'Movimentação do lote guardada no aparelho. Será enviada quando houver internet.')
    setMovLote({ lote_id: '', destino: '', data: hojeISO(), motivo: '' })
  }

  const todasAreas = pastos.filter(p => p.fazenda_id === fz), ls = lotes.filter(l => l.fazenda_id === fz)
  const ps = todasAreas.filter(p => !filtroTipo || p.tipo === filtroTipo)
  const soPastos = todasAreas.filter(p => p.tipo === 'Pasto' || p.tipo === 'Eucalipto')
  const total = ps.reduce((s, p) => s + (Number(p.area_ha) || 0), 0)
  const soma = (k: keyof Pasto) => ps.reduce((s, p) => s + (Number(p[k]) || 0), 0)
  const exportar = () => baixarCSV('areas.csv', ['Código', 'Nº antigo', 'Tipo', 'Área (ha)', 'Soja', 'Reflorest.', 'Sem def.', 'Pasto boa', 'Pasto média', 'Pasto ruim', 'Degradada/Mato', 'Lotação chuva', 'Lotação seca', 'Capacidade (UA)', 'Animais agora', 'Obs.'],
    ps.map(p => [p.codigo, p.codigo_antigo, p.tipo, p.area_ha, p.area_soja_ha, p.area_reflorest_ha, p.area_sem_def_ha, p.pasto_boa_ha, p.pasto_media_ha, p.pasto_ruim_ha, p.pasto_degradada_ha, p.lotacao_ua_chuva, p.lotacao_ua_seca, p.capacidade_ua, p.animais_agora, p.obs].map(v => typeof v === 'number' ? String(v).replace('.', ',') : v)))
  const setP = (k: keyof typeof PASTO_VAZIO) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => pf && setPf({ ...pf, [k]: e.target.value })

  return (
    <>
      <div className="titulo-acoes">
        <h1>Áreas e lotes</h1>
        <div>
          <select value={fz} onChange={e => setFz(e.target.value)}>{fazendas.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}</select>
          {gestor && <button className="sec" onClick={novaFazenda}>+ Fazenda</button>}
          {gestor && fz && <button onClick={() => setPf({ ...PASTO_VAZIO, fazenda_id: fz })}>+ Pasto</button>}
        </div>
      </div>
      <AvisoCache {...cache} />
      {erro && <p className="erro">{erro}</p>}{ok && <p className="ok">{ok}</p>}
      {!fazendas.length && <p className="vazio">Nenhuma fazenda cadastrada. {gestor ? 'Comece clicando em “+ Fazenda”.' : 'Peça ao administrador para cadastrar.'}</p>}

      {pf && <form className="cartao formulario" onSubmit={salvarPasto}>
        <h2>{pf.id ? 'Editar pasto' : 'Novo pasto'}</h2>
        <div className="grade">
          <label>Código (nº novo) *<input required placeholder="ex.: A1" value={pf.codigo} onChange={setP('codigo')} /></label>
          <label>Nº antigo<input value={pf.codigo_antigo} onChange={setP('codigo_antigo')} /></label>
          <label>Nome<input value={pf.nome} onChange={setP('nome')} /></label>
          <label>Tipo<select value={pf.tipo} onChange={setP('tipo')}>{TIPOS_AREA.map(t => <option key={t}>{t}</option>)}</select></label>
          <label>Área total (ha)<input inputMode="decimal" value={pf.area_ha} onChange={setP('area_ha')} /></label>
          <label>Lavoura soja (ha)<input inputMode="decimal" value={pf.area_soja_ha} onChange={setP('area_soja_ha')} /></label>
          <label>Reflorestamento (ha)<input inputMode="decimal" value={pf.area_reflorest_ha} onChange={setP('area_reflorest_ha')} /></label>
          <label>Sem definição (ha)<input inputMode="decimal" value={pf.area_sem_def_ha} onChange={setP('area_sem_def_ha')} /></label>
          <label>Pasto boa (ha)<input inputMode="decimal" value={pf.pasto_boa_ha} onChange={setP('pasto_boa_ha')} /></label>
          <label>Pasto média (ha)<input inputMode="decimal" value={pf.pasto_media_ha} onChange={setP('pasto_media_ha')} /></label>
          <label>Pasto ruim (ha)<input inputMode="decimal" value={pf.pasto_ruim_ha} onChange={setP('pasto_ruim_ha')} /></label>
          <label>Degradada/Mato (ha)<input inputMode="decimal" value={pf.pasto_degradada_ha} onChange={setP('pasto_degradada_ha')} /></label>
          <label>Lotação chuva (UA/ha)<input inputMode="decimal" value={pf.lotacao_ua_chuva} onChange={setP('lotacao_ua_chuva')} /></label>
          <label>Lotação seca (UA/ha)<input inputMode="decimal" value={pf.lotacao_ua_seca} onChange={setP('lotacao_ua_seca')} /></label>
          <label>Tipo de solo<input value={pf.tipo_solo} onChange={setP('tipo_solo')} /></label>
        </div>
        <label>Observações<textarea rows={2} value={pf.obs} onChange={setP('obs')} /></label>
        <div className="acoes"><button type="button" className="sec" onClick={() => setPf(null)}>Cancelar</button><button>Salvar</button></div>
      </form>}

      {fz && <section className="cartao">
        <div className="titulo-acoes">
          <h2>Áreas ({ps.length}) · {num(total)} ha</h2>
          <div>
            <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}><option value="">Todos os tipos</option>{TIPOS_AREA.map(t => <option key={t}>{t}</option>)}</select>
            <button className="sec" onClick={exportar} disabled={!ps.length}>Exportar Excel (CSV)</button>
          </div>
        </div>
        <p className="contagem">Pasto boa {num(soma('pasto_boa_ha'))} ha · média {num(soma('pasto_media_ha'))} ha · ruim {num(soma('pasto_ruim_ha'))} ha · degradada/mato {num(soma('pasto_degradada_ha'))} ha
          {' '}· capacidade {num(soma('capacidade_ua'), 0)} UA · animais agora {soma('animais_agora')}</p>
        <div className="tabela-rolagem"><table className="lista">
          <thead><tr><th>Código</th><th>Nº antigo</th><th>Tipo</th><th className="num">Área (ha)</th><th>Uso</th><th>Lotação chuva/seca</th><th className="num">Capacidade (UA)</th><th className="num">Animais agora</th>{gestor && <th></th>}</tr></thead>
          <tbody>{ps.map(p => <tr key={p.id} title={p.obs || ''}>
            <td><b>{p.codigo}</b>{p.nome && <small> {p.nome}</small>}{p.obs && <small> ⚠️</small>}</td><td>{p.codigo_antigo || '—'}</td><td>{p.tipo || '—'}</td>
            <td className="num">{num(p.area_ha)}</td>
            <td><small>{[['soja', p.area_soja_ha], ['reflorest.', p.area_reflorest_ha], ['sem def.', p.area_sem_def_ha], ['boa', p.pasto_boa_ha], ['média', p.pasto_media_ha], ['ruim', p.pasto_ruim_ha], ['degr./mato', p.pasto_degradada_ha]]
              .filter(([, v]) => v).map(([t, v]) => `${t} ${num(v as number)}`).join(' · ') || '—'}</small></td>
            <td>{p.lotacao_ua_chuva == null ? '—' : Number(p.lotacao_ua_chuva).toLocaleString('pt-BR')} / {p.lotacao_ua_seca == null ? '—' : Number(p.lotacao_ua_seca).toLocaleString('pt-BR')}</td>
            <td className="num">{p.capacidade_ua ?? '—'}</td>
            <td className="num">{p.animais_agora || 0}</td>
            {gestor && <td className="acoes-linha">
              <button className="sec mini" onClick={() => setPf(Object.fromEntries(Object.keys(PASTO_VAZIO).map(k => [k, (p as unknown as Record<string, unknown>)[k] == null ? '' : String((p as unknown as Record<string, unknown>)[k])])) as typeof PASTO_VAZIO)}>Editar</button>
              <button className="perigo mini" onClick={() => arquivarPasto(p)}>Arquivar</button></td>}
          </tr>)}</tbody></table></div>
        {!ps.length && <p className="vazio">Nenhuma área deste tipo.</p>}
        <p><small>⚠️ = há observação (passe o mouse ou edite para ver). Capacidade = área × média da lotação chuva/seca, igual à planilha.</small></p>
      </section>}

      {fz && <div className="duas">
        <section className="cartao">
          <h2>Lotes</h2>
          {ls.length ? <table><tbody>{ls.map(l => <tr key={l.id}><td><b>{l.nome}</b></td><td>{pastos.find(p => p.id === l.pasto_id)?.codigo || 'sem pasto'}</td></tr>)}</tbody></table> : <p className="vazio">Nenhum lote.</p>}
          {gestor && <form className="linha" onSubmit={criarLote}>
            <input required placeholder="Nome do lote" value={novoLote.nome} onChange={e => setNovoLote({ ...novoLote, nome: e.target.value })} />
            <select value={novoLote.pasto_id} onChange={e => setNovoLote({ ...novoLote, pasto_id: e.target.value })}><option value="">Pasto…</option>{soPastos.map(p => <option key={p.id} value={p.id}>{p.codigo}</option>)}</select>
            <button>Criar lote</button></form>}
        </section>
        <section className="cartao">
          <h2>Mover lote de pasto</h2>
          <form className="formulario" onSubmit={moverLote}>
            <select required value={movLote.lote_id} onChange={e => setMovLote({ ...movLote, lote_id: e.target.value })}><option value="">Lote…</option>{ls.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}</select>
            <select required value={movLote.destino} onChange={e => setMovLote({ ...movLote, destino: e.target.value })}><option value="">Pasto de destino…</option>{soPastos.map(p => <option key={p.id} value={p.id}>{p.codigo}</option>)}</select>
            <input type="date" required max={hojeISO()} value={movLote.data} onChange={e => setMovLote({ ...movLote, data: e.target.value })} />
            <input placeholder="Motivo" value={movLote.motivo} onChange={e => setMovLote({ ...movLote, motivo: e.target.value })} />
            <button>Mover lote</button>
          </form>
        </section>
      </div>}
    </>
  )
}
