#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

DEPLOY_DIR=~/fe-agentic-workflow/your-agent
LOG_DIR=~/.niesta
LOG_FILE="$LOG_DIR/deploy.log"

mkdir -p "$LOG_DIR"
cd "$DEPLOY_DIR"

echo "Pulling latest..."
PULL_OUT=$(git pull 2>&1) || { echo -e "${RED}git pull failed${NC}"; exit 1; }
if echo "$PULL_OUT" | grep -q "Already up to date"; then
  echo -e "${YELLOW}Already up to date.${NC}"
  read -p "Continue with deploy anyway? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Exiting."
    exit 0
  fi
fi

echo "Stopping existing containers..."
docker compose down || true

echo "Building and starting..."
docker compose up -d --build || { echo -e "${RED}docker compose up failed${NC}"; exit 1; }

echo "Waiting 5s..."
sleep 5

echo "Container status:"
docker compose ps

COMMIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "$TIMESTAMP $COMMIT_HASH" >> "$LOG_FILE"

echo ""
echo -e "${GREEN}--- Deploy summary ---${NC}"
echo "Timestamp:  $TIMESTAMP"
echo "Commit:     $COMMIT_HASH"
echo "Log:        $LOG_FILE"
docker compose ps
echo -e "${GREEN}Done.${NC}"
