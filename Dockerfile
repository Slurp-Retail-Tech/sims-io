# Stage 1: Install dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: Build the application
FROM node:22-alpine AS build
WORKDIR /app

# Declare build-time args for NEXT_PUBLIC_* vars so Coolify can pass them
# via --build-arg. These get baked into the JS bundle by next build.
ARG NEXT_PUBLIC_RECAPTCHA_SITE_KEY
ARG NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
ENV NEXT_PUBLIC_RECAPTCHA_SITE_KEY=$NEXT_PUBLIC_RECAPTCHA_SITE_KEY
ENV NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=$NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 3: Production runner
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache curl

# Run as non-root for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
# Default port — Coolify overrides this at runtime via its env injection
ENV PORT=3000

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/public ./public
COPY --from=build /app/.next/static ./.next/static

# Give the non-root user ownership of the app files
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

# Use $PORT so the health check respects Coolify's runtime PORT override
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT:-3000}/" >/dev/null || exit 1

CMD ["node", "server.js"]
