#!/bin/bash
set -e

GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}[+] Installing Docker and Docker Compose...${NC}"
sudo apt update
sudo apt install -y docker.io docker-compose

echo -e "${GREEN}[+] Copying .env file...${NC}"
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${GREEN}⚠️  Please edit .env with your DuckDNS domain and email before continuing.${NC}"
    exit 1
fi

sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT

echo -e "${GREEN}[+] Starting Docker containers...${NC}"
DOCKER_BUILDKIT=1 && sudo docker-compose up -d --build

echo -e "${GREEN}[✓] Deployment finished!${NC}"
echo -e "${GREEN}Your PeerCam app should be accessible at: https://$(grep DUCKDNS_DOMAIN .env | cut -d '=' -f2)${NC}"
