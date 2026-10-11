# The host's image: Node LTS and the one-file bundle `pnpm build:server` writes to dist/cli.js.
# Build it from servers/fake after the bundle: docker build -t promptfall servers/fake
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app
COPY dist/cli.js server.js

# The store and its backups live on volumes the non-root user owns.
RUN mkdir -p /data /backups && chown node:node /data /backups
VOLUME ["/data", "/backups"]
USER node

EXPOSE 7777
ENTRYPOINT ["node", "server.js"]
CMD ["--host", "0.0.0.0", "--store", "sqlite:/data/promptfall.sqlite"]
