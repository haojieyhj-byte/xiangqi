FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY engine ./engine
COPY server ./server
COPY public ./public
COPY README.md ./

ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080

CMD ["node", "server/index.js"]
