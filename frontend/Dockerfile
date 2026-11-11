FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Porta di default di Next.js
EXPOSE 3000

CMD ["npm", "run", "dev"]