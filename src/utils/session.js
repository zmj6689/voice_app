function extractSessionId(request) {
  if (!request || typeof request.url !== 'string') {
    return null;
  }
  try {
    const originHost = request.headers && request.headers.host ? request.headers.host : 'localhost';
    const parsedUrl = new URL(request.url, `http://${originHost}`);
    const value = parsedUrl.searchParams.get('sessionId');
    if (value && value.trim()) {
      return value.trim();
    }
  } catch (error) {
    return null;
  }
  return null;
}

module.exports = { extractSessionId };
