# .storybook/Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Copy from parent directory (packages/ui)
COPY ../package*.json ./
RUN npm ci

COPY ../ ./

RUN npm run build-storybook

FROM nginx:alpine

COPY --from=builder /app/storybook-static /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]