'use strict';

const Assert = require('chai').assert;
const Jackrabbit = require('../lib/jackrabbit');
const Sinon = require('sinon');
const EventEmitter = require('events');

const { after, beforeEach, describe, it } = require('mocha');

const AMQP_PORT = 8080;

describe('reconnection', () => {

    let RECONN_TIMEOUT;
    let RECONN_RETRIES;
    let EXACT_TIMEOUT;
    const STUB_RABBIT_URL = `amqp://localhost:${AMQP_PORT}`;

    let AmqpStub;
    const Amqp = require('amqplib/callback_api');

    beforeEach((done) => {

        Sinon.verifyAndRestore();
        Sinon.stub(process, 'exit');
        AmqpStub = Sinon.stub(Amqp, 'connect');

        RECONN_TIMEOUT = 4;
        RECONN_RETRIES = 5;
        EXACT_TIMEOUT = false;

        done();
    });

    after((done) => {

        Sinon.verifyAndRestore();
        done();
    });

    const mockLogger = () => {

        let idx = 0;
        const history = [];
        return {
            history,
            log: (level, message) => history.push({ level, message }),
            assert: (level, message) => {

                const entry = history[idx++];
                Assert.equal(entry.level, level);
                Assert.equal(entry.message, message);
            }
        };
    };

    const waitEvent = (emitter, event, timeout = 100) => {

        const timeoutErr = new Error(`Timeout waiting ${event} (${timeout}ms)`);
        return new Promise((resolve, reject) => {

            const handler = (...args) => {

                emitter.removeListener(event, handler);
                resolve(args);
            };

            emitter.on(event, handler);
            setTimeout(() => {

                emitter.removeListener(event, handler);
                reject(timeoutErr);
            }, timeout);
        });
    };

    const mockRabbitServer = async ({ logger = undefined, stub, rabbit = undefined, addQueues = undefined, isReconnecting = undefined, exchangeCount = 0, queueCount = 0, consumerCount = queueCount, uniqueKeys = queueCount }) => {

        if (!stub) {
            stub = Sinon.stub(Amqp, 'connect');
        }

        const reconnecting = rabbit !== undefined && isReconnecting !== false;
        let opts = undefined;
        if (!rabbit) {
            process.env.RABBIT_RECONNECTION_TIMEOUT = RECONN_TIMEOUT;
            process.env.RABBIT_RECONNECTION_RETRIES = RECONN_RETRIES;
            process.env.RABBIT_RECONNECTION_EXACT_TIMEOUT = EXACT_TIMEOUT;
            rabbit = Jackrabbit(STUB_RABBIT_URL, logger, opts = {});
        }

        Assert.strictEqual(stub.callCount, 1);
        Assert.strictEqual(stub.args[0][0], `amqp://localhost:${AMQP_PORT}`);

        const genQueueName = () => {

            const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-';
            let label = 'amq.gen-';
            for (let i = 22; i > 0; --i) {
                label += chars[Math.floor(Math.random() * chars.length)];
            }

            return label;
        };

        const mockConnection = () => {

            const conn = new EventEmitter();

            conn.createChannel = Sinon.stub().callsFake((cb) => cb(null, conn));
            conn.assertExchange = Sinon.stub().callsFake((exchange, type, options, cb) => setTimeout(cb, 1));
            conn.prefetch = Sinon.stub();
            conn.assertQueue = Sinon.stub().callsFake((queue, options, cb) => setTimeout(() => cb(null, { queue: queue || genQueueName() }), 1));
            conn.bindQueue = Sinon.stub().callsFake((queue, exchange, routingKey, options, cb) => setTimeout(cb, 1));
            conn.consume = Sinon.stub();
            conn.publish = Sinon.stub().callsFake((exchange, routingKey, content, options) => setTimeout(() => {}, 1));

            return conn;
        };

        const verifyConnection = (conn) => {

            Assert.strictEqual(conn.createChannel.callCount, exchangeCount + queueCount);
            Assert.strictEqual(conn.assertExchange.callCount, exchangeCount);
            Assert.strictEqual(conn.prefetch.callCount, queueCount);
            Assert.strictEqual(conn.assertQueue.callCount, queueCount);
            Assert.strictEqual(conn.bindQueue.callCount, uniqueKeys);
            Assert.strictEqual(conn.consume.callCount, consumerCount);
        };

        const onConnect = waitEvent(rabbit, reconnecting ? 'reconnected' : 'connected');
        const conn = mockConnection();
        stub.args[0][2](null, conn);
        if (addQueues) {
            await addQueues();
        }

        await onConnect;

        verifyConnection(conn);

        return { conn, rabbit, opts };
    };

    const rabbitStartError = (amqpStub) => {

        amqpStub.reset();
        amqpStub.callsFake((url, undefined, cb) =>

            setTimeout(() => {

                const closedSocketError = new Error('Socket closed abruptly during opening handshake');
                cb(closedSocketError, null);
            }, 1));
    };

    const rabbitStopError = (amqpStub) => amqpStub.reset();

    it('Should trigger when connection is lost', async () => {

        const logger = mockLogger();
        const { conn, opts } = await mockRabbitServer({ logger, stub: AmqpStub });

        const lostConnection = new Error('Connection to RabbitMQ lost');
        lostConnection.code = 320;

        const asyncClose = waitEvent(conn, 'close', 10);
        conn.emit('close', lostConnection);
        await asyncClose; // Everything should occur inside this awaiter.

        // check logs
        logger.assert('warn', `Lost connection to RabbitMQ! Reconnecting in ${opts.reconnectionTimeout}ms...`);
    });

    it('Should read retry env vars', async () => {

        RECONN_TIMEOUT = 1000 + Math.floor(Math.random() * 3000);
        RECONN_RETRIES = Math.ceil(Math.random() * 10);
        EXACT_TIMEOUT = true;

        const server = await mockRabbitServer({ logger: mockLogger(), stub: AmqpStub });

        Assert.strictEqual(server.opts.reconnectionTimeout, RECONN_TIMEOUT);
        Assert.strictEqual(server.opts.maxRetries, RECONN_RETRIES);
    });

    it('Should default to inexact reconnection time', async () => {

        RECONN_TIMEOUT = 2000;

        const logger = mockLogger();
        for (let i = 0; i < 3; ++i) {
            const server = await mockRabbitServer({ logger, stub: AmqpStub });
            if (server.opts.reconnectionTimeout > RECONN_TIMEOUT) {
                return;
            }

            AmqpStub.reset();
        }

        Assert.fail('Reconnection timeout did not change');
    });

    it('Should have a random reconnection overhead of up to 10% when on inexact mode', async () => {

        RECONN_TIMEOUT = 2000;
        const min = RECONN_TIMEOUT;
        const max = RECONN_TIMEOUT * 1.1;

        const logger = mockLogger();
        for (let i = 0; i < 100; ++i) {
            const server = await mockRabbitServer({ logger, stub: AmqpStub });
            Assert.isAtLeast(server.opts.reconnectionTimeout, min);
            Assert.isBelow(server.opts.reconnectionTimeout, max);

            AmqpStub.reset();
        }
    });

    it('Should retry immediately after disconnecting', async () => {

        const logger = mockLogger();
        const { conn, rabbit, opts } = await mockRabbitServer({ logger, stub: AmqpStub });

        const lostConnection = new Error('Connection to RabbitMQ lost');
        lostConnection.code = 320;

        let gotReconnecting = false;
        waitEvent(rabbit, 'reconnecting', 10).then(() => (gotReconnecting = true));

        const asyncClose = waitEvent(conn, 'close', 10);
        conn.emit('close', lostConnection);
        await asyncClose; // Everything should occur inside this awaiter.

        Assert.strictEqual(gotReconnecting, true);

        // check logs
        logger.assert('warn', `Lost connection to RabbitMQ! Reconnecting in ${opts.reconnectionTimeout}ms...`);
        logger.assert('info', 'Reconnecting to RabbitMQ (1/5)...');
    });

    it('Should support connection refused errors', async () => {

        const logger = mockLogger();
        const { conn, rabbit, opts } = await mockRabbitServer({ logger, stub: AmqpStub });

        const lostConnection = new Error('got ECONNREFUSED error on 127.0.0.1');
        lostConnection.code = 'ECONNREFUSED';

        let gotReconnecting = false;
        waitEvent(rabbit, 'reconnecting', 10).then(() => (gotReconnecting = true));

        const asyncClose = waitEvent(conn, 'close', 10);
        conn.emit('close', lostConnection);
        await asyncClose; // Everything should occur inside this awaiter.

        Assert.strictEqual(gotReconnecting, true);

        // check logs
        logger.assert('warn', `Lost connection to RabbitMQ! Reconnecting in ${opts.reconnectionTimeout}ms...`);
        logger.assert('info', 'Reconnecting to RabbitMQ (1/5)...');
    });

    it('Should support connection reset errors', async () => {

        const logger = mockLogger();
        const { conn, rabbit, opts } = await mockRabbitServer({ logger, stub: AmqpStub });

        const lostConnection = new Error('unexpected close: ECONNRESET');
        lostConnection.code = 'ECONNRESET';

        let gotReconnecting = false;
        waitEvent(rabbit, 'reconnecting', 10).then(() => (gotReconnecting = true));

        const asyncClose = waitEvent(conn, 'close', 10);
        conn.emit('close', lostConnection);
        await asyncClose; // Everything should occur inside this awaiter.

        Assert.strictEqual(gotReconnecting, true);

        // check logs
        logger.assert('warn', `Lost connection to RabbitMQ! Reconnecting in ${opts.reconnectionTimeout}ms...`);
        logger.assert('info', 'Reconnecting to RabbitMQ (1/5)...');
    });

    it('Should exit after exhausting reconnection attempts', async () => {

        RECONN_RETRIES = 4;

        const logger = mockLogger();
        const { conn, rabbit, opts } = await mockRabbitServer({ logger, stub: AmqpStub });
        const asyncReconn = waitEvent(rabbit, 'reconnecting', RECONN_TIMEOUT * .6); // immediate reconnection

        const lostConnection = new Error('Connection to RabbitMQ lost');
        lostConnection.code = 320;

        rabbitStartError(AmqpStub);
        conn.emit('close', lostConnection);

        await asyncReconn;
        await waitEvent(rabbit, 'reconnecting', Math.max(15, RECONN_TIMEOUT * 1.3)); // second attempt
        await waitEvent(rabbit, 'reconnecting', Math.max(15, RECONN_TIMEOUT * 1.3)); // third attempt
        await Promise.all([
            waitEvent(rabbit, 'reconnecting', Math.max(15, RECONN_TIMEOUT * 1.3)), // fourth attempt
            waitEvent(rabbit, 'error', Math.max(15, RECONN_TIMEOUT * 1.3)) // reconn error
        ]);

        Assert.strictEqual(process.exit.callCount, 1);
        Assert.strictEqual(process.exit.args[0][0], 1);

        // check logs
        logger.assert('warn', `Lost connection to RabbitMQ! Reconnecting in ${opts.reconnectionTimeout}ms...`);
        logger.assert('info', 'Reconnecting to RabbitMQ (1/4)...');
        logger.assert('info', 'Reconnecting to RabbitMQ (2/4)...');
        logger.assert('info', 'Reconnecting to RabbitMQ (3/4)...');
        logger.assert('info', 'Reconnecting to RabbitMQ (4/4)...');
        logger.assert('fatal', 'Rabbit connection error!');

    });

    it('Should reconnect once the connection is recovered', async () => {

        const logger = mockLogger();
        const { conn, rabbit, opts } = await mockRabbitServer({ logger, stub: AmqpStub });
        const asyncReconn = waitEvent(rabbit, 'reconnecting', RECONN_TIMEOUT * .6); // immediate reconnection

        const lostConnection = new Error('Connection to RabbitMQ lost');
        lostConnection.code = 320;

        rabbitStartError(AmqpStub);
        conn.emit('close', lostConnection);

        await asyncReconn;
        await waitEvent(rabbit, 'reconnecting', Math.max(15, RECONN_TIMEOUT * 1.3)); // second attempt

        rabbitStopError(AmqpStub);

        await waitEvent(rabbit, 'reconnecting', Math.max(15, RECONN_TIMEOUT * 1.3)); // third attempt

        await mockRabbitServer({ logger, stub: AmqpStub, rabbit });

        // check logs
        logger.assert('warn', `Lost connection to RabbitMQ! Reconnecting in ${opts.reconnectionTimeout}ms...`);
        logger.assert('info', 'Reconnecting to RabbitMQ (1/5)...');
        logger.assert('info', 'Reconnecting to RabbitMQ (2/5)...');
        logger.assert('info', 'Reconnecting to RabbitMQ (3/5)...');
        logger.assert('info', 'Reconnected to RabbitMQ');

    });

    it('Should be able to publish and consume after reconnecting', async () => {

        const logger = mockLogger();
        const opts = {};
        process.env.RABBIT_RECONNECTION_TIMEOUT = RECONN_TIMEOUT;
        process.env.RABBIT_RECONNECTION_RETRIES = RECONN_RETRIES;
        process.env.RABBIT_RECONNECTION_EXACT_TIMEOUT = EXACT_TIMEOUT;
        const rabbit = Jackrabbit(STUB_RABBIT_URL, logger, opts);
        const exchange = rabbit.exchange('direct', 'my.queue');
        let queue;

        let { conn } = await mockRabbitServer({
            rabbit, stub: AmqpStub, isReconnecting: false, exchangeCount: 1, queueCount: 1,
            addQueues: async () => {

                queue = exchange.queue({ key: 'test' });
                queue.consume(() => {});
                await waitEvent(queue, 'bound');
            }
        });
        const asyncReconn = waitEvent(rabbit, 'reconnecting', RECONN_TIMEOUT * .6); // immediate reconnection

        const lostConnection = new Error('Connection to RabbitMQ lost');
        lostConnection.code = 320;

        rabbitStartError(AmqpStub);
        conn.emit('close', lostConnection);
        await asyncReconn;

        rabbitStopError(AmqpStub);

        await waitEvent(rabbit, 'reconnecting', Math.max(15, RECONN_TIMEOUT * 1.3)); // second attempt
        const server = await mockRabbitServer({ logger, stub: AmqpStub, rabbit, exchangeCount: 1, queueCount: 1, uniqueKeys: 0, consumerCount: 0 });
        conn = server.conn;

        logger.assert('warn', `Lost connection to RabbitMQ! Reconnecting in ${opts.reconnectionTimeout}ms...`);
        logger.assert('info', 'Reconnecting to RabbitMQ (1/5)...');
        logger.assert('info', 'Reconnecting to RabbitMQ (2/5)...');
        logger.assert('info', 'Reconnected to RabbitMQ');

        const message = 'hakuna matata';
        exchange.publish(message, { key: 'test' });
        Assert.equal(conn.publish.callCount, 1);
    });

    it('Should be able to reconnect multiple times', async () => {

        const logger = mockLogger();
        let { conn, rabbit, opts } = await mockRabbitServer({ logger, stub: AmqpStub });
        let asyncReconn = waitEvent(rabbit, 'reconnecting', RECONN_TIMEOUT * .6); // immediate reconnection

        const lostConnection = new Error('Connection to RabbitMQ lost');
        lostConnection.code = 320;

        rabbitStartError(AmqpStub);
        conn.emit('close', lostConnection);
        await asyncReconn;

        rabbitStopError(AmqpStub);

        await waitEvent(rabbit, 'reconnecting', Math.max(15, RECONN_TIMEOUT * 1.3)); // second attempt

        let newServer = await mockRabbitServer({ logger, stub: AmqpStub, rabbit });
        conn = newServer.conn;

        logger.assert('warn', `Lost connection to RabbitMQ! Reconnecting in ${opts.reconnectionTimeout}ms...`);
        logger.assert('info', 'Reconnecting to RabbitMQ (1/5)...');
        logger.assert('info', 'Reconnecting to RabbitMQ (2/5)...');
        logger.assert('info', 'Reconnected to RabbitMQ');

        const reconnections = Math.ceil(Math.random() * 8);
        for (let i = 0; i < reconnections; ++i) {
            AmqpStub.reset();
            asyncReconn = waitEvent(rabbit, 'reconnecting', RECONN_TIMEOUT * .6); // immediate reconnection
            conn.emit('close', lostConnection);
            await asyncReconn;
            newServer = await mockRabbitServer({ logger, stub: AmqpStub, rabbit });
            conn = newServer.conn;

            logger.assert('warn', `Lost connection to RabbitMQ! Reconnecting in ${opts.reconnectionTimeout}ms...`);
            logger.assert('info', 'Reconnecting to RabbitMQ (1/5)...');
            logger.assert('info', 'Reconnected to RabbitMQ');
        }
    });

});
