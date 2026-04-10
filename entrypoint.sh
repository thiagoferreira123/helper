#!/bin/bash
set -e

echo "=== Bug Agent: preparando repos ==="

# Clone ou atualiza o frontend
if [ -d /repos/front-new/.git ]; then
  echo "Frontend: atualizando..."
  cd /repos/front-new && git fetch origin && git reset --hard origin/main
else
  echo "Frontend: clonando..."
  git clone https://github.com/thiagoferreira123/front-new.git /repos/front-new
fi

# Clone ou atualiza o backend
if [ -d /repos/back/.git ]; then
  echo "Backend: atualizando..."
  cd /repos/back && git fetch origin && git reset --hard origin/main
else
  echo "Backend: clonando..."
  git clone https://github.com/thiagoferreira123/back.git /repos/back
fi

echo "=== Repos prontos. Iniciando Bug Agent ==="
cd /app
exec node dist/main.js
