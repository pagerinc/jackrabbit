'use strict';

const Amqp = require('amqplib/callback_api');
const Extend = require('lodash.assignin');
const EventEmitter = require('events').EventEmitter;
const Exchange = require('./exchange');

const jackrabbit = (url, logger, options = {}) => {

    if (!url) {
        throw new Error('url required for jackrabbit connection');
    }

    options.reconnectionTimeout = options.reconnectionTimeout || +process.env.RABBIT_RECONNECTION_TIMEOUT || 2000;
    options.maxRetries = options.maxRetries || +process.env.RABBIT_RECONNECTION_RETRIES || 20;
    options.connectionName = options.connectionName || +process.env.RABBIT_CONNECTION_NAME || 'jackrabbit';

    if (process.env.RABBIT_RECONNECTION_EXACT_TIMEOUT !== 'true') {
        options.reconnectionTimeout = Math.floor(options.reconnectionTimeout * (1 + Math.random() * 0.1));
    }

    // state
    let connection;
    let connectionAttempts = 0;
    const exchanges = [];
    const pendingExchangesForConnection = [];

    // public

    const getInternals = () => {

        return {
            amqp: Amqp,
            connection
        };
    };

    const isConnectionReady = () => {

        return Boolean(connection?.connection?.stream?.writable);
    };

    const close = (callback) => {

        if (!connection) {
            if (callback) {
                callback();
            }

            return;
        }

        try {
            // I don't think amqplib should be throwing here, as this is an async const
            // TODO: figure out how to test whether or not amqplib will throw
            // (eg, how do they determine if closing is an illegal operation?)
            connection.close((err) => {

                if (callback) {
                    callback(err);
                }

                rabbit.emit('close');
            });
        }
        catch (e) {
            if (callback) {
                callback(e);
            }
        }
    };

    const createDefaultExchange = () => {

        return createExchange()('direct', '', { noReply: false });
    };

    const createExchange = () => {

        return (type, name, exchangeOptions) => {

            const newExchange = Exchange(name, type, exchangeOptions);
            exchanges.push(newExchange);
            if (connection) {
                connection.setMaxListeners(exchanges.length + 10);
                newExchange.connect(connection);
            }
            else {
                pendingExchangesForConnection.push(newExchange);
            }

            return newExchange;
        };
    };

    // private

    const bail = (err) => {

        // TODO close any connections or channels that remain open
        connection = undefined;
        if (err && !tryReconnect(err)) {
            rabbit.emit('error', err);
            doLog('fatal', 'Rabbit connection error!');
            process.exit(1);
        }
    };

    const isReconnectionError = (err) => {

        return err.code === 320 || err.message === 'Socket closed abruptly during opening handshake' || err.message.includes('ECONN');
    };

    const doLog = (level, message) => {

        if (typeof logger?.[level] === 'function') {
            logger[level](message);
        }
        else if (typeof logger?.log === 'function') {
            logger.log(level, message);
        }
        else {
            rabbit.emit(level, message);
        }
    };

    const tryReconnect = (err) => {

        if (!isReconnectionError(err)) {
            return false;
        }

        if (connectionAttempts >= options.maxRetries) {
            err.meta = 'Error connecting to RabbitMQ';
            return false;
        }

        const doReconnect = () => {

            ++connectionAttempts;
            rabbit.emit('reconnecting');
            doLog('info', `Reconnecting to RabbitMQ (${connectionAttempts}/${options.maxRetries})...`);
            Amqp.connect(url, { clientProperties: { connection_name: options.connectionName } }, onConnection);
        };

        if (connectionAttempts === 0) {

            doLog('warn', `Lost connection to RabbitMQ! Reconnecting in ${options.reconnectionTimeout}ms...`);
            doReconnect();
        }
        else {
            setTimeout(doReconnect, options.reconnectionTimeout);
        }

        return true;
    };

    const onConnection = (err, conn) => {

        if (err) {
            return bail(err);
        }

        connection = conn;
        connection.setMaxListeners(exchanges.length + 10);
        connection.once('close', bail.bind(this));
        connection.on('blocked', (cause) => rabbit.emit('blocked', cause));
        connection.on('unblocked', () => rabbit.emit('unblocked'));

        const notifyReady = () => {

            rabbit.emit(connectionAttempts > 0 ? 'reconnected' : 'connected');

            if (connectionAttempts > 0) {
                doLog('info', 'Reconnected to RabbitMQ');
                connectionAttempts = 0;
            }
        };

        const pendingExchanges = connectionAttempts > 0 ? exchanges : pendingExchangesForConnection;
        if (pendingExchanges.length === 0) {
            notifyReady();
        }
        else {
            let readyCount = 0;
            pendingExchanges.forEach((exchange) => {

                exchange.connect(connection);
                exchange.once('ready', () => {

                    ++readyCount;
                    if (readyCount === pendingExchanges.length) {
                        notifyReady();
                    }
                });
            });
        }

    };

    const rabbit = Extend(new EventEmitter(), {
        default: createDefaultExchange,
        direct: createExchange().bind(null, 'direct'),
        fanout: createExchange().bind(null, 'fanout'),
        topic: createExchange().bind(null, 'topic'),
        exchange: createExchange(),
        close,
        getInternals,
        isConnectionReady
    });

    Amqp.connect(url, { clientProperties: { connection_name: options.connectionName } }, onConnection);
    return rabbit;
};

module.exports = jackrabbit;
