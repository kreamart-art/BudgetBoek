# Frontend-image — statische Vite-build, geserveerd door nginx.
# Nodig voor de self-hosted (compose) opzet of Coolify-als-static-site.
# Op Vercel heb je dit NIET nodig (zie vercel.json + docs/DEPLOYMENT.md).
#
# LET OP: Vite bakt env-vars in tijdens de build. Geef de backend-URL mee als build-arg:
#   docker build --build-arg VITE_API_URL=https://api.jouwdomein.nl -t budget-frontend ./frontend

# ---- builder ----
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ---- runtime ----
FROM nginx:alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
