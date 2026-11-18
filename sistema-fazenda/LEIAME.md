# Sistema de Gestão da Fazenda — Etapa 1 (MVP)

Aplicativo web em português que funciona no celular, tablet e computador.
Todos os usuários veem os **mesmos dados**, sincronizados numa base na nuvem (Supabase).

## O que já funciona
| Módulo | Recursos |
|---|---|
| **Login e usuários** | Conta individual por pessoa · perfis Administrador, Gerente e Operador · nova conta fica bloqueada até o admin liberar · recuperação de senha |
| **Animais** | Cadastro com controle, chip, brinco, nome, sexo, raça, nascimento, categoria, lote, pasto, pai · busca por controle/chip/brinco/nome · filtros por sexo, categoria, raça, lote, pasto, situação e idade · **impede chip/controle/brinco duplicado** · exportação para Excel (CSV) · arquivar (nunca apaga) |
| **Pesagens** | Histórico por animal · ganho médio diário · alerta de peso muito diferente do anterior |
| **Nascimentos** | Busca da mãe pelo número · cria o bezerro automaticamente (aceita bezerro **sem número**, identificado pela mãe) · peso ao nascer · lista de crias na ficha da vaca |
| **Pastos e lotes** | Fazendas, pastos (nº novo e antigo, área, lotação chuva/seca, situação, solo) · lotes · mover animal ou **lote inteiro** de pasto com histórico · ocupação atual de cada pasto |
| **Tarefas** | Hoje, atrasadas, próximas, semana, por colaborador e concluídas · prioridade, horário, pasto, responsável, equipe, materiais · iniciar/concluir com observação |
| **Painel** | Animais ativos, nascimentos (30 dias), tarefas do dia e atrasadas, rebanho por categoria, pesagens recentes |
| **Segurança** | Regras de acesso no próprio banco · registro de **quem alterou o quê e quando** (tabela `auditoria`) |

## Instalação (uma vez só, ~20 minutos)

### 1. Criar o banco de dados (Supabase, gratuito)
1. Acesse **supabase.com** → *Start your project* → entre com a conta Google ou GitHub.
2. *New project*: nome `fazenda`, escolha uma **senha forte do banco** (guarde num lugar seguro), região **South America (São Paulo)**.
3. No menu da esquerda: **SQL Editor** → *New query* → cole TODO o conteúdo do arquivo `supabase/migrations/001_mvp.sql` → **Run**. Deve aparecer *Success*.
4. **Authentication → Sign In / Providers → Email**: deixe ativado. (Opcional: desligar *Confirm email* para não exigir confirmação por e-mail.)
5. **Project Settings → API**: copie a **Project URL** e a chave **anon / publishable**.
   ⚠️ Nunca use nem compartilhe a chave **service_role / secret**.

### 2. Publicar o aplicativo (Vercel, gratuito)
1. Acesse **vercel.com** → entre com o GitHub → *Add New → Project* → escolha o repositório `meu-projeto`.
2. **Root Directory**: `sistema-fazenda`. Framework: *Vite*.
3. Em **Environment Variables** adicione:
   - `VITE_SUPABASE_URL` = a Project URL
   - `VITE_SUPABASE_ANON_KEY` = a chave anon
4. **Deploy**. Você recebe um endereço tipo `https://fazenda-xxxx.vercel.app`.
5. No Supabase, em **Authentication → URL Configuration**, coloque esse endereço em *Site URL* (para o link de recuperação de senha funcionar).

### 3. Primeiro acesso
1. Abra o endereço, clique em **Criar conta**. **A primeira conta criada vira Administrador automaticamente** — por isso, crie a sua (ou a do patrão) primeiro.
2. Cadastre a fazenda e os pastos em **Pastos e lotes**.

## Como acessar
- **Computador**: abra o endereço no Chrome, Edge ou Firefox. No Windows 7 use o Chrome 109 (último disponível para ele) ou Firefox ESR.
- **Celular**: abra o endereço no Chrome (Android) ou Safari (iPhone) → menu → **Adicionar à tela inicial**. Ele vira um ícone como um app.

## Criar usuários
1. A pessoa abre o endereço e clica em **Criar conta**.
2. O administrador entra em **Usuários**, escolhe o perfil e clica em **Liberar acesso**.
3. Para tirar o acesso: **Bloquear** (o histórico do que a pessoa fez continua guardado).

| Perfil | Pode |
|---|---|
| Administrador | Tudo, inclusive usuários |
| Gerente | Cadastrar/editar animais, pastos, lotes e tarefas |
| Operador | Consultar; registrar pesagens, nascimentos e movimentações; atualizar as próprias tarefas |

## Backup e restauração
- **Automático**: o Supabase guarda backups diários (no plano gratuito, dos últimos dias; no pago, mais tempo e restauração pontual).
- **Manual (recomendado 1x por semana)**: em **Animais → Exportar Excel (CSV)** você baixa a lista completa.
- **Backup completo do banco**: Supabase → **Database → Backups**, ou pelo *Table Editor* → cada tabela → *Export to CSV*.
- **Restaurar**: Supabase → Database → Backups → *Restore*. Para importar CSV: Table Editor → tabela → *Insert → Import data from CSV*.

## Para quem for mexer no código
```bash
cd sistema-fazenda
cp .env.example .env     # preencha URL e chave anon
npm install
npm run dev              # abre em http://localhost:5173
npm run build            # gera a versão final em dist/
```
Estrutura: `supabase/migrations/` (banco e regras de acesso) · `src/pages/` (telas) · `src/lib/` (conexão, formatos, tipos).

## Próximas etapas
2. Compras, vendas e trocas (com NF e valores) · mortes/descartes · reprodução · relatórios PDF/Excel · **importação das planilhas atuais**
3. Máquinas, manutenção e diesel
4. Estoque de insumos, serviços de pastagem e cantina
5. Colaboradores, documentos/anexos, fotos nas tarefas, cavalos
