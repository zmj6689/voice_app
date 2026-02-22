const WebSocket = require('ws');
const crypto = require('crypto');
const config = require('../config/env');
const { createHandlers } = require('./handlers');

function registerWebSocketServer({
  server,
  stateStore,
  publisher,
  subscriber,
  positionQueue,
  serverId,
}) {
  const wss = new WebSocket.Server({ server });
  const clients = new Map();
  const context = {
    stateStore,
    publisher,
    positionQueue,
    redisChannels: {
      world: config.redisWorldChannel,
      signal: config.redisSignalChannel,
    },
    clients,
    serverId: serverId || process.env.SERVER_ID || crypto.randomUUID(),
  };

  const { handleConnection, broadcastFromRedis, handleSignalDelivery } =
    createHandlers(context);

  subscriber.subscribe(
    config.redisWorldChannel,
    config.redisSignalChannel,
    (error) => {
      if (error) {
        console.error('Failed to subscribe to Redis channels', error);
      }
    }
  );

  subscriber.on('message', (channel, raw) => {
    if (channel === config.redisWorldChannel) {
      broadcastFromRedis(raw).catch((error) => {
        console.error('Failed to process world event', error);
      });
    } else if (channel === config.redisSignalChannel) {
      handleSignalDelivery(raw).catch((error) => {
        console.error('Failed to deliver signal', error);
      });
    }
  });

  wss.on('connection', (ws, request) => {
    handleConnection(ws, request).catch((error) => {
      console.error('Failed to handle connection', error);
      try {
        ws.close(1011, 'Unexpected server error');
      } catch (closeError) {
        console.error('Failed to close socket after error', closeError);
      }
    });
  });

  return { wss, clients };
}

module.exports = { registerWebSocketServer };
