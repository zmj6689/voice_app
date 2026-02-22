const path = require('path');
const dotenv = require('dotenv');

const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const listFromEnv = (value) => {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
};

const config = {
  port: parseNumber(process.env.PORT, 3000),
  maxClients: parseNumber(process.env.MAX_CLIENTS, 100),
  maxRoomCapacity: parseNumber(process.env.MAX_ROOM_CAPACITY, 100),
  callRoomBaseRadius: parseNumber(process.env.CALL_ROOM_BASE_RADIUS, 180),
  callRoomGrowthRatio: parseNumber(process.env.CALL_ROOM_GROWTH_RATIO, 0.45),
  roomCreationLimit: parseNumber(process.env.ROOM_CREATION_LIMIT, 3),
  roomCreationWindowMs: parseNumber(
    process.env.ROOM_CREATION_WINDOW_MS,
    60 * 1000
  ),
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  redisNamespace: process.env.REDIS_NAMESPACE || 'voiceapp',
  redisWorldChannel:
    process.env.REDIS_WORLD_CHANNEL || 'voiceapp:world-events',
  redisSignalChannel:
    process.env.REDIS_SIGNAL_CHANNEL || 'voiceapp:signal-events',
  stunServers: listFromEnv(process.env.STUN_SERVERS),
  turnHost: process.env.TURN_HOST || '',
  turnPort: parseNumber(process.env.TURN_PORT, 3478),
  turnUsername: process.env.TURN_USERNAME || 'voiceapp',
  turnPassword: process.env.TURN_PASSWORD || 'voiceapp',
  spawnDistanceBase: parseNumber(process.env.SPAWN_DISTANCE_BASE, 280),
  spawnDistanceVariance: parseNumber(
    process.env.SPAWN_DISTANCE_VARIANCE,
    180
  ),
  roomPasswordMinLength: parseNumber(process.env.ROOM_PASSWORD_MIN_LENGTH, 4),
  roomNameMinLength: parseNumber(process.env.ROOM_NAME_MIN_LENGTH, 2),
  roomNameMaxLength: parseNumber(process.env.ROOM_NAME_MAX_LENGTH, 40),
  roomRoleMax: parseNumber(process.env.ROOM_ROLE_MAX, 8),
  roomRoleNameMaxLength: parseNumber(
    process.env.ROOM_ROLE_NAME_MAX_LENGTH,
    30
  ),
  voiceMessageTtlMs: parseNumber(
    process.env.VOICE_MESSAGE_TTL_MS,
    24 * 60 * 60 * 1000
  ),
  voiceMessageRadius: parseNumber(process.env.VOICE_MESSAGE_RADIUS, 70),
  voiceMessageDailyLimit: parseNumber(process.env.VOICE_MESSAGE_DAILY_LIMIT, 3),
  voiceMessageWindowMs: parseNumber(
    process.env.VOICE_MESSAGE_WINDOW_MS,
    24 * 60 * 60 * 1000
  ),
  voiceMessageMaxBytes: parseNumber(process.env.VOICE_MESSAGE_MAX_BYTES, 650000),
  sessionTtlSeconds: parseNumber(process.env.SESSION_TTL_SECONDS, 60 * 60 * 6),
  corsOrigins: listFromEnv(process.env.CORS_ORIGINS || '*'),
  corsAllowedHeaders:
    process.env.CORS_ALLOWED_HEADERS || 'Content-Type, Authorization, X-Requested-With',
  corsAllowDevOrigins: parseBoolean(process.env.CORS_ALLOW_DEV_ORIGINS, true),
};

module.exports = config;
