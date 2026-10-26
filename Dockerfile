ARG NODE_VERSION=26

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --ignore-scripts

COPY apps/api/babel.config.cjs apps/api/
COPY apps/api/src apps/api/src
RUN npm run build -w apps/api

FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/apps/api/dist apps/api/dist

USER node
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/main.js"]