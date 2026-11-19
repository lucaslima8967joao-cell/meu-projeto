import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { dataBR, erroAmigavel, hojeISO, num, reais } from '../lib/formato'
import { useListas } from '../lib/dados'
import { enfileirar, lerComCache, novoId, q } from '../lib/offline'
import { useAuth } from '../auth'
import { AvisoCache } from './Pendencias'

interface Maquina { id: string; nome: string; tipo: string | null; patrimonio: string | null; marca: string | null; modelo: string | null; ano: number | null; placa_serie: string | null; localizacao: string | null; estado: string | null; unidade_uso: 'h' | 'km'; uso_atual: number; revisao_a_cada: number | null; ultima_revisao_uso: number | null; proxima_revisao: number | null; situacao_revisao: string; obs: string | null }
interface Manut { id: string; maquina_id: string; data: string; tipo: string; descricao: string; uso: number | null; custo: number | null; prestador: string | null }
interface Abast { id: string; data: string; quantidade: number; uso_maquina: number | null; maquina_id: string | null; responsavel_texto: string | null; insumos: { nome: string; unidade: string } | null }
interface Comb { id: string; nome: string; unidade: string; saldo: number }

const VAZIA = { nome: '', tipo: 'Trator', patrimonio: '', marca: '', modelo: '', ano: '', placa_serie: '', localizacao: '', estado: 'Bom', unidade_uso: 'h', uso_atual: '', revisao_a_cada: '', ultima_revisao_uso: '', obs: '' }

export default function Maquinas() {
  const { gestor, perfil } = useAuth()
  const { fazendas } = useListas()
  const [maqs, setMaqs] = useState<Maquina[]>([])
  const [manuts, setManuts] = useState<Manut[]>([])
  const [abs, setAbs] = useState<Abast[]>([])
  const [combs, setCombs] = useState<Comb[]>([])
  const [form, setForm] = useState<typeof VAZIA | null>(null)
  const [lanc, setLanc] = useState<Record<string, string> | null>(null)
  const [cache, setCache] = useState<{ doCache: boolean; em?: string }>({ doCache: false })
  const [erro, setErro] = useState(''), [ok, setOk] = useState('')

  const carregar = useCallback(() => {
    lerComCache('v_maquinas', () => q<Maquina[]>(supabase.from('v_maquinas').select('*').eq('arquivado', false).order('nome')), [] as Maquina[]).then(r => { setMaqs(r.dados); setCache(r) })
    lerComCache('manutencoes', () => q<Manut[]>(supabase.from('manutencoes').select('*').order('data', { ascending: false }).limit(200)), [] as Manut[]).then(r => setManuts(r.dados))
    lerComCache('abastecimentos', () => q<Abast[]>(supabase.from('insumo_movimentos').select('id, data, quantidade, uso_maquina, maquina_id, responsavel_texto, insumos(nome, unidade)').not('maquina_id', 'is', null).order('data', { ascending: false }).limit(200)), [] as Abast[]).then(r => setAbs(r.dados))
    lerComCache('combustiveis', () => q<Comb[]>(supabase.from('v_insumos').select('id, nome, unidade, saldo').eq('categoria', 'Combustível')), [] as Comb[]).then(r => setCombs(r.dados))
  }, [])
  useEffect(carregar, [carregar])

  const n = (v: string) => (v.trim() ? Number(v.replace(/\./g, '').replace(',', '.')) : null)
  async function salvarMaquina(e: React.FormEvent) {
    e.preventDefault(); if (!form) return
    if (!fazendas[0]) return setErro('Cadastre a fazenda primeiro.')
    const { error } = await supabase.from('maquinas').insert({ ...form, fazenda_id: fazendas[0].id, ano: n(form.ano), uso_atual: n(form.uso_atual) ?? 0,
      revisao_a_cada: n(form.revisao_a_cada), ultima_revisao_uso: n(form.ultima_revisao_uso), patrimonio: form.patrimonio || null, marca: form.marca || null,
      modelo: form.modelo || null, placa_serie: form.placa_serie || null, localizacao: form.localizacao || null, obs: form.obs || null })
    if (error) return setErro(erroAmigavel(error) + ' (Cadastrar máquina precisa de internet.)')
    setForm(null); setOk('Máquina cadastrada.'); carregar()
  }
  async function lancar(e: React.FormEvent) {
    e.preventDefault(); if (!lanc) return; setErro('')
    const m = maqs.find(x => x.id === lanc.maquina_id); if (!m) return setErro('Escolha a máquina.')
    const uso = n(lanc.uso)
    if (uso != null && uso < m.uso_atual && !confirm(`O ${m.unidade_uso === 'h' ? 'horímetro' : 'km'} informado (${uso}) é menor que o último registrado (${m.uso_atual}). Confirma?`)) return
    let enviado: boolean
    if (lanc.tipo === 'Abastecimento') {
      const c = combs.find(x => x.id === lanc.insumo_id); if (!c) return setErro('Escolha o combustível.')
      const litros = n(lanc.quantidade); if (!litros || litros <= 0) return setErro('Informe os litros.')
      enviado = await enfileirar({ tipo: 'insert', tabela: 'insumo_movimentos', dados: { id: novoId(), insumo_id: c.id, data: lanc.data, tipo: 'Saída', quantidade: litros,
        maquina_id: m.id, uso_maquina: uso, destino: `Abastecimento ${m.nome}`, responsavel_texto: lanc.responsavel || perfil?.nome || null, obs: lanc.obs || null, lancado_em: new Date().toISOString() } },
        `Abastecimento ${m.nome}: ${litros} ${c.unidade} de ${c.nome}`)
    } else {
      if (!lanc.descricao.trim()) return setErro('Descreva o serviço feito.')
      enviado = await enfileirar({ tipo: 'insert', tabela: 'manutencoes', dados: { id: novoId(), maquina_id: m.id, data: lanc.data, tipo: lanc.tipo, descricao: lanc.descricao,
        uso, custo: n(lanc.custo), prestador: lanc.prestador || null, pecas: lanc.pecas || null, obs: lanc.obs || null, lancado_em: new Date().toISOString() } },
        `${lanc.tipo} ${m.nome}: ${lanc.descricao}`)
    }
    setLanc(null); setOk(enviado ? 'Lançado.' : 'Guardado no aparelho; será enviado quando houver internet.'); carregar()
  }
  const abrir = (tipo: string, maquina_id = '') => setLanc({ tipo, maquina_id, data: hojeISO(), uso: '', insumo_id: combs[0]?.id || '', quantidade: '', responsavel: '', descricao: '', custo: '', prestador: '', pecas: '', obs: '' })
  const setL = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => lanc && setLanc({ ...lanc, [k]: e.target.value })
  const setF = (k: keyof typeof VAZIA) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => form && setForm({ ...form, [k]: e.target.value })
  const nomeMaq = (id: string | null) => maqs.find(m => m.id === id)?.nome || '—'
  const vencidas = maqs.filter(m => m.situacao_revisao === 'Vencida').length

  return (
    <>
      <div className="titulo-acoes">
        <h1>Máquinas, manutenção e diesel</h1>
        <div>
          <button className="sec" onClick={() => abrir('Abastecimento')}>⛽ Abastecimento</button>
          <button className="sec" onClick={() => abrir('Corretiva')}>🔧 Manutenção</button>
          {gestor && <button onClick={() => setForm({ ...VAZIA })}>+ Máquina</button>}
        </div>
      </div>
      <AvisoCache {...cache} />
      {erro && <p className="erro">{erro}</p>}{ok && <p className="ok">{ok}</p>}
      <div className="indicadores">
        <div className="ind"><b>{maqs.length}</b><span>máquinas e veículos</span></div>
        <div className={'ind' + (vencidas ? ' alerta' : '')}><b>{vencidas}</b><span>revisões vencidas</span><small>{maqs.filter(m => m.situacao_revisao === 'Próxima').length} próximas</small></div>
        {combs.map(c => <div key={c.id} className="ind"><b>{num(c.saldo, 0)}</b><span>{c.unidade} de {c.nome} em estoque</span></div>)}
      </div>
      {!combs.length && <p className="aviso">Para lançar abastecimentos, cadastre o combustível em <b>Estoque → + Produto</b> (ex.: “Diesel S10”, unidade L, categoria Combustível) e faça a contagem inicial do tanque.</p>}

      {form && <form className="cartao formulario" onSubmit={salvarMaquina}>
        <h2>Nova máquina / veículo</h2>
        <div className="grade">
          <label>Nome *<input required placeholder="ex.: Trator MF 4292" value={form.nome} onChange={setF('nome')} /></label>
          <label>Tipo<select value={form.tipo} onChange={setF('tipo')}>{['Trator', 'Caminhonete', 'Caminhão', 'Moto', 'Implemento', 'Equipamento', 'Outro'].map(t => <option key={t}>{t}</option>)}</select></label>
          <label>Nº patrimônio<input value={form.patrimonio} onChange={setF('patrimonio')} /></label>
          <label>Marca<input value={form.marca} onChange={setF('marca')} /></label>
          <label>Modelo<input value={form.modelo} onChange={setF('modelo')} /></label>
          <label>Ano<input inputMode="numeric" value={form.ano} onChange={setF('ano')} /></label>
          <label>Placa / série<input value={form.placa_serie} onChange={setF('placa_serie')} /></label>
          <label>Onde fica<input value={form.localizacao} onChange={setF('localizacao')} /></label>
          <label>Estado<select value={form.estado} onChange={setF('estado')}>{['Bom', 'Regular', 'Ruim', 'Parado'].map(t => <option key={t}>{t}</option>)}</select></label>
          <label>Controle por<select value={form.unidade_uso} onChange={setF('unidade_uso')}><option value="h">Horímetro (h)</option><option value="km">Quilometragem (km)</option></select></label>
          <label>{form.unidade_uso === 'h' ? 'Horímetro atual' : 'Km atual'}<input inputMode="decimal" value={form.uso_atual} onChange={setF('uso_atual')} /></label>
          <label>Revisão a cada ({form.unidade_uso})<input inputMode="decimal" placeholder="ex.: 250" value={form.revisao_a_cada} onChange={setF('revisao_a_cada')} /></label>
          <label>Última revisão em ({form.unidade_uso})<input inputMode="decimal" value={form.ultima_revisao_uso} onChange={setF('ultima_revisao_uso')} /></label>
        </div>
        <div className="acoes"><button type="button" className="sec" onClick={() => setForm(null)}>Cancelar</button><button>Salvar</button></div>
      </form>}

      {lanc && <form className="cartao formulario" onSubmit={lancar}>
        <h2>{lanc.tipo === 'Abastecimento' ? 'Abastecimento' : 'Manutenção'}</h2>
        <div className="grade">
          <label>Máquina *<select required value={lanc.maquina_id} onChange={setL('maquina_id')}><option value="">Escolha…</option>{maqs.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}</select></label>
          {lanc.tipo !== 'Abastecimento' && <label>Tipo<select value={lanc.tipo} onChange={setL('tipo')}>{['Corretiva', 'Preventiva', 'Revisão'].map(t => <option key={t}>{t}</option>)}</select></label>}
          <label>Data<input type="date" required max={hojeISO()} value={lanc.data} onChange={setL('data')} /></label>
          <label>Horímetro / km<input inputMode="decimal" value={lanc.uso} onChange={setL('uso')} /></label>
          {lanc.tipo === 'Abastecimento' ? <>
            <label>Combustível<select value={lanc.insumo_id} onChange={setL('insumo_id')}>{combs.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
            <label>Litros *<input required inputMode="decimal" value={lanc.quantidade} onChange={setL('quantidade')} /></label>
            <label>Quem abasteceu<input value={lanc.responsavel} onChange={setL('responsavel')} /></label>
          </> : <>
            <label>O que foi feito *<input required value={lanc.descricao} onChange={setL('descricao')} /></label>
            <label>Peças<input value={lanc.pecas} onChange={setL('pecas')} /></label>
            <label>Oficina / prestador<input value={lanc.prestador} onChange={setL('prestador')} /></label>
            {gestor && <label>Custo (R$)<input inputMode="decimal" value={lanc.custo} onChange={setL('custo')} /></label>}
          </>}
          <label>Observação<input value={lanc.obs} onChange={setL('obs')} /></label>
        </div>
        <div className="acoes"><button type="button" className="sec" onClick={() => setLanc(null)}>Cancelar</button><button>Lançar</button></div>
      </form>}

      <div className="tarefas">{maqs.map(m => (
        <div key={m.id} className={`tarefa ${m.situacao_revisao === 'Vencida' ? 'atrasada p-alta' : m.situacao_revisao === 'Próxima' ? 'p-media' : 'p-baixa'}`}>
          <div className="t-topo"><b>{m.nome}</b><span className="etiqueta">{m.tipo}</span></div>
          <small>{[m.marca, m.modelo, m.ano, m.placa_serie, m.patrimonio && `patr. ${m.patrimonio}`, m.localizacao].filter(Boolean).join(' · ')}</small>
          <p>{m.unidade_uso === 'h' ? 'Horímetro' : 'Km'}: <b>{num(m.uso_atual, 0)}</b>{m.proxima_revisao != null && <> · próxima revisão em <b>{num(m.proxima_revisao, 0)}</b> ({m.situacao_revisao})</>} · {m.estado}</p>
          <div className="t-acoes"><button className="sec mini" onClick={() => abrir('Abastecimento', m.id)}>⛽ Abastecer</button><button className="sec mini" onClick={() => abrir('Corretiva', m.id)}>🔧 Manutenção</button></div>
        </div>))}</div>
      {!maqs.length && <p className="vazio">Nenhuma máquina cadastrada ainda.</p>}

      <div className="duas">
        <section className="cartao"><h2>Últimas manutenções</h2>
          {manuts.length ? <table><tbody>{manuts.slice(0, 30).map(x => <tr key={x.id}><td>{dataBR(x.data)}</td><td>{nomeMaq(x.maquina_id)}</td><td>{x.tipo}: {x.descricao}</td><td className="num">{gestor ? reais(x.custo) : ''}</td></tr>)}</tbody></table> : <p className="vazio">Nenhuma.</p>}
        </section>
        <section className="cartao"><h2>Últimos abastecimentos</h2>
          {abs.length ? <table><tbody>{abs.slice(0, 30).map(x => <tr key={x.id}><td>{dataBR(x.data)}</td><td>{nomeMaq(x.maquina_id)}</td><td className="num">{num(x.quantidade, 0)} {x.insumos?.unidade}</td><td className="num">{x.uso_maquina ?? '—'}</td><td><small>{x.responsavel_texto}</small></td></tr>)}</tbody></table> : <p className="vazio">Nenhum.</p>}
        </section>
      </div>
    </>
  )
}
