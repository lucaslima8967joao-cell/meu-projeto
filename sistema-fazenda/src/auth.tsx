import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { comLimite } from './lib/offline'
import type { Perfil } from './lib/tipos'

interface Ctx { cantina: boolean; recuperando: boolean; fimRecuperacao: () => void; sessao: Session | null; perfil: Perfil | null; carregando: boolean; gestor: boolean; admin: boolean; recarregar: () => void }
const AuthCtx = createContext<Ctx>({ cantina: false, recuperando: false, fimRecuperacao: () => {}, sessao: null, perfil: null, carregando: true, gestor: false, admin: false, recarregar: () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [n, setN] = useState(0)
  const [recuperando, setRec] = useState(false)
  const usuarioId = sessao?.user.id
  const perfilCarregado = useRef(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session))
    const { data } = supabase.auth.onAuthStateChange((e, s) => { setSessao(s); if (e === 'PASSWORD_RECOVERY') setRec(true) })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!sessao) { perfilCarregado.current = false; setPerfil(null); setCarregando(false); return }
    // Só mostra "Entrando…" na primeira carga; renovação do login (a cada ~1h) ou troca
    // de senha atualizam o perfil em segundo plano, sem desmontar a tela aberta.
    if (!perfilCarregado.current) setCarregando(true)
    const chave = 'perfil:' + sessao.user.id
    const guardado = () => { try { return JSON.parse(localStorage.getItem(chave) || 'null') } catch { return null } }
    if (!navigator.onLine && guardado()) { perfilCarregado.current = true; setPerfil(guardado()); setCarregando(false); return }
    comLimite(Promise.resolve(supabase.from('perfis').select('*').eq('id', sessao.user.id).maybeSingle()), 8000)
      .catch(error => ({ data: null, error }))
      .then(({ data, error }) => {
        if (error) {
          // sem internet: usa o último perfil guardado neste aparelho
          setPerfil(guardado())
        } else {
          setPerfil(data as Perfil | null)
          try { localStorage.setItem(chave, JSON.stringify(data)) } catch { /* armazenamento indisponível */ }
        }
        perfilCarregado.current = true
        setCarregando(false)
      })
  }, [usuarioId, n]) // eslint-disable-line react-hooks/exhaustive-deps

  const ativo = Boolean(perfil?.ativo)
  return (
    <AuthCtx.Provider value={{
      recuperando, fimRecuperacao: () => setRec(false),
      sessao, perfil, carregando,
      gestor: ativo && (perfil?.papel === 'admin' || perfil?.papel === 'gerente'),
      admin: ativo && perfil?.papel === 'admin',
      cantina: ativo && perfil?.papel === 'cantina',
      recarregar: () => setN(x => x + 1),
    }}>{children}</AuthCtx.Provider>
  )
}
export const useAuth = () => useContext(AuthCtx)
