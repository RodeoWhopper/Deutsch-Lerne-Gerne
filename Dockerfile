# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-trixie-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN npm run build

FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM ${NODE_IMAGE}
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 TRUST_PROXY=1
WORKDIR /app
# age is needed only for `npm run backup` (INSTALL_AGE=0 skips it, e.g. for offline CI builds)
ARG INSTALL_AGE=1
RUN if [ "$INSTALL_AGE" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends age ca-certificates && rm -rf /var/lib/apt/lists/*; \
    fi \
    && mkdir /data && chown node:node /data
COPY --from=prod-deps --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist ./dist
COPY --chown=root:root package.json ./
COPY --chown=root:root src ./src
COPY --chown=root:root scripts ./scripts
COPY --chown=root:root schema ./schema
COPY --chown=root:root packs ./packs
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server/index.ts"]
