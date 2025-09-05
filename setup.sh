#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}[+] Updating system...${NC}"
sudo apt update && sudo apt upgrade -y

echo -e "${GREEN}[+] Installing dependencies...${NC}"
sudo apt install -y docker.io docker-compose

echo -e "${GREEN}[+] Copying .env file...${NC}"
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${GREEN}⚠️  Please edit .env with your DuckDNS domain and email before continuing.${NC}"
    exit 1
fi

echo -e "${GREEN}[+] Starting Docker containers...${NC}"
docker-compose up -d --build

echo -e "${GREEN}[✓] Deployment finished!${NC}"
echo -e "${GREEN}Your PeerCam app should be accessible at: https://$(grep DUCKDNS_DOMAIN .env | cut -d '=' -f2)${NC}"
