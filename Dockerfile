FROM mhart/alpine-node:base

ADD . .

CMD ["node", "build/index.js"]
