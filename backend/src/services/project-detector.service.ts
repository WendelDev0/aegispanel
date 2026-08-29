import fs from 'fs';
import path from 'path';

export type ProjectType = 'vite' | 'nextjs' | 'nuxt' | 'remix' | 'express' | 'nestjs' | 'static-html' | 'generic-node';

export class ProjectDetector {
  static detect(buildDir: string, internalPort: number = 3000): { type: ProjectType; dockerfile: string; runtimeCmd: string; log: string } {
    let type: ProjectType = 'generic-node';
    let log = '';
    let hasPackageJson = false;
    let packageJson: any = {};

    const packageJsonPath = path.join(buildDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      hasPackageJson = true;
      try {
        packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      } catch (e) {
        // Ignore parse error
      }
    }

    const hasStartScript = !!(packageJson.scripts && packageJson.scripts.start);
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    const checkFiles = (files: string[]) => files.some(f => fs.existsSync(path.join(buildDir, f)));

    if (checkFiles(['vite.config.ts', 'vite.config.js'])) {
      type = 'vite';
      log = `🔍 Projeto Vite/React detectado (vite.config.ts ou js encontrado). Gerando Dockerfile otimizado com servidor 'serve' para SPA...`;
    } else if (checkFiles(['next.config.js', 'next.config.mjs', 'next.config.ts'])) {
      type = 'nextjs';
      log = `🔍 Projeto Next.js detectado (next.config encontrado). Gerando Dockerfile otimizado...`;
    } else if (checkFiles(['nuxt.config.ts', 'nuxt.config.js'])) {
      type = 'nuxt';
      log = `🔍 Projeto Nuxt detectado (nuxt.config encontrado). Gerando Dockerfile otimizado...`;
    } else if (checkFiles(['remix.config.js'])) {
      type = 'remix';
      log = `🔍 Projeto Remix detectado (remix.config encontrado). Gerando Dockerfile otimizado...`;
    } else if (hasPackageJson && deps['@nestjs/core']) {
      type = 'nestjs';
      log = `🔍 Projeto NestJS detectado (@nestjs/core em dependencies). Gerando Dockerfile otimizado...`;
    } else if (hasPackageJson && hasStartScript && (deps['express'] || deps['fastify'] || deps['koa'] || deps['hapi'])) {
      type = 'express';
      log = `🔍 Projeto Express/Node API detectado. Gerando Dockerfile otimizado...`;
    } else if (hasPackageJson) {
      type = 'generic-node';
      log = `🔍 Projeto Node.js genérico detectado (package.json encontrado). Gerando Dockerfile padrão...`;
    } else {
      let htmlFiles: string[] = [];
      try {
        htmlFiles = fs.readdirSync(buildDir).filter(f => f.endsWith('.html'));
      } catch (e) {}

      if (htmlFiles.length > 0) {
        type = 'static-html';
        log = `🔍 Projeto HTML estático detectado (arquivos .html sem package.json). Gerando Dockerfile Nginx...`;
      } else {
        type = 'generic-node';
        log = `🔍 Nenhum padrão específico detectado. Assumindo projeto Node.js genérico...`;
      }
    }

    let dockerfile = '';
    let runtimeCmd = '';

    if (type === 'vite') {
      dockerfile = `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps || npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/dist ./dist
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:${internalPort}/ || exit 1
EXPOSE ${internalPort}
CMD ["serve", "-s", "dist", "-l", "${internalPort}"]`;
      runtimeCmd = `serve -s dist -l ${internalPort}`;
    } else if (type === 'nextjs' || type === 'nuxt' || type === 'remix') {
      dockerfile = `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps || npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app ./
RUN npm prune --production
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:${internalPort}/ || exit 1
ENV PORT=${internalPort}
EXPOSE ${internalPort}
CMD ["npm", "start"]`;
      runtimeCmd = `npm start`;
    } else if (type === 'express' || type === 'nestjs' || (type === 'generic-node' && hasStartScript)) {
      dockerfile = `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps || npm install
COPY . .
RUN npm run build --if-present
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:${internalPort}/ || exit 1
ENV PORT=${internalPort}
EXPOSE ${internalPort}
CMD ["npm", "start"]`;
      runtimeCmd = `npm start`;
    } else if (type === 'generic-node' && !hasStartScript) {
      dockerfile = `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps || npm install
COPY . .
RUN npm run build --if-present
RUN npm install -g serve
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:${internalPort}/ || exit 1
ENV PORT=${internalPort}
EXPOSE ${internalPort}
CMD ["sh", "-c", "if [ -d dist ]; then serve -s dist -l ${internalPort}; elif [ -d build ]; then serve -s build -l ${internalPort}; elif [ -f server.js ]; then node server.js; elif [ -f index.js ]; then node index.js; elif [ -f app.js ]; then node app.js; else echo 'No entry point found' && exit 1; fi"]`;
      runtimeCmd = `sh -c "if [ -d dist ]; then serve -s dist -l ${internalPort}; elif [ -d build ]; then serve -s build -l ${internalPort}; elif [ -f server.js ]; then node server.js; elif [ -f index.js ]; then node index.js; elif [ -f app.js ]; then node app.js; else echo 'No entry point found' && exit 1; fi"`;
    } else if (type === 'static-html') {
      dockerfile = `FROM nginx:alpine
COPY . /usr/share/nginx/html
RUN rm -f /usr/share/nginx/html/Dockerfile
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:80/ || exit 1
EXPOSE 80`;
      runtimeCmd = `nginx -g 'daemon off;'`;
    }

    return { type, dockerfile, runtimeCmd, log };
  }
}
