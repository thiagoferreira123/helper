#!/bin/bash
set -e

echo "=== Bug Agent: preparando repos ==="

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERRO: GITHUB_TOKEN não configurado"
  exit 1
fi

REPO_URL="https://${GITHUB_TOKEN}@github.com/thiagoferreira123"

# Clone ou atualiza o frontend
if [ -d /repos/front-new/.git ]; then
  echo "Frontend: atualizando..."
  cd /repos/front-new && git remote set-url origin "${REPO_URL}/front-new.git" && git fetch origin && git reset --hard origin/main
else
  echo "Frontend: clonando..."
  git clone "${REPO_URL}/front-new.git" /repos/front-new
fi

# Clone ou atualiza o backend
if [ -d /repos/back/.git ]; then
  echo "Backend: atualizando..."
  cd /repos/back && git remote set-url origin "${REPO_URL}/back.git" && git fetch origin && git reset --hard origin/main
else
  echo "Backend: clonando..."
  git clone "${REPO_URL}/back.git" /repos/back
fi

echo "=== Repos prontos. Iniciando Bug Agent ==="
cd /app
exec node dist/main.js
