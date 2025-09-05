#!/bin/bash
# git clone https://github.com/DaUmega/PeerCam.git
# cd PeerCam && chmod +x setup.sh && ./setup.sh
set -e

# Colors
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}[+] Updating system...${NC}"
sudo apt update && sudo apt upgrade -y

echo -e "${GREEN}[+] Installing dependencies...${NC}"
sudo apt install -y docker.io docker-compose certbot

echo -e "${GREEN}[+] Copying env file...${NC}"
if [ ! -f .env ]; then
    cp .env.example .env
    echo "⚠️  Edit .env with your DuckDNS domain + master password before continuing!"
    exit 1
fi

echo -e "${GREEN}[+] Requesting certificates...${NC}"
mkdir -p certs certs-data
EMAIL=$(grep EMAIL .env | cut -d '=' -f2)
sudo certbot certonly --standalone -d "$DUCKDNS_DOMAIN" --non-interactive --agree-tos -m "$EMAIL"

echo -e "${GREEN}[+] Copying certificates...${NC}"
cp /etc/letsencrypt/live/$(grep DUCKDNS_DOMAIN .env | cut -d '=' -f2)/fullchain.pem certs/
cp /etc/letsencrypt/live/$(grep DUCKDNS_DOMAIN .env | cut -d '=' -f2)/privkey.pem certs/

echo -e "${GREEN}[+] Starting services with Docker Compose...${NC}"
docker-compose up -d --build

echo -e "${GREEN}[✓] Deployment finished! Visit: https://$(grep DUCKDNS_DOMAIN .env | cut -d '=' -f2) ${NC}"
