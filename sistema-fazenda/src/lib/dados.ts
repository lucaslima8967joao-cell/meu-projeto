import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { lerComCache, q } from './offline'
import { ordemNatural } from './formato'
import type { Fazenda, Lote, Pasto, Perfil } from './tipos'

/** Carrega listas usadas em vários formulários (fazendas, pastos, lotes, pessoas). */
export function useListas() {
  const [fazendas, setF] = useState<Fazenda[]>([])
  const [pastos, setP] = useState<Pasto[]>([])
  const [lotes, setL] = useState<Lote[]>([])
  const [pessoas, setPe] = useState<Perfil[]>([])
  const [n, setN] = useState(0)
  useEffect(() => {
    const ler = <T,>(chave: string, consulta: PromiseLike<{ data: unknown; error: unknown }>, set: (v: T[]) => void) =>
      lerComCache<T[]>(chave, () => q<T[]>(consulta), []).then(r => set(r.dados), () => set([]))
    ler<Fazenda>('fazendas', supabase.from('fazendas').select('*').eq('arquivado', false).order('nome'), setF)
    ler<Pasto>('pastos', supabase.from('pastos').select('*').eq('arquivado', false).order('codigo'), (l: Pasto[]) => setP([...l].sort((a, b) => ordemNatural(a.codigo, b.codigo))))
    ler<Lote>('lotes', supabase.from('lotes').select('*').eq('arquivado', false).order('nome'), setL)
    ler<Perfil>('pessoas', supabase.from('perfis').select('id, nome, email, papel, ativo').eq('ativo', true).order('nome'), setPe)
  }, [n])
  return { fazendas, pastos, lotes, pessoas, recarregar: () => setN(x => x + 1) }
}

/** O Supabase devolve no máximo 1000 linhas por vez: busca em páginas até trazer tudo. */
export async function buscarTodos<T>(montar: (de: number, ate: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const tam = 1000, saida: T[] = []
  for (let de = 0; ; de += tam) {
    const { data, error } = await montar(de, de + tam - 1)
    if (error) throw error
    const pag = (data as T[]) || []
    saida.push(...pag)
    if (pag.length < tam) return saida
  }
}
