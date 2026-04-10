# ── Build stage ────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json nest-cli.json ./
COPY src/ ./src/
RUN npx nest build

# ── Production stage ──────────────────────────────────────────────────
FROM node:20-slim

RUN apt-get update && apt-get install -y git curl openssh-client && rm -rf /var/lib/apt/lists/*

# Git config global para commits do agente
RUN git config --global user.email "bug-agent@dietsystem.com.br" \
 && git config --global user.name "Bug Agent"

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Instalar Claude Code CLI globalmente
RUN npm install -g @anthropic-ai/claude-code

COPY --from=builder /app/dist ./dist
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Diretório para os repos clonados (volume persistente)
RUN mkdir -p /repos /root/.claude

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
