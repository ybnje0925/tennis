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

EXPOSE 3000

CMD ["npm", "start"]
