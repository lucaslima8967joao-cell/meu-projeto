import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
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
import VendaNova from './pages/VendaNova'
import Busca from './pages/Busca'
import Sistema from './pages/Sistema'
import Cantina from './pages/Cantina'
import Pendencias, { StatusSincronizacao } from './pages/Pendencias'
import Rebanho from './pages/Rebanho'
import Servicos from './pages/Servicos'
import Estoque from './pages/Estoque'
import Maquinas from './pages/Maquinas'
import Colaboradores from './pages/Colaboradores'

export default function App() {
  const { sessao, perfil, carregando, admin, gestor, cantina, recuperando } = useAuth()
  const loc = useLocation()
  const ehIatf = loc.pathname === '/tarefas' && loc.search.includes('categoria=IATF')

  if (!configurado) return (
    <div className="centro"><div className="cartao">
      <h1>Sistema ainda não configurado</h1>
      <p>Falta ligar o aplicativo ao banco de dados. Siga o passo a passo do arquivo <b>LEIAME.md</b>.</p>
    </div></div>
  )
  if (!sessao) return <Login />
  if (recuperando) return <NovaSenha />
  if (carregando) return <div className="centro">Entrando…</div>
  if (!perfil?.ativo) return (
    <div className="centro"><div className="cartao">
      <h1>Aguardando liberação</h1>
      <p>Sua conta (<b>{sessao.user.email}</b>) foi criada. O administrador precisa liberar o seu acesso.</p>
      <button className="sec" onClick={() => supabase.auth.signOut()}>Sair</button>
    </div></div>
  )

  if (cantina) return (
    <div className="app">
      <header className="topo">
        <span className="marca">🛒 Cantina</span>
        <span className="quem">{perfil.nome || perfil.email}</span>
        <button className="sec mini imprimir" title="Imprimir ou salvar em PDF" onClick={() => window.print()}>🖨️ PDF</button>
        <button className="sec mini" onClick={() => supabase.auth.signOut()}>Sair</button>
      </header>
      <StatusSincronizacao />
      <main className="conteudo">
        <Routes>
          <Route path="/pendencias" element={<Pendencias />} />
          <Route path="*" element={<Cantina />} />
        </Routes>
      </main>
    </div>
  )

  return (
    <div className="app">
      <header className="topo">
        <span className="marca">🐂 Gestão da Fazenda</span>
        <Link to="/busca" className="lupa" title="Buscar">🔍</Link>
        <button className="sec mini imprimir" title="Imprimir ou salvar esta tela em PDF" onClick={() => window.print()}>🖨️ PDF</button>
        <span className="quem">{perfil.nome || perfil.email} · {perfil.papel}</span>
        <button className="sec mini" onClick={() => supabase.auth.signOut()}>Sair</button>
      </header>
      <StatusSincronizacao />
      <nav className="menu">
        <NavLink to="/" end>Painel</NavLink>
        <NavLink to="/animais">Animais</NavLink>
        <NavLink to="/nascimento">Nascimento</NavLink>
        <NavLink to="/rebanho">Rebanho</NavLink>
        <NavLink to="/tarefas?categoria=IATF" className={() => (ehIatf ? 'active' : '')}>IATF</NavLink>
        <NavLink to="/pastos">Áreas e lotes</NavLink>
        {gestor && <NavLink to="/vendas">Vendas</NavLink>}
        <NavLink to="/tarefas" className={({ isActive }) => (isActive && !ehIatf ? 'active' : '')}>Tarefas</NavLink>
        <NavLink to="/servicos">Serviços</NavLink>
        <NavLink to="/estoque">Estoque</NavLink>
        <NavLink to="/maquinas">Máquinas</NavLink>
        <NavLink to="/cantina">Cantina</NavLink>
        {gestor && <NavLink to="/colaboradores">Colaboradores</NavLink>}
        {admin && <NavLink to="/usuarios">Usuários</NavLink>}
        {admin && <NavLink to="/sistema">Cópia e histórico</NavLink>}
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
          <Route path="/vendas/nova" element={gestor ? <VendaNova /> : <Navigate to="/" />} />
          <Route path="/vendas/:id" element={gestor ? <VendaDetalhe /> : <Navigate to="/" />} />
          <Route path="/tarefas" element={<Tarefas />} />
          <Route path="/usuarios" element={admin ? <Usuarios /> : <Navigate to="/" />} />
          <Route path="/rebanho" element={<Rebanho />} />
          <Route path="/servicos" element={<Servicos />} />
          <Route path="/estoque" element={<Estoque />} />
          <Route path="/maquinas" element={<Maquinas />} />
          <Route path="/colaboradores" element={gestor ? <Colaboradores /> : <Navigate to="/" />} />
          <Route path="/cantina" element={<Cantina />} />
          <Route path="/busca" element={<Busca />} />
          <Route path="/sistema" element={admin ? <Sistema /> : <Navigate to="/" />} />
          <Route path="/pendencias" element={<Pendencias />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  )
}
