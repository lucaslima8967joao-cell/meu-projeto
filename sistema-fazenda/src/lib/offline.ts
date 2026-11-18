/**
 * Funcionamento sem internet.
 *  - Leituras: cada consulta é guardada no aparelho (IndexedDB). Sem sinal, usa a última cópia.
 *  - Lançamentos: vão para uma FILA no aparelho e são enviados quando a internet voltar.
 *    Cada lançamento tem um id gerado aqui; se o envio repetir, o banco reconhece e não duplica.
 */
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// ------------------------------------------------------------------ IndexedDB mínimo
const DB = 'gestao-fazenda', VERSAO = 1
function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, falha) => {
    const r = indexedDB.open(DB, VERSAO)
    r.onupgradeneeded = () => {
      r.result.createObjectStore('cache')
      r.result.createObjectStore('fila', { keyPath: 'id' })
    }
    r.onsuccess = () => ok(r.result)
    r.onerror = () => falha(r.error)
  })
}
async function tx<T>(loja: string, modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await abrir()
  return new Promise((ok, falha) => {
    const t = db.transaction(loja, modo), req = fn(t.objectStore(loja))
    t.oncomplete = () => ok(req.result)
    t.onerror = () => falha(t.error)
  })
}

export function novoId(): string {
  const c: Crypto = globalThis.crypto
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function ehErroDeRede(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const x = e as { message?: string; code?: string } | null
  return Boolean(x && !x.code && /fetch|network|Load failed|NetworkError|timed? ?out/i.test(x.message || ''))
}

// ------------------------------------------------------------------ Leituras com cópia local
interface Guardado<T> { dados: T; em: string }
export interface Leitura<T> { dados: T; doCache: boolean; em?: string }

/** Busca na internet e guarda a cópia; sem internet devolve a última cópia guardada. */
/** Desiste de esperar a internet depois de alguns segundos (sinal fraco no campo). */
export function comLimite<T>(p: Promise<T>, ms = 8000): Promise<T> {
  return new Promise((ok, falha) => {
    const t = setTimeout(() => falha(new Error('network timeout')), ms)
    p.then(v => { clearTimeout(t); ok(v) }, e => { clearTimeout(t); falha(e) })
  })
}

export async function lerComCache<T>(chave: string, buscar: () => Promise<T>, vazio: T): Promise<Leitura<T>> {
  try {
    // sem sinal: nem tenta a internet, vai direto para a cópia guardada
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('network offline')
    const dados = await comLimite(buscar())
    tx('cache', 'readwrite', s => s.put({ dados, em: new Date().toISOString() } as Guardado<T>, chave)).catch(() => {})
    return { dados, doCache: false }
  } catch (e) {
    const g = await tx<Guardado<T> | undefined>('cache', 'readonly', s => s.get(chave)).catch(() => undefined)
    if (g) return { dados: g.dados, doCache: true, em: g.em }
    if (ehErroDeRede(e)) return { dados: vazio, doCache: true }
    throw e
  }
}

/** Converte o retorno do Supabase em exceção (para usar dentro de lerComCache). */
export async function q<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p
  if (error) throw error
  return data as T
}

// ------------------------------------------------------------------ Fila de lançamentos
export type Operacao =
  | { tipo: 'insert'; tabela: string; dados: Record<string, unknown> }
  | { tipo: 'update'; tabela: string; alvo: string; dados: Record<string, unknown> }
  | { tipo: 'rpc'; funcao: string; args: Record<string, unknown> }

export interface ItemFila { id: string; op: Operacao; descricao: string; criado_em: string; erro?: string; animal_id?: string }

type Estado = { online: boolean; pendentes: ItemFila[]; enviando: boolean }
let estado: Estado = { online: typeof navigator === 'undefined' ? true : navigator.onLine, pendentes: [], enviando: false }
const ouvintes = new Set<(e: Estado) => void>()
const avisar = (mud: Partial<Estado>) => { estado = { ...estado, ...mud }; ouvintes.forEach(f => f(estado)) }

async function listarFila(): Promise<ItemFila[]> {
  const itens = await tx<ItemFila[]>('fila', 'readonly', s => s.getAll()).catch(() => [])
  return itens.sort((a, b) => a.criado_em.localeCompare(b.criado_em))
}
async function recarregarFila() { avisar({ pendentes: await listarFila() }) }

/** Coloca um lançamento na fila e tenta enviar na hora. Retorna true se já foi enviado. */
export async function enfileirar(op: Operacao, descricao: string, animal_id?: string): Promise<boolean> {
  const item: ItemFila = { id: novoId(), op, descricao, criado_em: new Date().toISOString(), animal_id }
  await tx('fila', 'readwrite', s => s.put(item))
  await recarregarFila()
  await sincronizar()
  return !estado.pendentes.some(p => p.id === item.id)
}

export async function descartar(id: string) {
  await tx('fila', 'readwrite', s => s.delete(id)); await recarregarFila()
}

async function executar(op: Operacao) {
  if (op.tipo === 'insert') return supabase.from(op.tabela).insert(op.dados)
  if (op.tipo === 'update') return supabase.from(op.tabela).update(op.dados).eq('id', op.alvo)
  return supabase.rpc(op.funcao, op.args)
}

let rodando: Promise<void> | null = null
/** Envia a fila, na ordem em que foi lançada. Para no primeiro erro de rede. */
export function sincronizar(): Promise<void> {
  if (rodando) return rodando
  rodando = (async () => {
    try {
      await Promise.resolve() // garante que a trava "rodando" já foi registrada antes de seguir
      if (!navigator.onLine) { avisar({ online: false }); return }
      avisar({ enviando: true, online: true })
      for (const item of await listarFila()) {
        const { error } = await executar(item.op) as { error: { message: string; code?: string } | null }
        const jaEnviado = error?.code === '23505' && /_pkey/.test(error.message)
        if (!error || jaEnviado) {
          await tx('fila', 'readwrite', s => s.delete(item.id))
        } else if (ehErroDeRede(error)) {
          avisar({ online: false }); break
        } else {
          await tx('fila', 'readwrite', s => s.put({ ...item, erro: error.message }))
        }
      }
    } finally {
      // sempre libera a trava, mesmo quando não havia internet
      rodando = null
      await recarregarFila(); avisar({ enviando: false })
    }
  })()
  return rodando
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { avisar({ online: true }); sincronizar() })
  window.addEventListener('offline', () => avisar({ online: false }))
  setInterval(() => { if (navigator.onLine && estado.pendentes.length) sincronizar() }, 30000)
  recarregarFila()
}

export function useSincronizacao() {
  const [e, setE] = useState(estado)
  useEffect(() => { ouvintes.add(setE); setE(estado); return () => { ouvintes.delete(setE) } }, [])
  return e
}
