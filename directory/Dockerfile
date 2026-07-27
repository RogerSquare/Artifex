FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js ./
RUN mkdir -p data
ENV PORT=3010
ENV DIRECTORY_DB_PATH=/app/data/directory.db
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http=require('http'); http.get('http://localhost:3010/api/health', r => { process.exit(r.statusCode===200?0:1) }).on('error', () => process.exit(1))"
VOLUME ["/app/data"]
CMD ["node", "server.js"]
