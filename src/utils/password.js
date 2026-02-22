const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);

function hashRoomPassword(password) {
  return crypto.createHash('sha256').update(password, 'utf8').digest('hex');
}

function verifyRoomPassword(hash, password) {
  if (!hash) {
    return false;
  }
  return hash === hashRoomPassword(password);
}

async function hashUserPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password is required');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64);
  return `${salt}:${Buffer.from(derived).toString('hex')}`;
}

async function verifyUserPassword(hash, password) {
  if (!hash || typeof password !== 'string') {
    return false;
  }
  const [salt, stored] = hash.split(':');
  if (!salt || !stored) {
    return false;
  }
  const derived = await scryptAsync(password, salt, 64);
  const storedBuffer = Buffer.from(stored, 'hex');
  if (storedBuffer.length !== derived.length) {
    return false;
  }
  return crypto.timingSafeEqual(storedBuffer, derived);
}

module.exports = {
  hashRoomPassword,
  verifyRoomPassword,
  hashUserPassword,
  verifyUserPassword,
};
