FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY scripts/bootstrap-pnpm.sh /tmp/bootstrap-pnpm.sh
RUN apk add --no-cache zlib=1.3.2-r1 && sh /tmp/bootstrap-pnpm.sh && rm /tmp/bootstrap-pnpm.sh
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
COPY deploy/healthcheck.ts ./deploy/healthcheck.ts
RUN pnpm run build && pnpm prune --prod --offline && \
    find node_modules -mindepth 1 -maxdepth 1 -type d -empty -delete

FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS production
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache zlib=1.3.2-r1 age && \
    rm -rf /usr/local/lib/node_modules /opt/yarn-* && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
COPY deploy/start.sh /app/start.sh
COPY LICENSE THIRD_PARTY_NOTICES.md /app/licenses/
RUN chmod 555 /app/start.sh && mkdir /app/backup-work && chown 1000:1000 /app/backup-work && chmod 700 /app/backup-work
USER 1000:1000
EXPOSE 8080 8081 8082
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "/app/build/deploy/healthcheck.js"]
ENTRYPOINT ["/app/start.sh"]
