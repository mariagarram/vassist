FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
# La base de datos vive en /app/data: monta ahí un volumen persistente o se perderá en cada despliegue.
VOLUME ["/app/data"]
# VASSIST_MODE=telegram (pruebas, por defecto) o start (WhatsApp, necesita puerto HTTPS).
ENV VASSIST_MODE=telegram
CMD ["sh", "-c", "npm run ${VASSIST_MODE}"]
