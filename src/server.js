const path = require('path');
const http = require('http');
const express = require('express');
const crypto = require('crypto');
const config = require('./config/env');
const { buildIceServers } = require('./config/ice');
const { createRedisClients } = require('./config/redis');
const { createStateStore } = require('./services/stateStore');
const { createPositionQueue } = require('./services/positionQueue');
const { registerWebSocketServer } = require('./ws/connection');
const { getPrismaClient } = require('./db/client');
const { registerAuthRoutes } = require('./http/auth');
const { createCorsMiddleware } = require('./http/cors');

async function bootstrap() {
  const app = express();
  const server = http.createServer(app);
  const staticDir = path.resolve(__dirname, '..');

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use(createCorsMiddleware());

  registerAuthRoutes(app);

  app.use(express.static(staticDir));

  app.get('/config/ice', (req, res) => {
    const hostHeader = req.headers.host || '';
    const host = hostHeader.split(':')[0];
    res.json({ iceServers: buildIceServers({ host }) });
  });

  const redisClients = createRedisClients();
  const stateStore = createStateStore(redisClients.store);
  await stateStore.initialize();

  const serverId = process.env.SERVER_ID || crypto.randomUUID();

  const positionQueue = createPositionQueue({
    stateStore,
    publisher: redisClients.publisher,
    channel: config.redisWorldChannel,
    serverId,
  });

  registerWebSocketServer({
    server,
    stateStore,
    publisher: redisClients.publisher,
    subscriber: redisClients.subscriber,
    positionQueue,
    serverId,
  });

  try {
    await getPrismaClient().$connect();
    console.log('Prisma client connected to PostgreSQL');
  } catch (error) {
    console.warn('Prisma connection failed (continuing without DB):', error.message);
  }

  server.listen(config.port, () => {
    console.log(
      `Voice server listening on http://localhost:${config.port} (ws and redis ready)`
    );
  });
}

module.exports = { bootstrap };

if (require.main === module) {
  bootstrap().catch((error) => {
    console.error('Failed to bootstrap server', error);
    process.exit(1);
  });
}
