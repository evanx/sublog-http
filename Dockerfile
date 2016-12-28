FROM mhart/alpine-node

WORKDIR /src
ADD . .

CMD ["node", "build/index.js"]
