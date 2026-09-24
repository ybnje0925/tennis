FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV HEADLESS=true
ENV PORT=3000
ENV DATA_DIR=/data/data
ENV SESSION_DIR=/data/sessions
# Gangdong/Songpa/other non-Olympic providers use HTTP first.  Playwright remains
# in the image because the Olympic provider is intentionally still enabled.
ENV LEGACY_HTTP_ENABLED=true
ENV LEGACY_HTTP_FALLBACK=true
ENV SONGPA_HTTP_ENABLED=false
ENV ENABLE_OLYMPIC_PROVIDER=true

EXPOSE 3000

CMD ["npm", "start"]
