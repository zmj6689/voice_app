const config = require('./env');

function buildIceServers(options = {}) {
  const servers = [];
  if (Array.isArray(config.stunServers) && config.stunServers.length > 0) {
    config.stunServers.forEach((url) => {
      servers.push({ urls: url });
    });
  } else {
    servers.push({ urls: 'stun:stun.l.google.com:19302' });
  }

  const resolvedTurnHost = config.turnHost || options.host || '';
  if (resolvedTurnHost) {
    const urls = [];
    const normalizedHost = resolvedTurnHost.startsWith('turn:')
      ? resolvedTurnHost.replace(/^turns?:/, '')
      : resolvedTurnHost;
    const protocols = ['turn'];
    if (options.preferTurns || config.turnHost?.startsWith('turns:')) {
      protocols.push('turns');
    }
    protocols.forEach((protocol) => {
      const baseHost = `${protocol}:${normalizedHost}`;
      urls.push(
        config.turnPort ? `${baseHost}:${config.turnPort}` : baseHost
      );
    });
    urls.forEach((url) => {
      const entry = { urls: url };
      if (config.turnUsername) {
        entry.username = config.turnUsername;
      }
      if (config.turnPassword) {
        entry.credential = config.turnPassword;
      }
      servers.push(entry);
    });
  }

  return servers;
}

module.exports = { buildIceServers };
