FROM mhart/alpine-node:base
ADD . .
ENV port 8080
EXPOSE 8080
CMD ["node", "build/index.js"]
