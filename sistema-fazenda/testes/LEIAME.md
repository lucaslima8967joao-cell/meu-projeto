# Conferência automática (check-out)

Um robô abre o sistema e aperta os botões de todas as abas (57 passos), usando um
banco de dados **falso, em memória**, com dados fictícios — não toca no banco real.

```bash
cd sistema-fazenda
VITE_SUPABASE_URL=http://supabase-falso.local VITE_SUPABASE_ANON_KEY=teste npx vite build --outDir /caminho/temporario
npx vite preview --outDir /caminho/temporario --port 4173 &
node testes/checkout.cjs celular   # ou: node testes/checkout.cjs pc
```

Cada passo sai com ✅ ou ❌ e o motivo. Requer o Playwright instalado.
