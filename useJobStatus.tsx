import { useQuery } from '@tanstack/react-query'

export type JobState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'not_found'

interface JobStatus {
  jobId: string
  state: JobState
  progress: number
  logs: string[]
  result: { prUrl: string; summary: string } | null
  failedReason: string | null
}

const STATE_LABEL: Record<JobState, string> = {
  waiting:   'Na fila',
  active:    'Processando...',
  completed: 'Concluído',
  failed:    'Falhou',
  delayed:   'Agendado',
  not_found: 'Não encontrado',
}

// Faz polling a cada 4s enquanto o job não termina
export function useJobStatus(jobId: string | null) {
  return useQuery<JobStatus>({
    queryKey: ['job-status', jobId],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_BUG_AGENT_URL}/bugs/${jobId}/status`)
      return res.json()
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const state = query.state.data?.state
      if (!state || state === 'completed' || state === 'failed') return false
      return 4000
    },
  })
}

// Componente simples de status — cole onde quiser no frontend
export function JobStatusBadge({ jobId }: { jobId: string }) {
  const { data } = useJobStatus(jobId)
  if (!data) return null

  const colors: Record<JobState, string> = {
    waiting:   'bg-gray-100 text-gray-600',
    active:    'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    failed:    'bg-red-100 text-red-700',
    delayed:   'bg-yellow-100 text-yellow-700',
    not_found: 'bg-gray-100 text-gray-400',
  }

  return (
    <div className="space-y-2">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[data.state]}`}>
        {data.state === 'active' && (
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current"/>
        )}
        {STATE_LABEL[data.state]}
        {data.state === 'active' && ` ${data.progress}%`}
      </span>

      {data.state === 'completed' && data.result?.prUrl && (
        <a
          href={data.result.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs text-blue-600 underline dark:text-blue-400"
        >
          Ver Pull Request →
        </a>
      )}

      {data.state === 'failed' && (
        <p className="text-xs text-red-600 dark:text-red-400">{data.failedReason}</p>
      )}
    </div>
  )
}
