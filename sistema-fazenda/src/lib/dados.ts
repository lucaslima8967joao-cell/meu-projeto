import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Fazenda, Lote, Pasto, Perfil } from './tipos'

/** Carrega listas usadas em vários formulários (fazendas, pastos, lotes, pessoas). */
export function useListas() {
  const [fazendas, setF] = useState<Fazenda[]>([])
  const [pastos, setP] = useState<Pasto[]>([])
  const [lotes, setL] = useState<Lote[]>([])
  const [pessoas, setPe] = useState<Perfil[]>([])
  const [n, setN] = useState(0)
  useEffect(() => {
    supabase.from('fazendas').select('*').eq('arquivado', false).order('nome').then(r => setF((r.data as Fazenda[]) || []))
    supabase.from('pastos').select('*').eq('arquivado', false).order('codigo').then(r => setP((r.data as Pasto[]) || []))
    supabase.from('lotes').select('*').eq('arquivado', false).order('nome').then(r => setL((r.data as Lote[]) || []))
    supabase.from('perfis').select('*').eq('ativo', true).order('nome').then(r => setPe((r.data as Perfil[]) || []))
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
