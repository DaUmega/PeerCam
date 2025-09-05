FROM node:latest

WORKDIR /app

COPY package*.json ./

RUN npm install -g npm@latest
RUN npm install --omit=dev

COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
