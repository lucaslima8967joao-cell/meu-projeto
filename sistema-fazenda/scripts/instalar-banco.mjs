// Instala o banco automaticamente durante a publicação no Vercel.
// Usa a conexão que a integração Supabase do Vercel cria sozinha
// (POSTGRES_URL_NON_POOLING / POSTGRES_URL). Se o banco já estiver
// instalado, não faz nada. Nunca imprime senhas.
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
if (!url) {
  console.log('[banco] Sem POSTGRES_URL: pulando instalação automática.')
  process.exit(0)
}

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations')
const arquivos = readdirSync(pasta).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort()

// remove parâmetros sslmode da URL e configura SSL aqui (certificado do Supabase)
const semSsl = url.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '')
// BANCO_SEM_SSL=1 só para testes locais; no Supabase a conexão é sempre com SSL
const cliente = new pg.Client({ connectionString: semSsl, ssl: process.env.BANCO_SEM_SSL ? false : { rejectUnauthorized: false } })

try {
  await cliente.connect()
  await cliente.query(`create table if not exists public._instalacao (arquivo text primary key, em timestamptz not null default now())`)
  await cliente.query(`alter table public._instalacao enable row level security`)
  const feitos = new Set((await cliente.query('select arquivo from public._instalacao')).rows.map(r => r.arquivo))
  for (const f of arquivos) {
    if (feitos.has(f)) { console.log(`[banco] ${f}: já instalado`); continue }
    console.log(`[banco] ${f}: instalando…`)
    await cliente.query(readFileSync(join(pasta, f), 'utf8'))
    await cliente.query('insert into public._instalacao (arquivo) values ($1)', [f])
    console.log(`[banco] ${f}: OK`)
  }
  console.log('[banco] Banco pronto.')
} catch (e) {
  // não derruba a publicação do site; o erro fica no log do Vercel
  console.error('[banco] ERRO na instalação automática:', e.message)
} finally {
  await cliente.end().catch(() => {})
}
