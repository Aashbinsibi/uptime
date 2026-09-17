# ==========================================
# Stage 1: Build TypeScript backend
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install native compilation dependencies for packages like bcrypt
RUN apk add --no-cache python3 make g++

# Copy package manifests and tsconfig
COPY package*.json tsconfig.json ./

# Install all dependencies (including devDependencies for tsc)
RUN npm ci

# Copy source code
COPY src ./src

# Build TypeScript to JavaScript in dist/
RUN npm run build

# Remove development dependencies to keep production footprint small
RUN npm prune --production

# ==========================================
# Stage 2: Production Runtime
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install C++ runtime for native addons and wget for container health checks
RUN apk add --no-cache libstdc++ wget

# Create non-root system user for improved security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy package manifests
COPY package*.json ./

# Copy production node_modules and compiled code from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Set file permissions for the unprivileged user
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

# Container health check against root health endpoint
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["node", "dist/index.js"]
