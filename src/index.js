const assert = require('assert');
const lodash = require('lodash');
const Promise = require('bluebird');
const Koa = require('koa');
const KoaRouter = require('koa-router');
const bodyParser = require('koa-bodyparser');

const app = new Koa();
const api = KoaRouter();

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

const state = {
    messages: []
};

const redis = require('redis');
const sub = redis.createClient(6379, config.redisHost);

assert(process.env.NODE_ENV);

async function multiExecAsync(client, multiFunction) {
    const multi = client.multi();
    multiFunction(multi);
    return Promise.promisify(multi.exec).call(multi);
}

(async function() {
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
}());

async function startTest() {
    return startProduction();
}

async function startDevelopment() {
    return startProduction();
}

function formatTime(date) {
    return [date.getHours(), date.getMinutes(), date.getSeconds()].map(v => ('0' + v).slice(-2)).join(':');
}

async function startProduction() {
    state.messages.push([formatTime(new Date()), 'debug', 'subscribeChannel', config.subscribeChannel]);
    sub.on('message', (channel, message) => {
        if (process.env.NODE_ENV !== 'production') {
            console.log({channel, message});
        }
        const jsonMessage = JSON.parse(message);
        if (lodash.isArray(jsonMessage)) {
            jsonMessage.splice(0, 0, formatTime(new Date()));
        }
        state.messages.splice(0, 0, jsonMessage);
        state.messages = state.messages.slice(0, 10);
    });
    sub.subscribe(config.subscribeChannel);
    return startHttpServer();
}

async function startHttpServer() {
    api.get('/', async ctx => {
        if (/(Mobile|curl)/.test(ctx.get('user-agent'))) {
            ctx.body = JSON.stringify(state.messages, null, 2) + '\n';
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

async function end() {
    sub.quit();
}

