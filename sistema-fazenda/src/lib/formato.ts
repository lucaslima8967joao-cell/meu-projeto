export const hojeISO = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export function dataBR(iso?: string | null) {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

export function kg(v?: number | null) {
  if (v === null || v === undefined) return '—'
  return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' kg'
}

export function num(v?: number | null, casas = 2) {
  if (v === null || v === undefined) return '—'
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

export function idade(meses?: number | null) {
  if (meses === null || meses === undefined) return '—'
  if (meses < 24) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`
  const a = Math.floor(meses / 12), r = meses % 12
  return `${a} anos${r ? ` e ${r} m` : ''}`
}

/** Traduz erros do banco para mensagens que o usuário entende. */
export function erroAmigavel(e: unknown): string {
  const msg = (e as { message?: string })?.message || String(e)
  if (msg.includes('ux_animais_chip')) return 'Já existe um animal ativo com este CHIP.'
  if (msg.includes('ux_animais_controle')) return 'Já existe um animal ativo com este nº de CONTROLE.'
  if (msg.includes('ux_animais_brinco')) return 'Já existe um animal ativo com este BRINCO.'
  if (msg.includes('pastos_fazenda_id_codigo_key')) return 'Já existe um pasto com este código nesta fazenda.'
  if (msg.includes('lotes_fazenda_id_nome_key')) return 'Já existe um lote com este nome nesta fazenda.'
  if (msg.includes('row-level security')) return 'Você não tem permissão para fazer isso.'
  if (msg.includes('check constraint')) return 'Algum valor está fora do permitido (ex.: data no futuro ou peso inválido).'
  if (msg.includes('Failed to fetch')) return 'Sem conexão com a internet. Tente de novo.'
  return msg
}

export const SEXO: Record<string, string> = { M: 'Macho', F: 'Fêmea' }
export const SITUACAO: Record<string, string> = {
  ativo: 'Ativo', vendido: 'Vendido', morto: 'Morto', descartado: 'Descartado', transferido: 'Transferido',
}
export const PRIORIDADE: Record<string, string> = { baixa: 'Baixa', media: 'Média', alta: 'Alta' }
export const STATUS: Record<string, string> = { pendente: 'Pendente', andamento: 'Em andamento', concluida: 'Concluída' }

// Mesmas faixas do Relatório Mensal do Rebanho. A categoria é calculada pela idade;
// a lista abaixo só é usada quando o animal não tem data de nascimento.
export const CATEGORIAS = ['Bezerra 0-4 m', 'Bezerra 5-12 m', 'Novilha 13-24 m', 'Novilha 25-36 m', 'Vaca acima de 36 m',
  'Bezerro 0-4 m', 'Bezerro 5-12 m', 'Garrote 13-24 m', 'Garrote 25-36 m', 'Boi acima de 36 m', 'Touro']
export const TIPOS_AREA = ['Pasto', 'Agricultura', 'Reflorestamento/Mata', 'Desmatado/Sem definição', 'Eucalipto', 'Outro']

export function reais(v?: number | null) {
  if (v === null || v === undefined) return '—'
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Baixa uma lista como CSV que o Excel abre direto (ponto e vírgula, UTF-8 com BOM). */
export function baixarCSV(nome: string, cab: string[], linhas: unknown[][]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const corpo = [cab, ...linhas].map(l => l.map(esc).join(';')).join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['\ufeff' + corpo], { type: 'text/csv;charset=utf-8' }))
  a.download = nome; a.click()
}
export const RACAS = ['NEL', 'Angus', 'Cruzado', 'Outra']
