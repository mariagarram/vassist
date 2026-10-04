FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
# La base de datos vive en /app/data: en Railway, añade un Volume montado en /app/data (no se declara aquí).
# VASSIST_MODE=telegram (pruebas, por defecto) o start (WhatsApp, necesita puerto HTTPS).
ENV VASSIST_MODE=telegram
CMD ["sh", "-c", "npm run ${VASSIST_MODE}"]
