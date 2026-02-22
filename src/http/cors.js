const { URL } = require('url');
const config = require('../config/env');

const DEV_HOSTS = new Set(['localhost', '127.0.0.1']);

function parseEntry(entry) {
  if (!entry) {
    return null;
  }
  const trimmed = entry.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === '*') {
    return { type: 'wildcard' };
  }
  if (trimmed.includes('://')) {
    try {
      const url = new URL(trimmed);
      return { type: 'origin', value: `${url.protocol}//${url.host}` };
    } catch (error) {
      return null;
    }
  }
  const lowered = trimmed.toLowerCase();
  if (lowered.includes(':')) {
    const [host, port] = lowered.split(':');
    if (host && port) {
      return { type: 'hostPort', host, port };
    }
  }
  return { type: 'host', host: lowered };
}

const parsed = config.corsOrigins.map(parseEntry).filter(Boolean);
const allowAny = parsed.some((entry) => entry.type === 'wildcard');
const exactOrigins = new Set();
const hostEntries = new Set();
const hostPortEntries = new Set();

parsed.forEach((entry) => {
  if (entry.type === 'origin') {
    exactOrigins.add(entry.value);
  } else if (entry.type === 'host') {
    hostEntries.add(entry.host);
  } else if (entry.type === 'hostPort') {
    hostPortEntries.add(`${entry.host}:${entry.port}`);
  }
});

function normalizeOrigin(origin) {
  try {
    const url = new URL(origin);
    const normalized = `${url.protocol}//${url.host}`;
    const hostname = url.hostname.toLowerCase();
    let port = url.port;
    if (!port) {
      port = url.protocol === 'https:' ? '443' : '80';
    }
    return { normalized, hostname, port };
  } catch (error) {
    return null;
  }
}

function resolveAllowedOrigin(originHeader) {
  if (!originHeader) {
    if (allowAny) {
      return '*';
    }
    return null;
  }
  const parsedOrigin = normalizeOrigin(originHeader);
  if (!parsedOrigin) {
    return null;
  }
  if (allowAny) {
    return parsedOrigin.normalized;
  }
  if (exactOrigins.has(parsedOrigin.normalized)) {
    return parsedOrigin.normalized;
  }
  const hostPortKey = `${parsedOrigin.hostname}:${parsedOrigin.port}`;
  if (hostPortEntries.has(hostPortKey)) {
    return parsedOrigin.normalized;
  }
  if (hostEntries.has(parsedOrigin.hostname)) {
    return parsedOrigin.normalized;
  }
  if (config.corsAllowDevOrigins && DEV_HOSTS.has(parsedOrigin.hostname)) {
    return parsedOrigin.normalized;
  }
  return null;
}

function createCorsMiddleware() {
  const allowedHeaders = config.corsAllowedHeaders;
  return function corsMiddleware(req, res, next) {
    const originHeader = req.headers.origin;
    const allowedOrigin = resolveAllowedOrigin(originHeader);
    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', allowedHeaders);
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') {
      if (!allowedOrigin && originHeader) {
        return res.status(403).send('CORS origin denied');
      }
      return res.sendStatus(204);
    }
    if (!allowedOrigin && originHeader) {
      return res
        .status(403)
        .json({ error: '이 출처에서는 해당 API를 호출할 수 없습니다.' });
    }
    return next();
  };
}

module.exports = { createCorsMiddleware };
