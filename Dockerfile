FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p /app/logs
EXPOSE 3721
CMD ["node", "server.js"]
