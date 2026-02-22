
const { bootstrap } = require('./src/server');

bootstrap().catch((error) => {
  console.error('Failed to start voice server', error);
  process.exit(1);
});
