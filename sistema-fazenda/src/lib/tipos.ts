export type Papel = 'admin' | 'gerente' | 'operador'
export interface Perfil { id: string; nome: string; email: string | null; papel: Papel; ativo: boolean }
export interface Fazenda { id: string; nome: string; municipio: string | null; obs: string | null; arquivado: boolean }
export interface Pasto {
  id: string; fazenda_id: string; codigo: string; codigo_antigo: string | null; nome: string | null
  area_ha: number | null; lotacao_ua_chuva: number | null; lotacao_ua_seca: number | null
  situacao: string | null; tipo_solo: string | null; obs: string | null; arquivado: boolean
}
export interface Lote { id: string; fazenda_id: string; nome: string; descricao: string | null; pasto_id: string | null; arquivado: boolean }
export interface Animal {
  id: string; fazenda_id: string; controle: string | null; chip: string | null; brinco: string | null
  nome: string | null; sexo: 'M' | 'F'; raca: string | null; nascimento: string | null; categoria: string | null
  lote_id: string | null; pasto_id: string | null; mae_id: string | null; pai_id: string | null
  pai_descricao: string | null; situacao: string; obs: string | null; arquivado: boolean
  fazenda_nome?: string; lote_nome?: string | null; pasto_codigo?: string | null; mae_controle?: string | null
  ultimo_peso_kg?: number | null; ultima_pesagem?: string | null; idade_meses?: number | null
}
export interface Pesagem { id: string; animal_id: string; data: string; peso_kg: number; obs: string | null }
export interface Tarefa {
  id: string; titulo: string; descricao: string | null; data: string; hora: string | null
  prioridade: 'baixa' | 'media' | 'alta'; pasto_id: string | null; local_texto: string | null
  responsavel_id: string | null; equipe: string | null; materiais: string | null
  status: 'pendente' | 'andamento' | 'concluida'; obs_execucao: string | null; arquivado: boolean
}
