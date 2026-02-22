function normalizeIp(address) {
  if (!address) {
    return null;
  }
  let normalized = address.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.substring(7);
  }
  if (normalized === '::1') {
    return '127.0.0.1';
  }
  return normalized;
}

function deriveNetworkKey(ipAddress) {
  if (!ipAddress) {
    return 'unknown';
  }
  if (ipAddress.includes(':')) {
    const segments = ipAddress.split(':').filter((segment) => segment.length > 0);
    return segments.slice(0, 3).join(':') || ipAddress;
  }
  const parts = ipAddress.split('.');
  if (parts.length >= 3) {
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }
  return ipAddress;
}

function extractClientNetworkInfo(request) {
  let candidate = null;
  if (request && request.headers) {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded && typeof forwarded === 'string') {
      const firstForwarded = forwarded.split(',')[0];
      const forwardedIp = normalizeIp(firstForwarded);
      if (forwardedIp) {
        candidate = forwardedIp;
      }
    }
  }
  if (!candidate && request && request.socket && request.socket.remoteAddress) {
    candidate = normalizeIp(request.socket.remoteAddress);
  }
  const ipAddress = candidate;
  const networkKey = deriveNetworkKey(ipAddress);
  return { ipAddress, networkKey };
}

module.exports = {
  normalizeIp,
  deriveNetworkKey,
  extractClientNetworkInfo,
};
