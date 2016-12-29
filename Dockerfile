FROM mhart/alpine-node
RUN npm install
ADD . .
ENV port 8080
EXPOSE 8080
CMD ["node", "build/index.js"]
