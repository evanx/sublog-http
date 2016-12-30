# sublog-http

A microservice to subscribe to a Redis pubsub channel, and serve messages via HTTP.

## Example problem description

This service is intended for a personal requirement to subscribe to logging messages published via Redis.
These are arrays published via pubsub.
```
redis-cli publish 'logger:mylogger' '["info", {"name": "evanx"}]'
```
where we might subscribe in the terminal as follows:
```
redis-cli psubscribe 'logger:*'
```
where we see the messages in the console as follows:
```
Reading messages... (press Ctrl-C to quit)
1) "psubscribe"
2) "logger:*"
3) (integer) 1
1) "pmessage"
2) "logger:*"
3) "logger:mylogger"
4) "[\"info\", {\"name\": \"evanx\"}]"
```
However we want to pipe to a command-line JSON formatter to enjoy a more readable rendering:
```json
[
  "info",
  {
    "name": "evanx"
  }
]
```

We found that `redis-cli psubscribe` didn't suit that use case, e.g. piping to `jq` or `python -mjson.tool` to format the JSON.

Incidently see https://github.com/evanx/sub-push where we transfer messages to a list, `brpop` and then pipe to `jq` as an initial work-around.

Also see https://github.com/evanx/sub-write to subscribe and write to `stdout` with optional JSON formatting.

However it seemed like a good idea to use a browser to render the logging messages, even for local viewing,
which prompted the development of this `sublog-http` service.


## Implementation

The essence of the implementation is as follows:
```javascript
async function start() {
    sub.on('message', (channel, message) => {
        if (process.env.NODE_ENV !== 'production') {
            console.log({channel, message});
        }
        state.messages.splice(0, 0, JSON.parse(message));
        state.messages = state.messages.slice(0, 10);
    });
    sub.subscribe(config.subscribeChannel);
    return startHttpServer();
}
```
where we keep a list of the last 10 messages in reverse order by splicing incoming messages
into the head of the array.

We publish these `messages` via HTTP using Koa:
```javascript
async function startHttpServer() {
    api.get('/', async ctx => {
        if (/(Mobile|curl)/.test(ctx.get('user-agent'))) {
            ctx.body = JSON.stringify(state.messages, null, 2);
        } else {
            ctx.body = state.messages;
        }
    });
    app.use(api.routes());
    app.use(async ctx => {
       ctx.statusCode = 404;
    });
    state.server = app.listen(config.port);
}
```
where we format the JSON for mobile browsers i.e. without JSON formatting extensions.
```
evans@eowyn:~$ curl -s -I localhost:8080
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
```

Note that `config` is populated from environment variables as follows:
```javascript
const config = ['subscribeChannel', 'port', 'redisHost'].reduce((config, key) => {
    if (process.env[key] === '') {
        throw new Error('empty config ' + key);
    } else if (process.env[key]) {
        config[key] = process.env[key];
    } else if (!config[key]) {
        throw new Error('missing config ' + key);
    }
    return config;
}, {
    redisHost: '127.0.0.1'
});
```
where we default `redisHost` to `localhost`

Note that we check that an environment variable is not empty, for safety sake.

For example the following command line runs this service to subscribe to channel `logger:mylogger` and serve the JSON messages via port `8888`
```shell
subscribeChannel=logger:mylogger port=8888 npm start
```

![screenshot](https://raw.githubusercontent.com/evanx/sublog-web/master/readme-images/logger-phantomjs-redis.png)
<hr>

Incidently, some sample Node code for a client logger that publishes via Redis:
```javascript
const createRedisLogger = (client, loggerName) =>
['debug', 'info', 'warn', 'error'].reduce((logger, level) => {
    logger[level] = function() {
        if (!client || client.ended === true) { // Redis client ended
        } else if (level === 'debug' && process.env.NODE_ENV === 'production') {
        } else {
            const array = [].slice.call(arguments);
            const messageJson = JSON.stringify([
                level,
                ...array.map(item => {
                    if (lodash.isError(item)) {
                        return item.stack.split('\n').slice(0, 5);
                    } else {
                        return item;
                    }
                })
            ]);
            client.publish(['logger', loggerName].join(':'), messageJson);
        }
    };
    return logger;
}, {});
```
where the logger `level` is spliced as the head of the `arguments` array.

Note that logged errors are specially handled i.e. a slice of the `stack` is logged.

Later we'll publish a more sophisticated client logger with rate limiting:
```javascript
    const minute = new Date().getMinutes();
    if (metric.minute !== minute) {
        if (metric.ignored > 0) {
            client.publish(['logger', loggerName].join(':'), ['warn', {ignored: metric.ignored}]);
        }
        metric.minute = minute;
        metric.count = 0;
        metric.ignored = 0;
    } else {
        metric.count++;
        if (options.minuteLimit && metric.count > options.minuteLimit) {
            metric.ignored++;
            return;
        }
    }
```


## Docker notes

This tested on Docker 1.12 (Ubuntu 16.04) and 1.11 (Amazon Linux 2016.09)
```
docker -v
```
- `Docker version 1.12.1, build 23cf638`
- `Docker version 1.11.2, build b9f10c9/1.11.2`

```
cat /etc/issue
```
- `Ubuntu 16.04.1 LTS`
- `Amazon Linux AMI release 2016.09`

### Build application container

Let's build our application container:
```shell
docker build -t sublog-http:test https://github.com/evanx/sublog-http.git
```
where the image is named and tagged as `sublog-http:test`

Alternatively `git clone` and `npm install` and build from local dir e.g. if you wish to modify the `Dockerfile`
```shell
git clone https://github.com/evanx/sublog-http.git &&
  cd sublog-http && npm install &&
  docker build -t sublog-http:test .
```
where the default `Dockerfile` is as follows:
```
FROM mhart/alpine-node
ADD . .
RUN npm install
ENV port 8080
EXPOSE 8080
CMD ["node", "build/index.js"]
```

### Run on host network

Using the latest Docker version or 1.12, we run on the host's network i.e. using the host's Redis instance:
```shell
docker run --network=host -e NODE_ENV=test \
  -e subscribeChannel=logger:mylogger -e port=8088 -d sublog-http:test
```
where we configure its port to `8088` to test, noting:
- although by default the port is `8080` and that is exposed via the `Dockerfile`
- as the network is a `host` bridge, so the reconfigured `port` is accessible on the host

This container can be checked as follows:
- `docker ps` to see if actually started, otherwise omit `-d` to debug.
- `netstat -ntl` to see that a process is listening on port `8088`
- `http://localhost:8088` via `curl` or browser

Ensure that Redis is running on the host i.e. `localhost` port `6379`

#### Test message

We can publish a test logging message as follows:
```shell
redis-cli publish logger:mylogger '["info", "test message"]'
```
HTTP fetch:
```shell
curl -s http://localhost:8088 | python -mjson.tool
```

Sample output:
```json
[
    [
        "11:45",
        "info",
        "test message"
    ],
    [
        "11:43",
        "debug",
        "subscribeChannel",
        "logger:mylogger"
    ]
]
```

### Bridge network

Alternatively for Docker 1.11 without `--network=host` but configuring a `redisHost` IP number:
```shell
docker run -e NODE_ENV=test -e subscribeChannel=logger:mylogger \
  -e redisHost=$redisHost -d sublog-http:test
```
where `redisHost` is the IP number of the Redis instance to which the container should connect.

Note that it cannot be `localhost` as the context is the container which is running the HTTP service only.
Nor can it be omitted as `localhost` is the default Redis host used by this service.

We publish a test message as follows:
```shell
redis-cli -h $redisHost publish logger:mylogger '["info", "test message"]'
```
where naturally we must specify the same `redisHost` to which the service connects
i.e. not the default `localhost` unless its external IP number was provided to the service,
and even then rather use that to test.

Get container ID, IP address, and curl:
```shell
sublogContainer=`docker ps -q -f ancestor=sublog-http:test | head -1`
sublogHost=`docker inspect --format '{{ .NetworkSettings.Networks.bridge.IPAddress }}' $sublogContainer`
echo $sublogHost
curl -s http://$sublogHost:8080 | python -mjson.tool
```

Note that in this case the port will be the `8080` default configured and exposed in the `Dockerfile`

Incidently we can kill the container as follows:
```shell
sublogContainer=`docker ps -q -f ancestor=sublog-http:test | head -1`
[ -n "$sublogContainer" ] && docker kill $sublogContainer
```

Altogether:
```shell
if [ -n "$redisHost" ]
then    
  ids=`docker ps -q -f ancestor=sublog-http:test`
  [ -n "$ids" ] && docker kill $ids
  docker run -e NODE_ENV=test -e subscribeChannel=logger:mylogger \
    -e redisHost=$redisHost -d sublog-http:test
  sleep 1
  redis-cli -h $redisHost publish logger:mylogger '["info", "test message"]'
  sublogContainer=`docker ps -q -f ancestor=sublog-http:test | head -1`
  if [ -n "$sublogContainer" ]
  then
    sublogHost=`
      docker inspect --format '{{ .NetworkSettings.Networks.bridge.IPAddress }}' $sublogContainer`
    echo $sublogHost
    curl -s http://$sublogHost:8080 | python -mjson.tool
    docker kill $sublogContainer
  fi
fi
```

## Isolated Redis container and network

In this example we create an isolated network:
```shell
docker network create --driver bridge redis
```

We can create a Redis container named `redis-logger` as follows
```shell
docker run --network=redis --name redis-logger -d redis
```

We query its IP number and store in shell environment variable `loggerHost`
```
loggerHost=`docker inspect --format '{{ .NetworkSettings.Networks.redis.IPAddress }}' redis-logger`
```
which we can debug via
```shell
echo $loggerHost
```
to see that set e.g. to `172.18.0.2`

Finally we run our service container:
```shell
docker run --network=redis --name sublog-http-mylogger \
  -e NODE_ENV=test -e redisHost=$loggerHost -e subscribeChannel=logger:mylogger -d sublog-http:test
```
where we configure `redisHost` for the `redis-logger` container via environment variable.

Note that we:
- use the `redis` isolated network bridge for the `redis-logger` container
- configure `subscribeChannel` to `logger:mylogger` via environment variable
- name this container `sublog-http-mylogger`
- use the previously built image `sublog-http:test`

Get its IP address:
```
myloggerHttpServer=`
  docker inspect --format '{{ .NetworkSettings.Networks.redis.IPAddress }}' sublog-http-mylogger
`
```

Print its URL:
```
echo "http://$myloggerHttpServer:8080"
```

Curl test:
```
curl -s $myloggerHttpServer:8080 | python -mjson.tool
```


## Related projects

See
- https://github.com/evanx/sub-push - subscribe to Redis pubsub channel and transfer messages to a Redis list
- https://github.com/evanx/sub-write - subscribe to Redis pubsub channel and write to `stdout` with optional JSON formatting

We plan to publish microservices that similarly subscribe, but with purpose-built rendering for logging messages e.g. error messages coloured red.

Watch
- https://github.com/evanx/sublog-console
