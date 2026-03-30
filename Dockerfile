FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/public ./public
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "require('http').get('http://127.0.0.1:3000/', (res) => process.exit(res.statusCode >= 200 && res.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"
CMD ["node", "server.js"]
