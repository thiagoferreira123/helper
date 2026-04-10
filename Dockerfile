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

# Instalar Codex CLI globalmente
RUN npm install -g @openai/codex

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Criar user não-root
RUN useradd -m -s /bin/bash agent \
 && mkdir -p /repos \
 && chown -R agent:agent /repos /app

# Git config para o user agent
USER agent
RUN git config --global user.email "bug-agent@dietsystem.com.br" \
 && git config --global user.name "Bug Agent"

ENV NODE_ENV=production
ENV PORT=3000
ENV HOME=/home/agent

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
