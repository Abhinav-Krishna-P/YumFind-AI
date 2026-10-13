# One container serves the YumFindAI web app and its API from the same origin.

# --- Build the web app (React PWA) ---
FROM node:22-slim AS web
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
# Public values baked into the browser bundle (the publishable key is meant to be public).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
RUN npm run build

# --- Run the API, which also serves the built app ---
FROM node:22-slim
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    PORT=8787 \
    WEB_DIST=/app/client/dist
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci && npm cache clean --force
COPY server/ ./
COPY --from=web /app/client/dist /app/client/dist
USER node
EXPOSE 8787
CMD ["node_modules/.bin/tsx", "src/index.ts"]
