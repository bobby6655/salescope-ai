FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# 锁文件只包含公开npm依赖；构建时转换下载域名，保留版本和integrity校验。
RUN node -e "const fs=require('fs');let s=fs.readFileSync('package-lock.json','utf8');s=s.replaceAll('https://npm.corp.kuaishou.com/','https://registry.npmjs.org/');fs.writeFileSync('package-lock.json',s)" \
    && npm ci --registry=https://registry.npmjs.org/
COPY index.html vite.config.js ./
COPY src ./src
COPY server ./server
COPY data ./data
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY src ./src
COPY scripts/read-xlsx.py ./scripts/read-xlsx.py
RUN mkdir -p /var/lib/salescope && chown node:node /var/lib/salescope
ENV NODE_ENV=production PORT=3000 DATA_ROOT=/var/lib/salescope WQ_DEMO_FALLBACK=false
USER node
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/production.js"]
