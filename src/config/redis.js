const Redis = require('ioredis');
const config = require('./env');

function createRedisClients() {
  const baseOptions = config.redisUrl;
  const store = new Redis(baseOptions);
  const publisher = new Redis(baseOptions);
  const subscriber = new Redis(baseOptions);
  return { store, publisher, subscriber };
}

module.exports = { createRedisClients };
