# ---- Base Node ----
FROM node:18-alpine AS base
WORKDIR /app
COPY package*.json ./

# ---- Dependencies ----
FROM base AS dependencies
# Suppress the frozen lockfile error sometimes seen with legacy peer deps
RUN npm install --legacy-peer-deps

# ---- Build ----
FROM dependencies AS build
COPY . .
# We must generate the prisma client natively for the Alpine architecture
RUN npx prisma generate
RUN npm run build

# ---- Production ----
FROM node:18-alpine AS production
WORKDIR /app

# Install openssl for Prisma compatibility on alpine
RUN apk add --no-cache openssl

# Copy node modules and build from previous stages
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./

# Expose port and start script
EXPOSE 3000
CMD [ "npm", "run", "start:prod" ]
