import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import { configurado, supabase } from './lib/supabase'
import Login from './pages/Login'
import Painel from './pages/Painel'
import Animais from './pages/Animais'
import AnimalDetalhe from './pages/AnimalDetalhe'
import AnimalForm from './pages/AnimalForm'
import Nascimento from './pages/Nascimento'
import Pastos from './pages/Pastos'
import Tarefas from './pages/Tarefas'
import Usuarios from './pages/Usuarios'
import NovaSenha from './pages/NovaSenha'
import { Vendas, VendaDetalhe } from './pages/Vendas'

export default function App() {
  const { sessao, perfil, carregando, admin, gestor, recuperando } = useAuth()

  if (!configurado) return (
    <div className="centro"><div className="cartao">
      <h1>Sistema ainda não configurado</h1>
      <p>Falta ligar o aplicativo ao banco de dados. Siga o passo a passo do arquivo <b>LEIAME.md</b>.</p>
    </div></div>
  )
  if (!sessao) return <Login />
  if (recuperando) return <NovaSenha />
  if (carregando) return <div className="centro">Carregando…</div>
  if (!perfil?.ativo) return (
    <div className="centro"><div className="cartao">
      <h1>Aguardando liberação</h1>
      <p>Sua conta (<b>{sessao.user.email}</b>) foi criada. O administrador precisa liberar o seu acesso.</p>
      <button className="sec" onClick={() => supabase.auth.signOut()}>Sair</button>
    </div></div>
  )

  return (
    <div className="app">
      <header className="topo">
        <span className="marca">🐂 Gestão da Fazenda</span>
        <span className="quem">{perfil.nome || perfil.email} · {perfil.papel}</span>
        <button className="sec mini" onClick={() => supabase.auth.signOut()}>Sair</button>
      </header>
      <nav className="menu">
        <NavLink to="/" end>Painel</NavLink>
        <NavLink to="/animais">Animais</NavLink>
        <NavLink to="/nascimento">Nascimento</NavLink>
        <NavLink to="/pastos">Áreas e lotes</NavLink>
        {gestor && <NavLink to="/vendas">Vendas</NavLink>}
        <NavLink to="/tarefas">Tarefas</NavLink>
        {admin && <NavLink to="/usuarios">Usuários</NavLink>}
      </nav>
      <main className="conteudo">
        <Routes>
          <Route path="/" element={<Painel />} />
          <Route path="/animais" element={<Animais />} />
          <Route path="/animais/novo" element={<AnimalForm />} />
          <Route path="/animais/:id" element={<AnimalDetalhe />} />
          <Route path="/animais/:id/editar" element={<AnimalForm />} />
          <Route path="/nascimento" element={<Nascimento />} />
          <Route path="/pastos" element={<Pastos />} />
          <Route path="/vendas" element={gestor ? <Vendas /> : <Navigate to="/" />} />
          <Route path="/vendas/:id" element={gestor ? <VendaDetalhe /> : <Navigate to="/" />} />
          <Route path="/tarefas" element={<Tarefas />} />
          <Route path="/usuarios" element={admin ? <Usuarios /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  )
}
