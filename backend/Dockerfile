FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app

# git for CI/CD clones; docker CLI + compose plugin so self-update can
# rebuild this stack through the mounted daemon socket.
RUN apk add --no-cache git docker-cli docker-cli-compose curl bash

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

EXPOSE 4000
CMD ["node", "dist/server.js"]
