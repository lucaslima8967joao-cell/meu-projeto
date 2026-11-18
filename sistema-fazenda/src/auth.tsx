import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import type { Perfil } from './lib/tipos'

interface Ctx { recuperando: boolean; fimRecuperacao: () => void; sessao: Session | null; perfil: Perfil | null; carregando: boolean; gestor: boolean; admin: boolean; recarregar: () => void }
const AuthCtx = createContext<Ctx>({ recuperando: false, fimRecuperacao: () => {}, sessao: null, perfil: null, carregando: true, gestor: false, admin: false, recarregar: () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [n, setN] = useState(0)
  const [recuperando, setRec] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session))
    const { data } = supabase.auth.onAuthStateChange((e, s) => { setSessao(s); if (e === 'PASSWORD_RECOVERY') setRec(true) })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!sessao) { setPerfil(null); setCarregando(false); return }
    setCarregando(true)
    supabase.from('perfis').select('*').eq('id', sessao.user.id).maybeSingle()
      .then(({ data }) => { setPerfil(data as Perfil | null); setCarregando(false) })
  }, [sessao, n])

  const ativo = Boolean(perfil?.ativo)
  return (
    <AuthCtx.Provider value={{
      recuperando, fimRecuperacao: () => setRec(false),
      sessao, perfil, carregando,
      gestor: ativo && (perfil?.papel === 'admin' || perfil?.papel === 'gerente'),
      admin: ativo && perfil?.papel === 'admin',
      recarregar: () => setN(x => x + 1),
    }}>{children}</AuthCtx.Provider>
  )
}
export const useAuth = () => useContext(AuthCtx)
