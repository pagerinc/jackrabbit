# Jackrabbit

This is a fork of [hunterloftis/jackrabbit].

[![CircleCI](https://circleci.com/gh/pagerinc/jackrabbit.svg?style=svg)](https://circleci.com/gh/pagerinc/jackrabbit)

Jackrabbit is a very opinionated abstraction built on top of `amqplib` focused
on usability and implementing several messaging patterns on RabbitMQ.

## Simple Example

```js
// producer.js
'use strict';

const jackrabbit = require('@pager/jackrabbit');
const rabbit = jackrabbit(process.env.RABBIT_URL);

rabbit
  .default()
  .publish('Hello World!', { key: 'hello' })
  .on('drain', rabbit.close);
```

```js
// consumer.js
'use strict';

const jackrabbit = require('@pager/jackrabbit');
const rabbit = jackrabbit(process.env.RABBIT_URL);

rabbit
  .default()
  .queue({ name: 'hello' })
  .consume(onMessage, { noAck: true });

function onMessage(data) {
  console.log('received:', data);
}
```

## Ack/Nack Consumer Example

```js
'use strict';

const jackrabbit = require('@pager/jackrabbit');
const rabbit = jackrabbit(process.env.RABBIT_URL);

rabbit
  .default()
  .queue({ name: 'important_job' })
  .consume(function(data, ack, nack, msg) {
    // process data...
    // and ACK on success
    ack();
    // or alternatively NACK on failure
    nack();
  })
```

## More Examples

For now, the best usage help is can be found in [examples](https://github.com/pagerinc/jackrabbit/tree/master/examples),
which map 1-to-1 with the official RabbitMQ tutorials.

## Installation

```
npm install --save @pager/jackrabbit
```

## Tests

The tests are set up with Docker + Docker-Compose,
so you don't need to install rabbitmq (or even node)
to run them:

```
$ docker-compose up
```

[hunterloftis/jackrabbit]: https://github.com/hunterloftis/jackrabbit

## Reconnection
> Jackrabbit is a wrapper for [ampqlib](https://github.com/amqp-node/amqplib), ampqlib does NOT support reconnection.

This project will try to recover a lost connection gracefully, if it fails to do so, we will throw an `error` event and then exit the current process with code `1`.

Our approach to reconnection is recording all the exchanges and queues created through jackrabbit. Once a connection is lost, we will try to create a new one, update the existing exchange and queue references, initialize a new channel for each queue, and bind each queue's consumers to their new channel. This should be transparent to any users of this lib.

You can configure some basic parameters of the reconnection process with some env vars:

Name|Default|Description
-|-|-
`RABBIT_RECONNECTION_TIMEOUT`| 2000 | ms between each reconnection attempt. The first attempt will always be immediate.
`RABBIT_RECONNECTION_RETRIES`| 20 | Amount of retries before erroring out and killing the node process.
`RABBIT_RECONNECTION_EXACT_TIMEOUT` | false | To prevent total outages on HA services, we're adding a random overhead of 0-10% to the reconnection timeout by default. You can disable this behaviour by setting this option to `true`.
