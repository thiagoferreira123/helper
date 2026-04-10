# Bug Agent

Agente autônomo de correção de bugs. Um usuário reporta um bug via formulário no frontend (descrição + print), o agente analisa o código na VPS, aplica a correção na branch `homologacao` e abre uma PR. Após aprovação humana, o merge é feito normalmente.

---

## Como funciona

```
Usuário preenche formulário no frontend
        ↓
POST /bugs  →  BullMQ (fila persistente no Redis)
        ↓
Worker consome 1 job por vez
        ↓
Agentes paralelos analisam (Vision + Codebase + Logs)
        ↓
Claude Code aplica o fix no repo clonado na VPS
        ↓
Testes rodam — se falhar, tenta corrigir automaticamente
        ↓
Commit + push → branch homologacao
        ↓
PR aberta no GitHub  →  revisão humana  →  merge
```

O job **nunca é perdido**: se a VPS reiniciar no meio da execução, o BullMQ retoma automaticamente. Apenas um job roda por vez para evitar conflitos no git.

---

## Estrutura do repositório

```
bug-agent/
├── src/
│   ├── main.ts                      # entry point, habilita CORS
│   ├── app.module.ts                # raiz — importa todos os módulos
│   │
│   ├── queue/
│   │   ├── queue.module.ts          # registra a fila "bug-jobs"
│   │   ├── queue.service.ts         # enqueue(), getJob(), getStats()
│   │   └── bug.processor.ts         # @Processor — orquestra as 7 etapas
│   │
│   ├── intake/
│   │   ├── intake.controller.ts     # POST /bugs  |  GET /bugs/:id/status
│   │   └── intake.module.ts
│   │
│   ├── agent/
│   │   ├── agent.module.ts
│   │   ├── agent.service.ts         # analyze(), applyFix(), runTests()
│   │   ├── prompt.builder.ts        # monta o prompt para o Claude Code
│   │   └── agents/
│   │       ├── vision.agent.ts      # analisa o print via Claude Vision
│   │       ├── codebase.agent.ts    # busca semântica no repo (embeddings)
│   │       └── reviewer.agent.ts    # valida o fix antes do push
│   │
│   ├── git/
│   │   ├── git.service.ts           # fetchAndReset, createBranch, commitAndPush, mergeToHomologacao
│   │   └── github.service.ts        # openPR via Octokit
│   │
│   └── dashboard/
│       └── dashboard.module.ts      # Bull Board em /admin/queues
│
├── frontend/
│   ├── BugReportModal.tsx           # componente React — cola no seu projeto
│   └── useJobStatus.tsx             # hook de polling do status do job
│
├── deploy/
│   └── bug-agent.service            # unit file do systemd
│
├── .env.example                     # todas as variáveis necessárias
├── package.json
├── tsconfig.json
└── nest-cli.json
```

---

## Pré-requisitos na VPS

- Node.js 20+
- Redis 7+
- Git configurado com acesso de leitura/escrita ao repositório do produto
- Claude Code CLI autenticado (ver seção de login abaixo)
- Usuário `deploy` com permissão de escrita em `/opt/repos/`

---

## Setup na VPS

### 1. Instalar dependências de sistema

```bash
# Redis
sudo apt update && sudo apt install -y redis-server git
sudo systemctl enable redis --now

# Node.js 20 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20 && nvm use 20
```

### 2. Clonar o bug-agent

```bash
git clone git@github.com:sua-org/bug-agent.git /opt/bug-agent
cd /opt/bug-agent
npm ci
npm run build
```

### 3. Clonar o repositório do produto na branch homologacao

```bash
# Este é o repo que o agente vai modificar
git clone git@github.com:sua-org/seu-produto.git /opt/repos/seu-produto
cd /opt/repos/seu-produto
git checkout homologacao
```

> O agente sempre trabalha neste diretório. Nunca aponta para o repo em produção.

### 4. Login no Claude Code

```bash
cd /opt/bug-agent
npx claude login
# Abre o browser — faça login com seu e-mail Anthropic
# A chave é salva em ~/.config/claude e reutilizada automaticamente
```

Após o login, a `ANTHROPIC_API_KEY` é gerenciada pelo CLI. Você pode também setá-la manualmente no `.env` se preferir.

### 5. Configurar variáveis de ambiente

```bash
cp .env.example .env
nano .env
```

Preencha obrigatoriamente:

| Variável | Como obter |
|---|---|
| `GITHUB_TOKEN` | github.com → Settings → Developer settings → Personal access tokens → permissões: `repo` |
| `GITHUB_OWNER` | nome da organização ou usuário no GitHub |
| `GITHUB_REPO` | nome do repositório do produto |
| `REPO_PATH` | `/opt/repos/seu-produto` |
| `DASHBOARD_PASSWORD` | qualquer senha forte |
| `FRONTEND_URL` | URL do seu frontend (ex: `https://app.suaempresa.com`) |

As variáveis de Slack são opcionais — só precisam se for usar o intake via Slack além do formulário.

### 6. Instalar como serviço systemd

```bash
sudo cp deploy/bug-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable bug-agent --now

# Verificar se subiu
sudo systemctl status bug-agent
journalctl -u bug-agent -f
```

O serviço reinicia automaticamente se o processo cair.

---

## Integração no frontend React

### 1. Adicionar variável de ambiente

No `.env` do seu projeto frontend:

```env
VITE_BUG_AGENT_URL=http://ip-da-vps:3000
```

### 2. Copiar os arquivos

```
frontend/BugReportModal.tsx  →  src/components/BugReportModal.tsx
frontend/useJobStatus.tsx    →  src/hooks/useJobStatus.tsx
```

O componente usa Tailwind e React Query — dependências que você já tem.

### 3. Usar o modal

```tsx
import { useState } from 'react'
import { BugReportModal } from '@/components/BugReportModal'

export function Header() {
  const [open, setOpen] = useState(false)
  const { user } = useAuth() // seu hook de autenticação existente

  return (
    <>
      <button onClick={() => setOpen(true)}>Reportar bug</button>

      {open && (
        <BugReportModal
          currentUser={user.name}    // preenchido automaticamente
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
```

### 4. Mostrar status de um job (opcional)

```tsx
import { JobStatusBadge } from '@/hooks/useJobStatus'

// Cole em qualquer lugar onde quiser mostrar o progresso
<JobStatusBadge jobId="42" />
// Faz polling a cada 4s e para quando o job completa ou falha
```

---

## API do agente

### `POST /bugs`

Enfileira um novo job de correção.

**Body:**
```json
{
  "description": "O botão de pagamento não responde ao clicar",
  "severity": "critico",
  "service": "Payments Service",
  "reportedBy": "joao.silva",
  "imageBase64": "iVBORw0KGgo...",
  "imageMimeType": "image/png"
}
```

**Resposta:**
```json
{
  "jobId": "42",
  "message": "Bug enfileirado. PR será aberta em breve."
}
```

Severidades aceitas: `critico` | `alto` | `medio` | `baixo`

### `GET /bugs/:jobId/status`

Retorna o estado atual de um job.

**Resposta:**
```json
{
  "jobId": "42",
  "state": "active",
  "progress": 65,
  "logs": ["Preparando workspace...", "Análise concluída: payments.service.ts:142"],
  "result": null,
  "failedReason": null
}
```

Estados possíveis: `waiting` | `active` | `completed` | `failed` | `delayed`

### `GET /bugs/stats`

```json
{ "waiting": 2, "active": 1, "completed": 47, "failed": 3 }
```

---

## Dashboard de jobs

Disponível em `http://ip-da-vps:3001/admin/queues` com autenticação básica.

Usuário: valor de `DASHBOARD_USER` no `.env` (padrão: `admin`)
Senha: valor de `DASHBOARD_PASSWORD` no `.env`

Mostra todos os jobs com status, logs em tempo real, histórico de falhas e opção de reprocessar.

---

## Fluxo de git na VPS

O agente opera exclusivamente no diretório `REPO_PATH`. A sequência para cada job é:

```
git fetch origin
git reset --hard origin/homologacao   ← sempre parte de um estado limpo
git checkout -b fix/agent-<jobId>     ← branch isolada por job
  ... aplica o fix ...
  ... roda os testes ...
git commit -m "fix(service): ..."
git push origin fix/agent-<jobId>
git checkout homologacao
git merge fix/agent-<jobId>
git push origin homologacao           ← agente já está em homologacao
  → abre PR: homologacao → develop
git branch -d fix/agent-<jobId>       ← limpa a branch temporária
```

Se o job falhar em qualquer etapa, a branch `fix/agent-<jobId>` é deletada e o repo é resetado para `origin/homologacao` no próximo job.

---

## Comportamento de retry

Cada job tem 3 tentativas com backoff exponencial:

- 1ª falha → aguarda 30s → tenta novamente
- 2ª falha → aguarda 60s → tenta novamente
- 3ª falha → marca como `failed`, notifica (se Slack configurado)

Jobs em `failed` ficam visíveis no dashboard e podem ser reprocessados manualmente.

---

## Logs

```bash
# Acompanhar em tempo real
journalctl -u bug-agent -f

# Últimas 200 linhas
journalctl -u bug-agent -n 200

# Filtrar erros
journalctl -u bug-agent -p err
```

---

## Comandos úteis

```bash
# Reiniciar o agente
sudo systemctl restart bug-agent

# Ver status
sudo systemctl status bug-agent

# Parar
sudo systemctl stop bug-agent

# Rebuild após mudanças de código
cd /opt/bug-agent
git pull
npm ci
npm run build
sudo systemctl restart bug-agent

# Atualizar o repo do produto manualmente
cd /opt/repos/seu-produto
git fetch origin
git reset --hard origin/homologacao
```

---

## O que falta implementar

Os arquivos abaixo estão referenciados no código mas precisam ser escritos:

| Arquivo | Responsabilidade |
|---|---|
| `src/agent/agent.service.ts` | Spawna o Claude Code CLI, passa o prompt, streama os logs de volta para o job |
| `src/agent/prompt.builder.ts` | Monta o prompt estruturado com contexto do bug, serviço e histórico |
| `src/agent/agents/vision.agent.ts` | Envia o print para a API de vision do Claude e extrai contexto da UI |
| `src/agent/agents/codebase.agent.ts` | Indexa o repo com embeddings, faz busca semântica para localizar o bug |
| `src/agent/agents/reviewer.agent.ts` | Valida o diff gerado antes do commit (lint, tipos, segurança) |
| `src/git/git.service.ts` | Wrapper sobre `simple-git` com todos os métodos usados no processor |
| `src/git/github.service.ts` | Abre PR via Octokit com o template de body já montado |
| `src/dashboard/dashboard.module.ts` | Registra o Bull Board com autenticação básica |
| `deploy/bug-agent.service` | Unit file do systemd com `EnvironmentFile`, `Restart=always` e `User=deploy` |

---

## Decisões de arquitetura

**Por que fila em vez de webhook direto?**
Se a VPS reiniciar durante uma correção, o job não é perdido. O BullMQ persiste o estado no Redis e retoma no próximo boot.

**Por que concurrency: 1?**
O agente modifica arquivos no sistema de arquivos e faz operações git. Dois jobs simultâneos causariam conflitos de merge. Um job por vez é a garantia de consistência.

**Por que branch separada por job e não direto na homologacao?**
Isolamento — se o fix falhar nos testes, não contamina a branch principal. O merge só acontece após todos os testes passarem.

**Por que repo separado na VPS e não o mesmo monorepo?**
O agente precisa de permissão de escrita no git, roda testes que podem ser pesados e tem seu próprio ciclo de deploy. Misturar com o produto cria risco de um processo derrubar o outro.
