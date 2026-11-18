import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { CATEGORIAS, SEXO, SITUACAO, dataBR, idade, kg } from '../lib/formato'
import { buscarTodos, useListas } from '../lib/dados'
import { useAuth } from '../auth'
import type { Animal } from '../lib/tipos'

function csv(linhas: Animal[]) {
  const cab = ['Controle', 'Chip', 'Brinco', 'Nome', 'Sexo', 'Raça', 'Nascimento', 'Idade (meses)', 'Categoria', 'Lote', 'Pasto', 'Mãe', 'Último peso (kg)', 'Data último peso', 'Situação']
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const corpo = linhas.map(a => [a.controle, a.chip, a.brinco, a.nome, SEXO[a.sexo], a.raca, dataBR(a.nascimento), a.idade_meses, a.categoria,
    a.lote_nome, a.pasto_codigo, a.mae_controle, a.ultimo_peso_kg?.toString().replace('.', ','), dataBR(a.ultima_pesagem), SITUACAO[a.situacao]].map(esc).join(';'))
  const blob = new Blob(['﻿' + [cab.join(';'), ...corpo].join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'animais.csv'; a.click()
}

export default function Animais() {
  const { gestor } = useAuth()
  const { pastos, lotes } = useListas()
  const [todos, setTodos] = useState<Animal[] | null>(null)
  const [busca, setBusca] = useState('')
  const [f, setF] = useState({ sexo: '', categoria: '', raca: '', lote: '', pasto: '', situacao: 'ativo', idadeMin: '', idadeMax: '' })

  useEffect(() => {
    buscarTodos<Animal>((de, ate) => supabase.from('v_animais').select('*').eq('arquivado', false).order('controle').order('id').range(de, ate))
      .then(setTodos, () => setTodos([]))
  }, [])

  const racas = useMemo(() => [...new Set((todos || []).map(a => a.raca).filter(Boolean))] as string[], [todos])
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return (todos || []).filter(a =>
      (!q || [a.controle, a.chip, a.brinco, a.nome].some(v => v?.toLowerCase().includes(q))) &&
      (!f.sexo || a.sexo === f.sexo) && (!f.categoria || a.categoria === f.categoria) &&
      (!f.raca || a.raca === f.raca) && (!f.lote || a.lote_id === f.lote) && (!f.pasto || a.pasto_id === f.pasto) &&
      (!f.situacao || a.situacao === f.situacao) &&
      (!f.idadeMin || (a.idade_meses ?? -1) >= Number(f.idadeMin)) &&
      (!f.idadeMax || (a.idade_meses ?? 1e9) <= Number(f.idadeMax)))
  }, [todos, busca, f])

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => setF({ ...f, [k]: e.target.value })

  return (
    <>
      <div className="titulo-acoes">
        <h1>Animais</h1>
        <div>
          <button className="sec" onClick={() => csv(lista)} disabled={!lista.length}>Exportar Excel (CSV)</button>
          {gestor && <Link className="botao" to="/animais/novo">+ Novo animal</Link>}
        </div>
      </div>
      <input className="busca" placeholder="Buscar por controle, chip, brinco ou nome…" value={busca} onChange={e => setBusca(e.target.value)} autoFocus />
      <div className="filtros">
        <select value={f.situacao} onChange={set('situacao')}><option value="">Todas situações</option>{Object.entries(SITUACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={f.sexo} onChange={set('sexo')}><option value="">Sexo</option><option value="M">Macho</option><option value="F">Fêmea</option></select>
        <select value={f.categoria} onChange={set('categoria')}><option value="">Categoria</option>{CATEGORIAS.map(c => <option key={c}>{c}</option>)}</select>
        <select value={f.raca} onChange={set('raca')}><option value="">Raça</option>{racas.map(c => <option key={c}>{c}</option>)}</select>
        <select value={f.lote} onChange={set('lote')}><option value="">Lote</option>{lotes.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}</select>
        <select value={f.pasto} onChange={set('pasto')}><option value="">Pasto</option>{pastos.map(p => <option key={p.id} value={p.id}>{p.codigo}</option>)}</select>
        <input type="number" min="0" placeholder="Idade mín. (meses)" value={f.idadeMin} onChange={set('idadeMin')} />
        <input type="number" min="0" placeholder="Idade máx. (meses)" value={f.idadeMax} onChange={set('idadeMax')} />
      </div>
      {todos === null ? <p>Carregando…</p> : (
        <>
          <p className="contagem">{lista.length} de {todos.length} animais</p>
          <div className="tabela-rolagem">
            <table className="lista">
              <thead><tr><th>Controle</th><th>Chip</th><th>Sexo</th><th>Raça</th><th>Categoria</th><th>Idade</th><th>Lote</th><th>Pasto</th><th>Último peso</th></tr></thead>
              <tbody>{lista.map(a => (
                <tr key={a.id} onClick={() => (location.hash = `#/animais/${a.id}`)}>
                  <td><Link to={`/animais/${a.id}`}>{a.controle || a.brinco || '—'}</Link>{a.nome && <small> {a.nome}</small>}</td>
                  <td>{a.chip || '—'}</td><td>{SEXO[a.sexo]}</td><td>{a.raca || '—'}</td><td>{a.categoria || '—'}</td>
                  <td>{idade(a.idade_meses)}</td><td>{a.lote_nome || '—'}</td><td>{a.pasto_codigo || '—'}</td>
                  <td className="num">{kg(a.ultimo_peso_kg)}<small> {dataBR(a.ultima_pesagem)}</small></td>
                </tr>))}</tbody>
            </table>
          </div>
          {!lista.length && <p className="vazio">Nenhum animal encontrado.</p>}
        </>
      )}
    </>
  )
}
