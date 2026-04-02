FROM node:20-alpine

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && sh -c 'for attempt in 1 2 3; do if npm ci; then exit 0; fi; echo "npm ci failed (attempt $attempt), retrying..."; sleep 5; done; exit 1'

COPY frontend/ ./

EXPOSE 5173

CMD ["npm", "run", "dev"]
