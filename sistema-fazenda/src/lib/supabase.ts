import { createClient } from '@supabase/supabase-js'

// Aceita tanto as variáveis colocadas à mão (VITE_*) quanto as criadas
// automaticamente pela integração Supabase do Vercel (NEXT_PUBLIC_*).
const env = import.meta.env as Record<string, string | undefined>
const url = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

export const configurado = Boolean(url && key)
export const supabase = createClient(url || 'http://localhost', key || 'nao-configurado')
