FROM mhart/alpine-node
ADD . .
RUN npm install
ENV port 8080
EXPOSE 8080
CMD ["node", "build/index.js"]
