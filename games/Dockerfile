FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

ARG VITE_GO_URL=http://localhost:8081
ARG VITE_SCALA_URL=http://localhost:8080
ARG VITE_PROLOG_URL=http://localhost:8082
ENV VITE_GO_URL=$VITE_GO_URL \
    VITE_SCALA_URL=$VITE_SCALA_URL \
    VITE_PROLOG_URL=$VITE_PROLOG_URL

RUN npm run build
COPY entrypoint.sh ./entrypoint.sh
EXPOSE 5173
CMD ["sh", "/app/entrypoint.sh"]
