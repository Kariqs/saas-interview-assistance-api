# Stage 1: Build the app
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including typescript for build)
RUN npm ci

# Copy source code
COPY . .

# Compile TypeScript to JavaScript
RUN npx tsc

# Stage 2: Production image (minimal)
FROM node:20-slim

WORKDIR /app

# Copy only necessary files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Expose port
EXPOSE 3000

# Environment variables (set at runtime)
ENV NODE_ENV=production
ENV PORT=3000

# Start the app
CMD ["node", "dist/index.js"]