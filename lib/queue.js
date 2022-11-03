'use strict';

const Extend = require('lodash.assignin');
const EventEmitter = require('events').EventEmitter;

const DEFAULT_QUEUE_OPTIONS = {
    exclusive: false,
    durable: true,
    prefetch: 1,              // can be set on the queue because we use a per-queue channel
    messageTtl: undefined,
    maxLength: undefined
};

const DEFAULT_CONSUME_OPTIONS = {
    consumerTag: undefined,
    noAck: false,
    exclusive: false,
    priority: undefined
};

const queue = (options) => {

    const consumers = [];

    const connect = (connection) => {

        connection.createChannel(onChannel);
    };

    const consume = (callback, consumeOptions) => {

        const onMessage = (msg) => {

            const data = parseMessage(msg);

            const ack = (reply) => {

                const replyTo = msg.properties.replyTo;
                const id = msg.properties.correlationId;
                if (replyTo && id) {
                    const buffer = encodeMessage(reply, msg.properties.contentType);
                    channel.publish('', replyTo, buffer, {
                        correlationId: id,
                        contentType: msg.properties.contentType
                    });
                }

                channel.ack(msg);
            };

            const nack = (opts) => {

                opts = opts || {};
                opts.allUpTo = opts.allUpTo !== undefined ? opts.allUpTo : false;
                opts.requeue = opts.requeue !== undefined ? opts.requeue : true;
                channel.nack(msg, opts.allUpTo, opts.requeue);
            };

            callback(data, ack, nack, msg);
        };

        if ( ready ){

            const opts = Extend({}, DEFAULT_CONSUME_OPTIONS, consumeOptions);
            channel.consume(emitter.amqLabel, onMessage, opts, onConsume);
            consumers.push({ onMessage, opts });
            return;
        }

        const opts = Extend({}, DEFAULT_CONSUME_OPTIONS, consumeOptions);
        consumers.push({ onMessage, opts });
    };

    const cancel = (done) => {

        if (!consumerTag) {
            return;
        }

        if (!channel) {
            return;
        }

        channel.cancel(consumerTag, done);
    };

    const purge = (done) => {

        const onPurged = (err, obj) => {

            if (err) {
                return done(err);
            }

            done(undefined, obj.messageCount);
        };

        if (channel) {
            channel.purgeQueue(emitter.amqLabel, onPurged);
        }
        else {
            emitter.once('ready', () => {

                channel.purgeQueue(emitter.amqLabel, onPurged);
            });
        }
    };

    const encodeMessage = (message, contentType) => {

        if (contentType === 'application/json') {
            return Buffer.from(JSON.stringify(message));
        }

        return Buffer.from(message.toString());
    };

    const parseMessage = (msg) => {

        msg = msg || {};

        if (msg.properties && msg.properties.contentType === 'application/json') {
            try {
                return JSON.parse(msg.content.toString());
            }
            catch (e) {
                emitter.emit('error', new Error('unable to parse message as JSON'));
                return;
            }
        }

        return msg.content;
    };

    const onConsume = (err, info) => {

        if (err) {
            return bail(err);
        }

        consumerTag = info.consumerTag; // required to stop consuming
        emitter.emit('consuming');
    };

    const bail = (err) => {
    // TODO: close the channel if still open
        channel = undefined;
        emitter.amqLabel = undefined;
        consumerTag = undefined;
        emitter.emit('close', err);
    };

    const onChannel = (err, chan) => {

        if (err) {
            return bail(err);
        }

        channel = chan;
        channel.prefetch(emitter.options.prefetch);
        channel.once('close', bail.bind(this, new Error('channel closed')));
        emitter.emit('connected');
        channel.assertQueue(emitter.name, emitter.options, onQueue);

        emitter.once('ready', () => {

            consumers.forEach((consumer) => channel.consume(emitter.amqLabel, consumer.onMessage, consumer.opts, onConsume));
        });
    };

    const onQueue = (err, info) => {

        if (err) {
            return bail(err);
        }

        emitter.amqLabel = info.queue;
        ready = true;
        emitter.emit('ready');
    };

    options = options || {};
    let channel; let consumerTag; let ready;
    const emitter = Extend(new EventEmitter(), {
        name: options.name,
        amqLabel: undefined, // Holds the current connection's name
        options: Extend({}, DEFAULT_QUEUE_OPTIONS, options),
        connect,
        consume,
        cancel,
        purge
    });

    return emitter;
};

module.exports = queue;
