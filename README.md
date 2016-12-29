# sublog-http

A microservice to subscribe to a Redis pubsub channel, and serve messages via HTTP.

The essence of the implementation is as follows:
```javascript
async function startProduction() {
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
where `config` is populated from environment variables as follows:
```javascript
const config = ['subscribeChannel', 'port', 'redisHost'].reduce((config, key) => {
    assert(process.env[key] || config[key], key);
    config[key] = process.env[key];
    return config;
}, {
    redisHost: '127.0.0.1'
});
```
where we default `redisHost` to `localhost`

For example the following command line runs this service to subscribe to channel `logger:mylogger` and serve the JSON messages via port `8888`
```shell
subscribeChannel=logger:mylogger port=8888 npm start
```

![screenshot](https://raw.githubusercontent.com/evanx/sublog-web/master/readme-images/logger-phantomjs-redis.png)
<hr>


## Sample use case

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

We found that `redis-cli psubscribe` didn't suit that use case, e.g. piping to `jq` or `python -mjson.tool` to format the JSON. See https://github.com/evanx/sub-push where we transfer messages to a list, `brpop` and then pipe to `jq`


## Application container on host network

Note this apparently requires at least Docker 1.12 
```
evan@dijkstra:~$ docker -v
Docker version 1.12.1, build 23cf638
```
e.g. on Ubuntu 16.04:
```
evan@dijkstra:~/sublog-http$ cat /etc/issue
Ubuntu 16.04.1 LTS \n \l
```

Build our application container:
```shell
docker build -t sublog-http:test https://github.com/evanx/sublog-http.git
```
where the image is named and tagged as `sublog-http:test`

Run on host's network i.e. using the host's redis instance:
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

We can publish a test logging message as follows:
```shell
redis-cli publish logger:mylogger '["info", "test message"]'
```
HTTP fetch:
```shell
curl -s http://localhost:8088 | python -mjson.tool
```
e.g.
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
curl $myloggerHttpServer:8080 | python -mjson.tool
```


## Related projects

See
- https://github.com/evanx/sub-push - subscribe to Redis pubsub channel and transfer messages to a Redis list
- https://github.com/evanx/sub-write - subscribe to Redis pubsub channel and write to `stdout` with optional JSON formatting

We plan to publish microservices that similarly subscribe, but with purpose-built rendering for logging messages e.g. error messages coloured red.

Watch
- https://github.com/evanx/sublog-console

## Related code

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
