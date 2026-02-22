const config = require('../config/env');

function sanitizeDisplayName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, config.roomNameMaxLength);
}

function sanitizeRoomName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, config.roomNameMaxLength);
}

function sanitizeRoomRoles(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const sanitized = [];
  const seen = new Set();
  value.forEach((entry) => {
    const rawName =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry.name === 'string'
        ? entry.name
        : '';
    let normalized = rawName.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return;
    }
    normalized = normalized.slice(0, config.roomRoleNameMaxLength);
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    sanitized.push(normalized);
    if (sanitized.length >= config.roomRoleMax) {
      return;
    }
  });
  return sanitized;
}

module.exports = {
  sanitizeDisplayName,
  sanitizeRoomName,
  sanitizeRoomRoles,
};
