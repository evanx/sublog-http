let multiExecAsync = (() => {
    var _ref = _asyncToGenerator(function* (client, multiFunction) {
        const multi = client.multi();
        multiFunction(multi);
        return Promise.promisify(multi.exec).call(multi);
    });

    return function multiExecAsync(_x, _x2) {
        return _ref.apply(this, arguments);
    };
})();

let start = (() => {
    var _ref2 = _asyncToGenerator(function* () {
        state.started = Math.floor(Date.now() / 1000);
        state.pid = process.pid;
        console.log('start', { config, state });
        if (process.env.NODE_ENV === 'development') {
            return startDevelopment();
        } else if (process.env.NODE_ENV === 'test') {
            return startTest();
        } else {
            return startProduction();
        }
    });

    return function start() {
        return _ref2.apply(this, arguments);
    };
})();

let startTest = (() => {
    var _ref3 = _asyncToGenerator(function* () {
        return startProduction();
    });

    return function startTest() {
        return _ref3.apply(this, arguments);
    };
})();

let startDevelopment = (() => {
    var _ref4 = _asyncToGenerator(function* () {
        return startProduction();
    });

    return function startDevelopment() {
        return _ref4.apply(this, arguments);
    };
})();

let startProduction = (() => {
    var _ref5 = _asyncToGenerator(function* () {
        state.messages.push([formatTime(new Date()), 'debug', 'subscribeChannel', config.subscribeChannel]);
        sub.on('message', function (channel, message) {
            if (process.env.NODE_ENV !== 'production') {
                console.log({ channel, message });
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
    });

    return function startProduction() {
        return _ref5.apply(this, arguments);
    };
})();

let startHttpServer = (() => {
    var _ref6 = _asyncToGenerator(function* () {
        api.get('/', (() => {
            var _ref7 = _asyncToGenerator(function* (ctx) {
                if (/(Mobile|curl)/.test(ctx.get('user-agent'))) {
                    ctx.body = JSON.stringify(state.messages, null, 2);
                } else {
                    ctx.body = state.messages;
                }
            });

            return function (_x3) {
                return _ref7.apply(this, arguments);
            };
        })());
        app.use(api.routes());
        app.use((() => {
            var _ref8 = _asyncToGenerator(function* (ctx) {
                ctx.statusCode = 404;
            });

            return function (_x4) {
                return _ref8.apply(this, arguments);
            };
        })());
        state.server = app.listen(config.port);
    });

    return function startHttpServer() {
        return _ref6.apply(this, arguments);
    };
})();

let end = (() => {
    var _ref9 = _asyncToGenerator(function* () {
        sub.quit();
    });

    return function end() {
        return _ref9.apply(this, arguments);
    };
})();

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

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
        throw new Error('config ' + key);
    } else if (process.env[key]) {
        config[key] = process.env[key];
    } else if (!config[key]) {
        throw new Error('config ' + key);
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

function formatTime(date) {
    return [date.getHours(), date.getMinutes(), date.getSeconds()].map(v => ('0' + v).slice(-2)).join(':');
}

start().then(() => {}).catch(err => {
    console.error(err);
    end();
}).finally(() => {});
