const assert = require('assert');
const lodash = require('lodash');
const Promise = require('bluebird');
const Koa = require('koa');
const KoaRouter = require('koa-router');
const bodyParser = require('koa-bodyparser');

const app = new Koa();
const api = KoaRouter();

const config = ['subscribeChannel', 'port'].reduce((config, key) => {
    assert(process.env[key], key);
    config[key] = process.env[key];
    return config;
}, {});
const state = {};

const redis = require('redis');
const client = Promise.promisifyAll(redis.createClient());
const sub = redis.createClient();

assert(process.env.NODE_ENV);

async function multiExecAsync(client, multiFunction) {
    const multi = client.multi();
    multiFunction(multi);
    return Promise.promisify(multi.exec).call(multi);
}

async function start() {
    state.started = Math.floor(Date.now()/1000);
    state.pid = process.pid;
    console.log('start', {config, state});
    if (process.env.NODE_ENV === 'development') {
        return startDevelopment();
    } else if (process.env.NODE_ENV === 'test') {
        return startTest();
    } else {
        return startProduction();
    }
}

async function startTest() {
    return startProduction();
}

async function startDevelopment() {
    return startProduction();
}

async function startProduction() {
    sub.on('message', (channel, message) => {
        if (process.env.NODE_ENV !== 'production') {
            console.log({channel, message});
        }
        handleMessage(JSON.parse(message));
    });
    sub.subscribe(config.subscribeChannel);
    return startServer();
}

async function handleMessage(message) {
}

async function startServer() {
    api.get('/echo/*', async ctx => {
        ctx.body = JSON.stringify({url: ctx.request.url});
    });
    app.use(bodyParser());
    app.use(api.routes());
    app.use(async ctx => {
       ctx.statusCode = 404;
    });
    state.server = app.listen(config.port);
}

async function end() {
    client.quit();
}

start().then(() => {
}).catch(err => {
    console.log(err);
    end();
}).finally(() => {
});
