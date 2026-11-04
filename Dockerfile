# watchEverywhere —— 单镜像部署（服务端 + 已构建前端 + 内置规则）
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV npm_config_fund=false npm_config_audit=false

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY scripts ./scripts
# postinstall 会跑 scripts/setup-iptv.mjs，先把脚本拷进来；容器里不需要 iPTV 预置
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8898 \
    WE_NO_OPEN=1 \
    WE_DATA_DIR=/data

# 运行只需要 server 的依赖 + 构建产物；前端已打进 packages/server/public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/packages/server ./packages/server
COPY --from=build /app/rules ./rules
COPY --from=build /app/scripts ./scripts

VOLUME ["/data"]
EXPOSE 8898

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8898)+'/api/app/info',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "packages/server/src/run.ts"]
