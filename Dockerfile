FROM node:20-alpine AS build
WORKDIR /app
COPY package.json server.js ./
RUN npm install && npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist/server.js ./
EXPOSE 3000

CMD ["node", "server.js"]
