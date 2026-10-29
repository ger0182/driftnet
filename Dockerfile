# Build driftnet from this repository so Railway always deploys the fork's code,
# not the separately published npm package.
FROM node:22-slim AS builder

WORKDIR /src
RUN npm install -g pnpm@10.12.1

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:npm \
    && cd dist/npm \
    && npm pack --pack-destination /tmp \
    && mv /tmp/driftnet-*.tgz /tmp/driftnet.tgz

# Keep the runtime image small while preserving the normal `driftnet` CLI.
FROM node:22-slim

COPY --from=builder /tmp/driftnet.tgz /tmp/driftnet.tgz
RUN npm install -g /tmp/driftnet.tgz \
    && rm /tmp/driftnet.tgz \
    && npm cache clean --force \
    && mkdir -p /data

ENV NODE_ENV=production \
    DRIFTNET_HOME=/data \
    DRIFTNET_HOST=0.0.0.0 \
    DRIFTNET_OPEN=0

VOLUME ["/data"]
EXPOSE 8787

ENTRYPOINT ["driftnet"]
CMD ["start"]
