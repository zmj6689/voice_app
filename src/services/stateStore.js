const crypto = require('crypto');
const config = require('../config/env');

function normalizeRoomTheme(theme) {
  if (!theme || typeof theme !== 'object') {
    return { ringColor: '#ffffff' };
  }
  const rawColor = typeof theme.ringColor === 'string' ? theme.ringColor.trim() : '';
  const ringColor = /^#[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor.toLowerCase() : '#ffffff';
  return { ringColor };
}

class StateStore {
  constructor(redis) {
    this.redis = redis;
    this.namespace = config.redisNamespace;
    this.rooms = new Map();
    this.voiceMessages = new Map();
  }

  async initialize() {
    const storedRooms = await this.redis.hgetall(this._roomHashKey());
    Object.entries(storedRooms).forEach(([id, json]) => {
      try {
        const room = JSON.parse(json);
        room.id = Number(room.id);
        room.members = Array.isArray(room.members) ? room.members : [];
        room.participants = Array.isArray(room.participants) ? room.participants : [];
        room.roomTheme = normalizeRoomTheme(room.roomTheme);
        this.rooms.set(room.id, room);
      } catch (error) {
        /* ignore malformed room payloads */
      }
    });
    const storedMessages = await this.redis.hgetall(this._voiceHashKey());
    const expiredIds = [];
    Object.entries(storedMessages).forEach(([id, json]) => {
      try {
        const message = JSON.parse(json);
        message.id = Number(message.id);
        const expiresAt = Number(message.expiresAt);
        if (expiresAt && expiresAt <= Date.now()) {
          expiredIds.push(message.id);
          return;
        }
        this.voiceMessages.set(message.id, message);
      } catch (error) {
        /* ignore malformed voice message payloads */
      }
    });
    if (expiredIds.length > 0) {
      await this.redis.hdel(this._voiceHashKey(), ...expiredIds.map(String));
    }
  }

  _roomHashKey() {
    return `${this.namespace}:rooms`;
  }

  _voiceHashKey() {
    return `${this.namespace}:voiceMessages`;
  }

  _playerSetKey() {
    return `${this.namespace}:players`;
  }

  _playerKey(id) {
    return `${this.namespace}:player:${id}`;
  }

  _sessionKey(sessionId) {
    return `${this.namespace}:session:${sessionId}`;
  }

  _creationKey(playerId) {
    return `${this.namespace}:room-creations:${playerId}`;
  }

  _voiceCreationKey(playerId) {
    return `${this.namespace}:voice-messages:${playerId}`;
  }

  _signalKey(targetId, signalId) {
    return `${this.namespace}:signal:${targetId}:${signalId}`;
  }

  async getPopulation() {
    return this.redis.scard(this._playerSetKey());
  }

  async getAllPlayers() {
    const ids = await this.redis.smembers(this._playerSetKey());
    if (!ids || ids.length === 0) {
      return [];
    }
    const pipeline = this.redis.pipeline();
    ids.forEach((id) => pipeline.hgetall(this._playerKey(id)));
    const results = await pipeline.exec();
    return results
      .map(([, data], index) => ({ data, id: Number(ids[index]) }))
      .filter((entry) => entry.data && Object.keys(entry.data).length > 0)
      .map((entry) => ({
        id: entry.id,
        x: Number(entry.data.x) || 0,
        y: Number(entry.data.y) || 0,
        roomId: entry.data.roomId ? Number(entry.data.roomId) : null,
        networkKey: entry.data.networkKey || 'unknown',
        sessionId: entry.data.sessionId || '',
        name: entry.data.name || '',
      }));
  }

  async allocateClientId(preferredId = null) {
    const key = `${this.namespace}:nextClientId`;
    if (preferredId && Number.isFinite(preferredId)) {
      const currentRaw = await this.redis.get(key);
      const current = Number(currentRaw) || 0;
      if (preferredId > current) {
        await this.redis.set(key, preferredId);
      }
      return preferredId;
    }
    return this.redis.incr(key);
  }

  async saveSession(sessionId, data) {
    if (!sessionId) {
      return;
    }
    await this.redis.set(
      this._sessionKey(sessionId),
      JSON.stringify(data),
      'EX',
      config.sessionTtlSeconds
    );
  }

  async consumeSession(sessionId) {
    if (!sessionId) {
      return null;
    }
    const key = this._sessionKey(sessionId);
    const raw = await this.redis.get(key);
    if (!raw) {
      return null;
    }
    await this.redis.del(key);
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  async persistPlayer(player) {
    const key = this._playerKey(player.id);
    await this.redis.hset(key, {
      id: player.id,
      x: player.x,
      y: player.y,
      roomId: player.roomId ?? '',
      networkKey: player.networkKey || 'unknown',
      sessionId: player.sessionId || '',
      serverId: player.serverId || '',
      name: player.name || '',
    });
    await this.redis.sadd(this._playerSetKey(), player.id);
  }

  async savePlayerPositions(batch) {
    if (!batch || batch.length === 0) {
      return;
    }
    const pipeline = this.redis.pipeline();
    batch.forEach((update) => {
      pipeline.hset(this._playerKey(update.id), {
        x: update.x,
        y: update.y,
      });
    });
    await pipeline.exec();
  }

  async removePlayer(playerId) {
    await this.redis.srem(this._playerSetKey(), playerId);
    await this.redis.del(this._playerKey(playerId));
  }

  getRooms() {
    return Array.from(this.rooms.values());
  }

  getRoom(id) {
    return this.rooms.get(id) || null;
  }

  getVoiceMessages() {
    const now = Date.now();
    return Array.from(this.voiceMessages.values()).filter(
      (message) => !message.expiresAt || message.expiresAt > now
    );
  }

  async createRoom(data) {
    const id = await this.redis.incr(`${this.namespace}:nextRoomId`);
    const room = {
      ...data,
      id,
      members: Array.isArray(data.members) ? data.members : [],
      createdAt: Date.now(),
      roles: Array.isArray(data.roles) ? data.roles : [],
      participants: Array.isArray(data.participants) ? data.participants : [],
      roomTheme: normalizeRoomTheme(data.roomTheme),
    };
    this.rooms.set(room.id, room);
    await this.redis.hset(this._roomHashKey(), room.id, JSON.stringify(room));
    return room;
  }

  async updateRoom(room) {
    room.roomTheme = normalizeRoomTheme(room.roomTheme);
    this.rooms.set(room.id, room);
    await this.redis.hset(this._roomHashKey(), room.id, JSON.stringify(room));
    return room;
  }

  async removeRoom(roomId) {
    this.rooms.delete(roomId);
    await this.redis.hdel(this._roomHashKey(), roomId);
  }

  async createVoiceMessage(data) {
    const id = await this.redis.incr(`${this.namespace}:nextVoiceMessageId`);
    const createdAt = Date.now();
    const message = {
      ...data,
      id,
      createdAt,
      expiresAt: createdAt + config.voiceMessageTtlMs,
    };
    this.voiceMessages.set(message.id, message);
    await this.redis.hset(this._voiceHashKey(), message.id, JSON.stringify(message));
    return message;
  }

  async removeVoiceMessage(messageId) {
    this.voiceMessages.delete(messageId);
    const removed = await this.redis.hdel(this._voiceHashKey(), messageId);
    return removed > 0;
  }

  async applyRemoteVoiceMessage(message) {
    if (!message || typeof message.id !== 'number') {
      return;
    }
    this.voiceMessages.set(message.id, message);
    await this.redis.hset(this._voiceHashKey(), message.id, JSON.stringify(message));
  }

  async addRoomMember(roomId, memberId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }
    if (!room.members.includes(memberId)) {
      room.members.push(memberId);
      await this.updateRoom(room);
    }
    return room;
  }

  async addRoomParticipant(roomId, participant) {
    const room = this.rooms.get(roomId);
    if (!room || !participant) {
      return null;
    }
    room.participants = Array.isArray(room.participants) ? room.participants : [];
    const existingIndex = room.participants.findIndex((item) => item.id === participant.id);
    if (existingIndex >= 0) {
      room.participants[existingIndex] = { ...room.participants[existingIndex], ...participant };
    } else {
      room.participants.push(participant);
    }
    await this.updateRoom(room);
    return room;
  }

  async removeRoomMember(roomId, memberId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }
    room.members = room.members.filter((member) => member !== memberId);
    await this.updateRoom(room);
    return room;
  }

  async removeRoomParticipant(roomId, memberId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }
    room.participants = Array.isArray(room.participants) ? room.participants : [];
    room.participants = room.participants.filter((participant) => participant.id !== memberId);
    await this.updateRoom(room);
    return room;
  }

  async applyRemoteRoom(room) {
    if (!room || typeof room.id !== 'number') {
      return;
    }
    room.members = Array.isArray(room.members) ? room.members : [];
    room.roles = Array.isArray(room.roles) ? room.roles : [];
    room.participants = Array.isArray(room.participants) ? room.participants : [];
    room.roomTheme = normalizeRoomTheme(room.roomTheme);
    this.rooms.set(room.id, room);
    await this.redis.hset(this._roomHashKey(), room.id, JSON.stringify(room));
  }

  async registerRoomCreation(playerId) {
    const key = this._creationKey(playerId);
    const now = Date.now();
    await this.redis.zadd(key, now, String(now));
    await this.redis.zremrangebyscore(key, 0, now - config.roomCreationWindowMs);
    await this.redis.pexpire(key, config.roomCreationWindowMs);
    return this.redis.zcard(key);
  }

  async registerVoiceMessageCreation(playerId) {
    const key = this._voiceCreationKey(playerId);
    const now = Date.now();
    await this.redis.zadd(key, now, String(now));
    await this.redis.zremrangebyscore(key, 0, now - config.voiceMessageWindowMs);
    await this.redis.pexpire(key, config.voiceMessageWindowMs);
    return this.redis.zcard(key);
  }

  async pruneVoiceMessages() {
    const now = Date.now();
    const expiredIds = [];
    this.voiceMessages.forEach((message) => {
      if (message.expiresAt && message.expiresAt <= now) {
        expiredIds.push(message.id);
      }
    });
    if (expiredIds.length === 0) {
      return [];
    }
    await this.redis.hdel(this._voiceHashKey(), ...expiredIds.map(String));
    expiredIds.forEach((id) => this.voiceMessages.delete(id));
    return expiredIds;
  }

  async saveSignal(targetId, payload) {
    const signalId = crypto.randomUUID();
    const key = this._signalKey(targetId, signalId);
    await this.redis.set(key, JSON.stringify(payload), 'EX', 120);
    return signalId;
  }

  async consumeSignal(targetId, signalId) {
    const key = this._signalKey(targetId, signalId);
    const raw = await this.redis.get(key);
    if (!raw) {
      return null;
    }
    await this.redis.del(key);
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }
}

function createStateStore(redis) {
  return new StateStore(redis);
}

module.exports = { createStateStore };
