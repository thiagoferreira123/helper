/**
 * Mapa de features do frontend (src/features/<nome>/).
 * Usado nos prompts para que o agente vá direto ao código certo.
 */
export const FEATURE_MAP: Record<string, string> = {
  // Dashboard / Pacientes
  dashboard:
    'src/features/dashboard/ — página inicial, cards de resumo, gráficos de atendimentos',
  patients:
    'src/features/patients/ — listagem de pacientes, busca, filtros, tabela paginada',
  'patients-overview':
    'src/features/patients-overview/ — visão geral com métricas agregadas de pacientes',
  patient:
    'src/features/patient/ — ficha individual do paciente, layout com tabs',
  'patient-dashboard':
    'src/features/patient-dashboard/ — dashboard dentro da ficha do paciente',
  'patient-files':
    'src/features/patient-files/ — upload e listagem de arquivos do paciente',
  'patient-report':
    'src/features/patient-report/ — geração de relatório PDF do paciente',
  'patient-public-registration':
    'src/features/patient-public-registration/ — formulário público de cadastro de paciente',

  // Nutrição / Plano Alimentar
  'meal-plan-builder':
    'src/features/meal-plan-builder/ — montador de plano alimentar, drag-and-drop de refeições, cálculo macro/micro',
  'meal-plan-builder-refactor':
    'src/features/meal-plan-builder-refactor/ — versão nova do montador de plano alimentar',
  'plan-builder':
    'src/features/plan-builder/ — construtor genérico de planos',
  templates:
    'src/features/templates/ — templates de planos alimentares reutilizáveis',
  recipes:
    'src/features/recipes/ — CRUD de receitas, ingredientes, modo de preparo, cálculo nutricional',
  'nutritional-guidance':
    'src/features/nutritional-guidance/ — orientações nutricionais para pacientes',
  'food-diary-gallery':
    'src/features/food-diary-gallery/ — galeria de fotos do diário alimentar do paciente',
  'manipulated-formula':
    'src/features/manipulated-formula/ — fórmulas manipuladas / suplementação',
  products:
    'src/features/products/ — catálogo de produtos nutricionais',

  // Clínico
  anamnesis:
    'src/features/anamnesis/ — formulário de anamnese, histórico clínico',
  exams:
    'src/features/exams/ — cadastro e visualização de exames laboratoriais',
  'exam-analysis-ia':
    'src/features/exam-analysis-ia/ — análise de exames via IA',
  'medical-records':
    'src/features/medical-records/ — prontuário eletrônico, evolução clínica',
  'body-scan':
    'src/features/body-scan/ — scanner corporal 3D / fotos',
  'comparative-photos':
    'src/features/comparative-photos/ — comparação antes/depois de fotos do paciente',
  'weight-evolution':
    'src/features/weight-evolution/ — gráfico de evolução de peso ao longo do tempo',
  goals:
    'src/features/goals/ — metas do paciente (peso, medidas, hábitos)',

  // Antropometria
  'anthropometry-adult':
    'src/features/anthropometry-adult/ — avaliação antropométrica adulto (dobras, circunferências)',
  'anthropometry-pediatric':
    'src/features/anthropometry-pediatric/ — avaliação antropométrica pediátrica (curvas OMS)',
  'anthropometry-pregnant':
    'src/features/anthropometry-pregnant/ — avaliação antropométrica gestante',
  'anthropometry-bioimpedance':
    'src/features/anthropometry-bioimpedance/ — bioimpedância, composição corporal',
  'caloric-expenditure':
    'src/features/caloric-expenditure/ — cálculo de gasto calórico (Harris-Benedict, etc)',

  // Agenda / Comunicação
  calendar:
    'src/features/calendar/ — agenda/calendário de consultas, integração FullCalendar',
  scheduling:
    'src/features/scheduling/ — agendamento online público para pacientes',
  chat:
    'src/features/chat/ — chat em tempo real com pacientes',
  chats:
    'src/features/chats/ — listagem de conversas',
  'whatsapp-integration':
    'src/features/whatsapp-integration/ — integração com WhatsApp (envio de mensagens)',
  notifications:
    'src/features/notifications/ — central de notificações, push, e-mail',

  // Financeiro
  billing:
    'src/features/billing/ — assinatura, planos, cobranças recorrentes',
  checkout:
    'src/features/checkout/ — fluxo de pagamento / checkout',
  'financial-control':
    'src/features/financial-control/ — controle financeiro, receitas e despesas',
  affiliate:
    'src/features/affiliate/ — programa de afiliados, links de indicação',

  // Admin / Config
  'admin-panel':
    'src/features/admin-panel/ — painel administrativo interno',
  settings:
    'src/features/settings/ — configurações do usuário/clínica',
  users:
    'src/features/users/ — gestão de usuários e permissões',
  'form-builder':
    'src/features/form-builder/ — construtor de formulários dinâmicos',
  apps:
    'src/features/apps/ — integrações e apps de terceiros',

  // Conteúdo
  club:
    'src/features/club/ — club de conteúdos para nutricionistas',
  news:
    'src/features/news/ — novidades e changelog do sistema',
  tutorials:
    'src/features/tutorials/ — tutoriais e guias',
  'shared-materials':
    'src/features/shared-materials/ — materiais compartilhados entre profissionais',
  insights:
    'src/features/insights/ — insights e analytics de uso',
  tasks:
    'src/features/tasks/ — lista de tarefas do profissional',

  // Outros
  auth:
    'src/features/auth/ — login, registro, recuperação de senha, guards de rota',
  onboarding:
    'src/features/onboarding/ — fluxo de onboarding pós-registro',
  'audio-transcription':
    'src/features/audio-transcription/ — transcrição de áudio de consultas',
  'document-verification':
    'src/features/document-verification/ — verificação de documentos (CRN, etc)',
};

/** Gera o trecho de texto do mapa para injetar no prompt */
export function getFeatureMapText(service: string): string {
  const entry = FEATURE_MAP[service];
  if (!entry) return `Feature "${service}" — buscar em src/`;

  const lines = [`FEATURE ALVO: ${entry}`];
  lines.push('');
  lines.push('ARQUIVOS COMPARTILHADOS:');
  lines.push('- src/components/ui/ — componentes shadcn/ui');
  lines.push('- src/lib/api.ts — instância axios');
  lines.push('- src/stores/auth-store.ts — auth Zustand');
  lines.push('- src/hooks/ — hooks globais');
  lines.push('- src/lib/utils.ts — helpers (cn, formatters)');

  return lines.join('\n');
}
