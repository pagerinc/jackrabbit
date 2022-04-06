'use strict';

const Assert = require('chai').assert;
const Jackrabbit = require('../lib/jackrabbit');
const Sinon = require('sinon');
const EventEmitter = require('events');

const { after, beforeEach, describe, it } = require('mocha');

const AMQP_PORT = 8080;

describe('reconnection', () => {

    const RECONN_TIMEOUT = 4;
    const RECONN_RETRIES = 5;
    const STUB_RABBIT_URL = `amqp://localhost:${AMQP_PORT}`;

    let AmqpStub;
    const Amqp = require('amqplib/callback_api');

    beforeEach((done) => {

        Sinon.verifyAndRestore();
        Sinon.stub(process, 'exit');
        AmqpStub = Sinon.stub(Amqp, 'connect');

        process.env.RABBIT_RECONNECTION_TIMEOUT = RECONN_TIMEOUT;
        process.env.RABBIT_RECONNECTION_RETRIES = RECONN_RETRIES;

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

    const mockRabbitServer = async ({ logger, stub, rabbit, exchangeCount = 0, queueCount = 0, consumerCount = queueCount, uniqueKeys = queueCount }) => {

        if (!stub) {
            stub = Sinon.stub(Amqp, 'connect');
        }

        const reconnecting = rabbit !== undefined;
        let opts = undefined;
        if (!rabbit) {
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
        stub.args[0][1](null, conn);
        await onConnect;

        verifyConnection(conn);

        return { conn, rabbit, opts };
    };

    const rabbitStartError = (amqpStub) => {

        amqpStub.callsFake((url, cb) =>

            setTimeout(() => {

                const closedSocketError = new Error('Socket closed abruptly during opening handshake');
                cb(closedSocketError, null);
            }, 1));
    };

    const rabbitStopError = (amqpStub) => amqpStub.reset();

    it('Healthy connections should be unafected', () => {

    });

    it('Should trigger when connection is lost', () => {

    });

    it('Should read retry env vars', () => {

    });

    it('Should default to inexact reconnection time', () => {

    });

    it('Should have a random reconnection overhead of up to 10% when on inexact mode', () => {

    });

    it('Should retry immediately after disconnecting', () => {

    });

    it('Should exit after exhausting reconnection attempts', () => {

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

    it('Should be able to publish and consume after reconnecting', () => {

    });

    it('Should be able to reconnect multiple times', () => {

    });

});
