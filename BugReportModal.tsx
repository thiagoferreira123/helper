import { useState, useRef, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'

// ─── tipos ───────────────────────────────────────────────────────────────────

type Severity = 'critico' | 'alto' | 'medio' | 'baixo'

interface BugReportPayload {
  description: string
  severity: Severity
  service: string
  reportedBy: string
  imageBase64?: string
  imageMimeType?: string
  imageName?: string
}

interface BugReportResponse {
  jobId: string
  message: string
}

// ─── hook de envio ───────────────────────────────────────────────────────────

function useBugReport() {
  return useMutation<BugReportResponse, Error, BugReportPayload>({
    mutationFn: async (payload) => {
      const res = await fetch(`${import.meta.env.VITE_BUG_AGENT_URL}/bugs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message ?? 'Erro ao enviar reporte')
      }
      return res.json()
    },
  })
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const SEVERITY_LABELS: Record<Severity, string> = {
  critico: 'Crítico',
  alto: 'Alto',
  medio: 'Médio',
  baixo: 'Baixo',
}

const FEATURES = [
  // ── Dashboard / Pacientes ──
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'patients', label: 'Pacientes (listagem)' },
  { value: 'patients-overview', label: 'Pacientes (visão geral)' },
  { value: 'patient', label: 'Ficha do Paciente' },
  { value: 'patient-dashboard', label: 'Dashboard do Paciente' },
  { value: 'patient-files', label: 'Arquivos do Paciente' },
  { value: 'patient-report', label: 'Relatório do Paciente' },
  { value: 'patient-public-registration', label: 'Cadastro Público de Paciente' },
  // ── Nutrição / Plano Alimentar ──
  { value: 'meal-plan-builder', label: 'Montador de Plano Alimentar' },
  { value: 'meal-plan-builder-refactor', label: 'Montador de Plano (novo)' },
  { value: 'plan-builder', label: 'Plan Builder' },
  { value: 'templates', label: 'Templates' },
  { value: 'recipes', label: 'Receitas' },
  { value: 'nutritional-guidance', label: 'Orientação Nutricional' },
  { value: 'food-diary-gallery', label: 'Diário Alimentar (galeria)' },
  { value: 'manipulated-formula', label: 'Fórmula Manipulada' },
  { value: 'products', label: 'Produtos' },
  // ── Clínico ──
  { value: 'anamnesis', label: 'Anamnese' },
  { value: 'exams', label: 'Exames' },
  { value: 'exam-analysis-ia', label: 'Análise de Exames (IA)' },
  { value: 'medical-records', label: 'Prontuário' },
  { value: 'body-scan', label: 'Body Scan' },
  { value: 'comparative-photos', label: 'Fotos Comparativas' },
  { value: 'weight-evolution', label: 'Evolução de Peso' },
  { value: 'goals', label: 'Metas' },
  // ── Antropometria ──
  { value: 'anthropometry-adult', label: 'Antropometria Adulto' },
  { value: 'anthropometry-pediatric', label: 'Antropometria Pediátrica' },
  { value: 'anthropometry-pregnant', label: 'Antropometria Gestante' },
  { value: 'anthropometry-bioimpedance', label: 'Bioimpedância' },
  { value: 'caloric-expenditure', label: 'Gasto Calórico' },
  // ── Agenda / Comunicação ──
  { value: 'calendar', label: 'Agenda / Calendário' },
  { value: 'scheduling', label: 'Agendamento Online' },
  { value: 'chat', label: 'Chat' },
  { value: 'chats', label: 'Conversas' },
  { value: 'whatsapp-integration', label: 'Integração WhatsApp' },
  { value: 'notifications', label: 'Notificações' },
  // ── Financeiro ──
  { value: 'billing', label: 'Assinatura / Billing' },
  { value: 'checkout', label: 'Checkout' },
  { value: 'financial-control', label: 'Controle Financeiro' },
  { value: 'affiliate', label: 'Programa de Afiliados' },
  // ── Admin / Config ──
  { value: 'admin-panel', label: 'Painel Admin' },
  { value: 'settings', label: 'Configurações' },
  { value: 'users', label: 'Usuários' },
  { value: 'form-builder', label: 'Construtor de Formulários' },
  { value: 'apps', label: 'Apps / Integrações' },
  // ── Conteúdo ──
  { value: 'club', label: 'Club' },
  { value: 'news', label: 'Novidades' },
  { value: 'tutorials', label: 'Tutoriais' },
  { value: 'shared-materials', label: 'Materiais Compartilhados' },
  { value: 'insights', label: 'Insights' },
  { value: 'tasks', label: 'Tarefas' },
  // ── Outros ──
  { value: 'auth', label: 'Login / Autenticação' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'audio-transcription', label: 'Transcrição de Áudio' },
  { value: 'document-verification', label: 'Verificação de Documentos' },
  { value: 'outro', label: 'Outro' },
]

// ─── componente principal ─────────────────────────────────────────────────────

interface BugReportModalProps {
  /** Usuário logado — preenchido automaticamente */
  currentUser: string
  onClose: () => void
}

export function BugReportModal({ currentUser, onClose }: BugReportModalProps) {
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<Severity>('medio')
  const [service, setService] = useState('')
  const [image, setImage] = useState<{ file: File; preview: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { mutate, isPending, isSuccess, isError, error, data } = useBugReport()

  // ── upload de imagem ──────────────────────────────────────────────────────

  const handleImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const preview = URL.createObjectURL(file)
    setImage({ file, preview })
  }, [])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleImageFile(file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleImageFile(file)
  }

  const clearImage = () => {
    if (image) URL.revokeObjectURL(image.preview)
    setImage(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!description.trim() || !service) return

    let imageBase64: string | undefined
    let imageMimeType: string | undefined
    let imageName: string | undefined

    if (image) {
      imageBase64 = await fileToBase64(image.file)
      imageMimeType = image.file.type
      imageName = image.file.name
    }

    mutate({
      description: description.trim(),
      severity,
      service,
      reportedBy: currentUser,
      imageBase64,
      imageMimeType,
      imageName,
    })
  }

  const canSubmit = description.trim().length > 10 && service && !isPending

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">

        {/* cabeçalho */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Reportar bug</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">O agente vai analisar e abrir uma PR automaticamente</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">

          {/* severidade */}
          <div>
            <label className="mb-1.5 block text-xs text-gray-500 dark:text-gray-400">Severidade</label>
            <div className="grid grid-cols-4 gap-1.5">
              {(Object.keys(SEVERITY_LABELS) as Severity[]).map((sev) => (
                <button
                  key={sev}
                  onClick={() => setSeverity(sev)}
                  className={[
                    'rounded-lg border py-1.5 text-xs font-medium transition-colors',
                    severity === sev
                      ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
                  ].join(' ')}
                >
                  {SEVERITY_LABELS[sev]}
                </button>
              ))}
            </div>
          </div>

          {/* feature afetada */}
          <div>
            <label className="mb-1.5 block text-xs text-gray-500 dark:text-gray-400">Feature afetada</label>
            <select
              value={service}
              onChange={(e) => setService(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="">Selecione a feature...</option>
              {FEATURES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>

          {/* descrição */}
          <div>
            <label className="mb-1.5 block text-xs text-gray-500 dark:text-gray-400">
              Descrição <span className="text-red-400">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="O que aconteceu? O que era esperado? Como reproduzir?"
              className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
            <p className="mt-0.5 text-right text-xs text-gray-400">{description.length} chars</p>
          </div>

          {/* upload de imagem */}
          <div>
            <label className="mb-1.5 block text-xs text-gray-500 dark:text-gray-400">Print da tela</label>

            {!image ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={[
                  'flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed p-5 text-center transition-colors',
                  dragOver
                    ? 'border-blue-400 bg-blue-50 dark:bg-blue-950'
                    : 'border-gray-200 bg-gray-50 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800',
                ].join(' ')}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="opacity-40">
                  <rect x="2" y="2" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M5 13l4-4 3 3 2-3 3 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <p className="text-xs text-gray-500 dark:text-gray-400">Clique ou arraste PNG / JPG</p>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange}/>
              </div>
            ) : (
              <div className="relative">
                <img
                  src={image.preview}
                  alt="preview"
                  className="max-h-36 w-full rounded-lg border border-gray-200 object-cover dark:border-gray-700"
                />
                <button
                  onClick={clearImage}
                  className="absolute right-2 top-2 rounded-full bg-white p-1 shadow-sm dark:bg-gray-800"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
                <p className="mt-1 text-xs text-gray-400">{image.file.name}</p>
              </div>
            )}
          </div>

          {/* reportado por (somente leitura) */}
          <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-gray-400">
              <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M2 14c0-3.314 2.686-5 6-5s6 1.686 6 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <span className="text-xs text-gray-500 dark:text-gray-400">Reportando como</span>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{currentUser}</span>
          </div>

          {/* erro */}
          {isError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
              {error.message}
            </div>
          )}

          {/* sucesso */}
          {isSuccess && (
            <div className="rounded-lg bg-green-50 px-3 py-2 dark:bg-green-950">
              <p className="text-xs font-medium text-green-700 dark:text-green-300">Job enfileirado</p>
              <p className="mt-0.5 font-mono text-xs text-green-600 dark:text-green-400">ID: {data.jobId}</p>
              <p className="mt-0.5 text-xs text-green-600 dark:text-green-400">
                Você receberá uma notificação quando a PR for aberta.
              </p>
            </div>
          )}
        </div>

        {/* rodapé */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-800">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPending ? 'Enviando...' : 'Enviar para o agente →'}
          </button>
        </div>
      </div>
    </div>
  )
}
