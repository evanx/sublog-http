FROM mhart/alpine-node
ADD package.json .
RUN npm install
ADD src/index.js .
ENV port 8080
EXPOSE 8080
CMD ["node", "--harmony-async-await", "index.js"]
