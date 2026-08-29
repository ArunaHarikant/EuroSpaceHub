# EuroSpaceHub — one container that serves BOTH the frontend and the API from
# the same origin (which is why the session cookie is first-party and there is
# no CORS to configure). Works on any container host: Render, Fly.io, Railway,
# a VPS with Docker, etc.
#
# Node 22.13+ is required: the database uses the built-in node:sqlite, which
# only works unflagged from 22.13. There is no native module to compile.

# Litestream binary, taken from its official image so there is no download URL to
# rot. It makes the SQLite database durable by replicating it to Backblaze B2;
# it is only used at runtime when B2 credentials are set (see docker-entrypoint.sh).
FROM litestream/litestream:0.3.13 AS litestream

FROM node:22-alpine
RUN apk add --no-cache ca-certificates
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream

WORKDIR /app

# Install server dependencies first, so this layer is cached unless the
# manifest changes.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# The server serves the repo root (frontend + shared/policy.js) as static
# files, so the whole app has to be in the image.
COPY . .
RUN chmod +x /app/docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
# SQLite lives here. With B2 set, Litestream keeps it durable across restarts;
# without B2, mount a persistent volume here for durability, or accept that it
# resets on restart.
ENV DATA_DIR=/data
ENV DB_PATH=/data/hub.db

EXPOSE 3000
WORKDIR /app/server
ENTRYPOINT ["/app/docker-entrypoint.sh"]
