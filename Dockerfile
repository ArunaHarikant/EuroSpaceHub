# EuroSpaceHub — one container that serves BOTH the frontend and the API from
# the same origin (which is why the session cookie is first-party and there is
# no CORS to configure). Works on any container host: Render, Fly.io, Railway,
# a VPS with Docker, etc.
#
# Node 22.13+ is required: the database uses the built-in node:sqlite, which
# only works unflagged from 22.13. There is no native module to compile.
FROM node:22-alpine

WORKDIR /app

# Install server dependencies first, so this layer is cached unless the
# manifest changes.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# The server serves the repo root (frontend + shared/policy.js) as static
# files, so the whole app has to be in the image.
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
# SQLite lives here. Mount a PERSISTENT volume at /data in production, or the
# database is wiped on every restart/redeploy.
ENV DATA_DIR=/data
ENV DB_PATH=/data/hub.db

EXPOSE 3000
WORKDIR /app/server
CMD ["node", "index.js"]
