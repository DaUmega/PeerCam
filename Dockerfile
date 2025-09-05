# Dockerfile
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json first (cache dependencies)
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the app
COPY . .

# Expose port used internally by Apache
EXPOSE 8080

# Start the app
CMD ["node", "server.js"]
