FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public
COPY scripts ./scripts

ENV NODE_ENV=production
EXPOSE 9001

CMD ["npm", "start"]
