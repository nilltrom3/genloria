FROM node:22-slim

# Dependencias de compilación para better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# Datos persistentes (montar volumen aquí)
VOLUME ["/app/data", "/app/uploads"]

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
