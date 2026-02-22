const WebSocket = require('ws');
const crypto = require('crypto');
const config = require('../config/env');
const { extractClientNetworkInfo } = require('../utils/network');
const { extractSessionId } = require('../utils/session');
const { findSpawnPosition } = require('../utils/spawn');
const {
  sanitizeDisplayName,
  sanitizeRoomName,
  sanitizeRoomRoles,
} = require('../utils/sanitize');
const { hashRoomPassword, verifyRoomPassword } = require('../utils/password');

const DEFAULT_ROOM_THEME = Object.freeze({ ringColor: '#ffffff' });

function calculateRoomRadius(capacity, memberCount) {
  const safeCapacity = Math.max(1, Number.isFinite(capacity) ? capacity : 1);
  const occupants = Math.min(
    safeCapacity,
    Math.max(0, Number.isFinite(memberCount) ? memberCount : 0)
  );
  const occupancyRatio = occupants / safeCapacity;
  const growth = occupancyRatio * config.callRoomGrowthRatio;
  const radius = config.callRoomBaseRadius * (1 + growth);
  const maxRadius =
    config.callRoomBaseRadius * (1 + config.callRoomGrowthRatio);
  return Math.min(maxRadius, radius);
}

function normalizeRoomTheme(theme) {
  if (!theme || typeof theme !== 'object') {
    return { ...DEFAULT_ROOM_THEME };
  }
  const ringColor =
    typeof theme.ringColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(theme.ringColor.trim())
      ? theme.ringColor.trim().toLowerCase()
      : DEFAULT_ROOM_THEME.ringColor;
  return { ringColor };
}

function serializeRoom(room) {
  if (!room) {
    return null;
  }
  return {
    id: room.id,
    ownerId: room.ownerId,
    ownerUserId: room.ownerUserId || room.ownerSessionId,
    ownerSessionId: room.ownerSessionId,
    ownerName: room.ownerName,
    name: room.name,
    type: room.type,
    capacity: room.capacity,
    x: room.x,
    y: room.y,
    createdAt: room.createdAt,
    members: Array.isArray(room.members) ? room.members : [],
    participants: Array.isArray(room.participants) ? room.participants : [],
    roles: Array.isArray(room.roles) ? room.roles : [],
    roomTheme: normalizeRoomTheme(room.roomTheme),
  };
}

function serializeVoiceMessage(message) {
  if (!message) {
    return null;
  }
  return {
    id: message.id,
    ownerId: message.ownerId,
    ownerName: message.ownerName,
    x: message.x,
    y: message.y,
    createdAt: message.createdAt,
    expiresAt: message.expiresAt,
    audio: message.audio,
    mimeType: message.mimeType,
  };
}

function roomsOverlap(stateStore, x, y, capacity) {
  const newRadius = calculateRoomRadius(capacity, capacity);
  return stateStore.getRooms().some((room) => {
    const existingRadius = calculateRoomRadius(room.capacity, room.capacity);
    const dx = room.x - x;
    const dy = room.y - y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance < existingRadius + newRadius;
  });
}

function formatUserIdShort(userId) {
  if (userId === undefined || userId === null) {
    return 'unknown';
  }
  const value = String(userId).replace(/[^a-zA-Z0-9]/g, '');
  if (!value) {
    return 'unknown';
  }
  return value.length <= 6 ? value : value.slice(-6);
}

function resolveDisplayName({ displayName, name, userId, id }) {
  if (typeof displayName === 'string' && displayName.trim()) {
    return displayName.trim();
  }
  if (typeof name === 'string' && name.trim()) {
    return name.trim();
  }
  if (userId) {
    return `U-${formatUserIdShort(userId)}`;
  }
  if (id !== undefined && id !== null) {
    return `U-${formatUserIdShort(id)}`;
  }
  return '사용자';
}

function resolveVoiceMessagePlacement(stateStore, x, y) {
  const radius = config.voiceMessageRadius;
  const maxAttempts = 24;
  let angle = 0;
  let step = radius * 1.4;
  let candidate = { x, y };
  const isBlocked = (point) => {
    return (
      stateStore.getRooms().some((room) => {
        const roomRadius = calculateRoomRadius(room.capacity, room.members.length);
        const dx = room.x - point.x;
        const dy = room.y - point.y;
        return Math.sqrt(dx * dx + dy * dy) < roomRadius + radius;
      }) ||
      stateStore.getVoiceMessages().some((message) => {
        const dx = message.x - point.x;
        const dy = message.y - point.y;
        return Math.sqrt(dx * dx + dy * dy) < radius * 2;
      })
    );
  };

  if (!isBlocked(candidate)) {
    return candidate;
  }
  for (let i = 0; i < maxAttempts; i += 1) {
    angle += Math.PI / 3;
    step += radius * 0.4;
    candidate = {
      x: x + Math.cos(angle) * step,
      y: y + Math.sin(angle) * step,
    };
    if (!isBlocked(candidate)) {
      return candidate;
    }
  }
  return candidate;
}

function sendJson(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify(payload));
}

function createHandlers(context) {
  const {
    stateStore,
    publisher,
    positionQueue,
    redisChannels,
    clients,
    serverId,
  } = context;

  async function broadcastWorld(message) {
    await publisher.publish(
      redisChannels.world,
      JSON.stringify({ serverId, message })
    );
  }

  const pruneInterval = setInterval(async () => {
    const removedIds = await stateStore.pruneVoiceMessages();
    removedIds.forEach((messageId) => {
      broadcastWorld({ type: 'voice-message-removed', messageId }).catch(() => {
        /* ignore broadcast errors */
      });
    });
  }, Math.max(60 * 1000, Math.floor(config.voiceMessageWindowMs / 24)));

  async function persistClientState(clientId, overrideRoomId = null) {
    const info = clients.get(clientId);
    if (!info || !info.sessionId) {
      return;
    }
    await stateStore.saveSession(info.sessionId, {
      id: clientId,
      x: info.x,
      y: info.y,
      roomId:
        typeof overrideRoomId === 'number'
          ? overrideRoomId
          : typeof info.roomId === 'number'
          ? info.roomId
          : null,
    });
  }

  function buildParticipant(clientInfo, assignedId) {
    return {
      id: assignedId,
      userId: clientInfo.sessionId,
      displayName: resolveDisplayName({
        displayName: clientInfo.name,
        userId: clientInfo.sessionId,
        id: assignedId,
      }),
      joinedAt: Date.now(),
    };
  }

  async function syncPlayerRecord(info) {
    if (!info) {
      return;
    }
    await stateStore.persistPlayer({
      id: info.id,
      x: info.x,
      y: info.y,
      roomId: info.roomId,
      networkKey: info.networkKey,
      sessionId: info.sessionId,
      serverId,
      name: info.name,
    });
  }

  async function leaveCurrentRoom(clientId, notifyTarget = null, persistRoomId = null) {
    const info = clients.get(clientId);
    if (!info || info.roomId === null) {
      return;
    }
    const room = stateStore.getRoom(info.roomId);
    if (!room) {
      info.roomId = null;
      return;
    }
    await stateStore.removeRoomMember(room.id, clientId);
    await stateStore.removeRoomParticipant(room.id, clientId);
    const payload = { type: 'room-left', roomId: room.id, playerId: clientId };
    if (notifyTarget) {
      const targetClient = clients.get(notifyTarget);
      if (targetClient) {
        sendJson(targetClient.ws, payload);
      }
    }
    info.roomId = null;
    await syncPlayerRecord(info);
    await broadcastWorld({ type: 'room-updated', room: serializeRoom(room) });
    await broadcastWorld(payload);
    await persistClientState(clientId, persistRoomId);
  }

  async function handleConnection(ws, request) {
    const currentPopulation = await stateStore.getPopulation();
    if (currentPopulation >= config.maxClients) {
      sendJson(ws, { type: 'full', maxPlayers: config.maxClients });
      ws.close(1008, 'Server full');
      return;
    }

    const sessionId = extractSessionId(request);
    const resumeState = await stateStore.consumeSession(sessionId);
    const { networkKey } = extractClientNetworkInfo(request);
    const allPlayers = await stateStore.getAllPlayers();

    let assignedId = null;
    if (resumeState && typeof resumeState.id === 'number') {
      assignedId = await stateStore.allocateClientId(resumeState.id);
    } else {
      assignedId = await stateStore.allocateClientId();
    }

    const spawnPosition = resumeState
      ? { x: resumeState.x || 0, y: resumeState.y || 0 }
      : findSpawnPosition(allPlayers, networkKey);

    const prior = clients.get(assignedId);
    if (prior && prior.ws && prior.ws.readyState === WebSocket.OPEN) {
      try {
        prior.ws.terminate();
      } catch (error) {
        /* ignore termination errors */
      }
    }
    clients.delete(assignedId);

    const clientInfo = {
      ws,
      id: assignedId,
      x: spawnPosition.x,
      y: spawnPosition.y,
      roomId: null,
      sessionId: sessionId || crypto.randomUUID(),
      networkKey,
      name: '',
    };

    clients.set(assignedId, clientInfo);

    let resumedRoomId = null;
    if (resumeState && typeof resumeState.roomId === 'number') {
      const room = stateStore.getRoom(resumeState.roomId);
      if (room && room.members.length < room.capacity) {
        await stateStore.addRoomMember(room.id, assignedId);
        await stateStore.addRoomParticipant(room.id, buildParticipant(clientInfo, assignedId));
        clientInfo.roomId = room.id;
        resumedRoomId = room.id;
        await broadcastWorld({ type: 'room-updated', room: serializeRoom(room) });
      }
    }

    await syncPlayerRecord(clientInfo);

    const playersSnapshot = allPlayers
      .filter((player) => player.id !== assignedId)
      .map((player) => ({
        id: player.id,
        x: player.x,
        y: player.y,
        roomId: player.roomId,
        displayName: resolveDisplayName({
          displayName: player.name,
          userId: player.sessionId,
          id: player.id,
        }),
        userId: player.sessionId || player.id,
      }));

    const rooms = stateStore.getRooms().map(serializeRoom);
    const voiceMessages = stateStore.getVoiceMessages().map(serializeVoiceMessage);
    const population = (await stateStore.getPopulation()) || 0;

    sendJson(ws, {
      type: 'welcome',
      id: assignedId,
      population,
      maxPlayers: config.maxClients,
      players: playersSnapshot,
      rooms,
      voiceMessages,
      position: { x: clientInfo.x, y: clientInfo.y },
      roomId: resumedRoomId,
    });

    await persistClientState(assignedId, clientInfo.roomId);
    await broadcastWorld({
      type: 'player-joined',
      id: assignedId,
      x: clientInfo.x,
      y: clientInfo.y,
      roomId: clientInfo.roomId,
      population,
      displayName: resolveDisplayName({
        displayName: clientInfo.name,
        userId: clientInfo.sessionId,
        id: assignedId,
      }),
      userId: clientInfo.sessionId,
    });

    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch (error) {
        return;
      }
      if (!message || typeof message !== 'object') {
        return;
      }
      handleMessage(ws, assignedId, clientInfo, message).catch((error) => {
        console.error('Failed to handle message', error);
      });
    });

    ws.on('close', async () => {
      const info = clients.get(assignedId);
      const previousRoomId = info && typeof info.roomId === 'number' ? info.roomId : null;
      if (info) {
        await persistClientState(assignedId, previousRoomId);
      }
      await leaveCurrentRoom(assignedId, null, previousRoomId);
      clients.delete(assignedId);
      await stateStore.removePlayer(assignedId);
      const populationNow = (await stateStore.getPopulation()) || 0;
      await broadcastWorld({
        type: 'player-left',
        id: assignedId,
        population: populationNow,
        displayName: resolveDisplayName({
          displayName: info ? info.name : '',
          userId: info ? info.sessionId : null,
          id: assignedId,
        }),
        userId: info ? info.sessionId : null,
      });
    });

    ws.on('error', () => {
      ws.close();
    });
  }

  async function handleMessage(ws, assignedId, clientInfo, message) {
    switch (message.type) {
      case 'position': {
        if (typeof message.x === 'number' && typeof message.y === 'number') {
          clientInfo.x = message.x;
          clientInfo.y = message.y;
          positionQueue.enqueue({ id: assignedId, x: clientInfo.x, y: clientInfo.y });
        }
        break;
      }
      case 'identify': {
        if (typeof message.name === 'string') {
          const sanitized = sanitizeDisplayName(message.name);
          clientInfo.name = sanitized;
          await syncPlayerRecord(clientInfo);
          const ownerName = resolveDisplayName({
            displayName: sanitized,
            userId: clientInfo.sessionId,
            id: assignedId,
          });
          await Promise.all(
            stateStore.getRooms().map(async (room) => {
              if (room.ownerId === assignedId) {
                room.ownerName = ownerName;
              }
              if (Array.isArray(room.participants)) {
                const participant = room.participants.find((entry) => entry.id === assignedId);
                if (participant) {
                  participant.displayName = ownerName;
                }
              }
              await stateStore.updateRoom(room);
              await broadcastWorld({
                type: 'room-updated',
                room: serializeRoom(room),
              });
            })
          );
          await broadcastWorld({
            type: 'player-updated',
            id: assignedId,
            displayName: ownerName,
            userId: clientInfo.sessionId,
          });
        }
        break;
      }
      case 'create-room': {
        await handleCreateRoom(ws, assignedId, clientInfo, message);
        break;
      }
      case 'room-manage-update': {
        await handleRoomManageUpdate(ws, assignedId, message);
        break;
      }
      case 'room-theme-update': {
        await handleRoomThemeUpdate(ws, assignedId, message);
        break;
      }
      case 'room-delete': {
        await handleRoomDelete(ws, assignedId, message);
        break;
      }
      case 'voice-message-create': {
        await handleVoiceMessageCreate(ws, assignedId, clientInfo, message);
        break;
      }
      case 'room-join': {
        await handleRoomJoin(ws, assignedId, clientInfo, message);
        break;
      }
      case 'room-leave': {
        if (clientInfo.roomId !== null) {
          await leaveCurrentRoom(assignedId, assignedId);
        }
        break;
      }
      case 'signal': {
        await handleSignalMessage(assignedId, message);
        break;
      }
      default:
        break;
    }
  }

  async function handleCreateRoom(ws, assignedId, clientInfo, message) {
    const { x, y, capacity, visibility, name, password } = message;
    if (typeof x !== 'number' || typeof y !== 'number') {
      sendJson(ws, { type: 'room-create-result', success: false, reason: 'invalid' });
      return;
    }
    const normalizedCapacity = Math.max(
      1,
      Math.min(
        config.maxRoomCapacity,
        Number.isFinite(capacity) ? Math.floor(capacity) : config.maxRoomCapacity
      )
    );
    const attempts = await stateStore.registerRoomCreation(assignedId);
    if (attempts > config.roomCreationLimit) {
      sendJson(ws, {
        type: 'room-create-result',
        success: false,
        reason: 'rate-limit',
      });
      return;
    }
    if (roomsOverlap(stateStore, x, y, normalizedCapacity)) {
      sendJson(ws, {
        type: 'room-create-result',
        success: false,
        reason: 'overlap',
      });
      return;
    }
    const roomName = sanitizeRoomName(typeof name === 'string' ? name : '');
    if (roomName.length < config.roomNameMinLength) {
      sendJson(ws, {
        type: 'room-create-result',
        success: false,
        reason: 'invalid-name',
      });
      return;
    }
    const type = visibility === 'private' ? 'private' : 'public';
    let passwordHash = null;
    if (type === 'private') {
      const rawPassword = typeof password === 'string' ? password.trim() : '';
      if (rawPassword.length < config.roomPasswordMinLength) {
        sendJson(ws, {
          type: 'room-create-result',
          success: false,
          reason: 'invalid-password',
        });
        return;
      }
      passwordHash = hashRoomPassword(rawPassword);
    }
    const ownerName = resolveDisplayName({
      displayName: sanitizeDisplayName(clientInfo.name || ''),
      userId: clientInfo.sessionId,
      id: assignedId,
    });
    const room = await stateStore.createRoom({
      ownerId: assignedId,
      ownerSessionId: clientInfo.sessionId,
      ownerUserId: clientInfo.sessionId,
      ownerName,
      name: roomName,
      type,
      capacity: normalizedCapacity,
      x,
      y,
      passwordHash,
      members: [],
      roles: [],
      roomTheme: normalizeRoomTheme(),
    });
    await broadcastWorld({ type: 'room-created', room: serializeRoom(room) });
    sendJson(ws, { type: 'room-create-result', success: true, roomId: room.id });
  }

  async function handleRoomManageUpdate(ws, assignedId, message) {
    const { roomId, name, capacity, visibility, password, roles } = message;
    if (typeof roomId !== 'number') {
      sendJson(ws, { type: 'room-manage-result', success: false, reason: 'invalid-room' });
      return;
    }
    const room = stateStore.getRoom(roomId);
    if (!room) {
      sendJson(ws, { type: 'room-manage-result', success: false, reason: 'missing', roomId });
      return;
    }
    if (room.ownerId !== assignedId) {
      sendJson(ws, { type: 'room-manage-result', success: false, reason: 'forbidden', roomId });
      return;
    }
    const roomName = sanitizeRoomName(typeof name === 'string' ? name : room.name || '');
    if (roomName.length < config.roomNameMinLength) {
      sendJson(ws, { type: 'room-manage-result', success: false, reason: 'invalid-name', roomId });
      return;
    }
    let normalizedCapacity = Number.isFinite(capacity) ? Math.floor(capacity) : room.capacity;
    if (!Number.isFinite(normalizedCapacity)) {
      normalizedCapacity = room.capacity;
    }
    normalizedCapacity = Math.min(config.maxRoomCapacity, Math.max(1, normalizedCapacity));
    normalizedCapacity = Math.max(room.members.length, normalizedCapacity);
    const type = visibility === 'private' ? 'private' : 'public';
    let passwordHash = room.passwordHash;
    const trimmedPassword = typeof password === 'string' ? password.trim() : '';
    if (type === 'private') {
      if (!passwordHash && trimmedPassword.length < config.roomPasswordMinLength) {
        sendJson(ws, {
          type: 'room-manage-result',
          success: false,
          reason: 'invalid-password',
          roomId,
        });
        return;
      }
      if (trimmedPassword.length >= config.roomPasswordMinLength) {
        passwordHash = hashRoomPassword(trimmedPassword);
      }
    } else {
      passwordHash = null;
    }
    const sanitizedRoles = sanitizeRoomRoles(roles);
    room.name = roomName;
    room.capacity = normalizedCapacity;
    room.type = type;
    room.passwordHash = passwordHash;
    room.roles = sanitizedRoles;
    room.roomTheme = normalizeRoomTheme(room.roomTheme);
    await stateStore.updateRoom(room);
    await broadcastWorld({ type: 'room-updated', room: serializeRoom(room) });
    sendJson(ws, {
      type: 'room-manage-result',
      success: true,
      roomId,
      room: serializeRoom(room),
    });
  }

  async function handleRoomThemeUpdate(ws, assignedId, message) {
    const { roomId, ringColor } = message;
    if (typeof roomId !== 'number') {
      sendJson(ws, { type: 'room-theme-result', success: false, reason: 'invalid-room' });
      return;
    }
    const room = stateStore.getRoom(roomId);
    if (!room) {
      sendJson(ws, { type: 'room-theme-result', success: false, reason: 'missing', roomId });
      return;
    }
    if (room.ownerId !== assignedId) {
      sendJson(ws, { type: 'room-theme-result', success: false, reason: 'forbidden', roomId });
      return;
    }
    const nextTheme = normalizeRoomTheme({ ringColor });
    room.roomTheme = nextTheme;
    await stateStore.updateRoom(room);
    await broadcastWorld({ type: 'room-updated', room: serializeRoom(room) });
    sendJson(ws, {
      type: 'room-theme-result',
      success: true,
      roomId,
      room: serializeRoom(room),
    });
  }

  async function handleRoomDelete(ws, assignedId, message) {
    const { roomId } = message;
    if (typeof roomId !== 'number') {
      sendJson(ws, { type: 'room-delete-result', success: false, reason: 'invalid-room' });
      return;
    }
    const room = stateStore.getRoom(roomId);
    if (!room) {
      sendJson(ws, { type: 'room-delete-result', success: false, reason: 'missing', roomId });
      return;
    }
    if (room.ownerId !== assignedId) {
      sendJson(ws, { type: 'room-delete-result', success: false, reason: 'forbidden', roomId });
      return;
    }
    const memberIds = Array.isArray(room.members) ? room.members.slice() : [];
    await stateStore.removeRoom(roomId);
    await broadcastWorld({ type: 'room-removed', roomId });
    await Promise.all(
      memberIds.map(async (memberId) => {
        const member = clients.get(memberId);
        if (!member) {
          return;
        }
        member.roomId = null;
        await syncPlayerRecord(member);
        await persistClientState(memberId, null);
        sendJson(member.ws, { type: 'room-left', roomId, playerId: memberId });
      })
    );
    sendJson(ws, { type: 'room-delete-result', success: true, roomId });
  }

  async function handleVoiceMessageCreate(ws, assignedId, clientInfo, message) {
    const { x, y, audio, mimeType } = message;
    if (typeof x !== 'number' || typeof y !== 'number') {
      sendJson(ws, { type: 'voice-message-create-result', success: false, reason: 'invalid' });
      return;
    }
    if (typeof audio !== 'string' || audio.length === 0) {
      sendJson(ws, {
        type: 'voice-message-create-result',
        success: false,
        reason: 'invalid-audio',
      });
      return;
    }
    const approxBytes = Math.floor((audio.length * 3) / 4);
    if (approxBytes > config.voiceMessageMaxBytes) {
      sendJson(ws, {
        type: 'voice-message-create-result',
        success: false,
        reason: 'invalid-audio',
      });
      return;
    }
    const attempts = await stateStore.registerVoiceMessageCreation(assignedId);
    if (attempts > config.voiceMessageDailyLimit) {
      sendJson(ws, {
        type: 'voice-message-create-result',
        success: false,
        reason: 'rate-limit',
      });
      return;
    }
    const ownerName = resolveDisplayName({
      displayName: sanitizeDisplayName(clientInfo.name || ''),
      userId: clientInfo.sessionId,
      id: assignedId,
    });
    const placement = resolveVoiceMessagePlacement(stateStore, x, y);
    const messagePayload = await stateStore.createVoiceMessage({
      ownerId: assignedId,
      ownerName,
      x: placement.x,
      y: placement.y,
      audio,
      mimeType: typeof mimeType === 'string' ? mimeType : 'audio/webm',
    });
    const serialized = serializeVoiceMessage(messagePayload);
    await broadcastWorld({ type: 'voice-message-created', message: serialized });
    sendJson(ws, { type: 'voice-message-create-result', success: true, messageId: serialized.id });
  }

  async function handleRoomJoin(ws, assignedId, clientInfo, message) {
    const { roomId, password: joinPassword } = message;
    if (typeof roomId !== 'number') {
      return;
    }
    const room = stateStore.getRoom(roomId);
    if (!room) {
      sendJson(ws, {
        type: 'room-join-result',
        roomId,
        success: false,
        reason: 'missing',
      });
      return;
    }
    if (clientInfo.roomId === roomId) {
      sendJson(ws, { type: 'room-join-result', roomId, success: true });
      return;
    }
    if (room.members.length >= room.capacity) {
      sendJson(ws, {
        type: 'room-join-result',
        roomId,
        success: false,
        reason: 'full',
      });
      return;
    }
    if (room.type === 'private' && room.ownerId !== assignedId) {
      const providedPassword =
        typeof joinPassword === 'string' ? joinPassword.trim() : '';
      if (!providedPassword || !room.passwordHash) {
        sendJson(ws, {
          type: 'room-join-result',
          roomId,
          success: false,
          reason: 'password-required',
        });
        return;
      }
      if (!verifyRoomPassword(room.passwordHash, providedPassword)) {
        sendJson(ws, {
          type: 'room-join-result',
          roomId,
          success: false,
          reason: 'wrong-password',
        });
        return;
      }
    }
    if (clientInfo.roomId !== null) {
      await leaveCurrentRoom(assignedId);
    }
    await stateStore.addRoomMember(roomId, assignedId);
    await stateStore.addRoomParticipant(roomId, buildParticipant(clientInfo, assignedId));
    clientInfo.roomId = roomId;
    await persistClientState(assignedId, roomId);
    await syncPlayerRecord(clientInfo);
    await broadcastWorld({ type: 'room-updated', room: serializeRoom(stateStore.getRoom(roomId)) });
    sendJson(ws, { type: 'room-join-result', roomId, success: true });
  }

  async function handleSignalMessage(assignedId, message) {
    const targetId = message.to;
    if (!Number.isFinite(targetId)) {
      return;
    }
    const signalId = await stateStore.saveSignal(targetId, {
      from: assignedId,
      data: message.data,
    });
    await publisher.publish(
      redisChannels.signal,
      JSON.stringify({ targetId, signalId })
    );
  }

  async function broadcastFromRedis(raw) {
    let event;
    try {
      event = JSON.parse(raw);
    } catch (error) {
      return;
    }
    if (!event || !event.message) {
      return;
    }
    const { message } = event;
    if (message.type === 'position-batch') {
      message.updates.forEach((update) => {
        const payload = {
          type: 'position',
          id: update.id,
          x: update.x,
          y: update.y,
        };
        const serialized = JSON.stringify(payload);
        for (const client of clients.values()) {
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(serialized);
          }
        }
      });
      return;
    }
    if (message.type === 'room-created' || message.type === 'room-updated') {
      await stateStore.applyRemoteRoom(message.room);
    }
    if (message.type === 'room-removed' && typeof message.roomId === 'number') {
      await stateStore.removeRoom(message.roomId);
    }
    if (message.type === 'voice-message-created' && message.message) {
      await stateStore.applyRemoteVoiceMessage(message.message);
    }
    if (message.type === 'voice-message-removed' && typeof message.messageId === 'number') {
      await stateStore.removeVoiceMessage(message.messageId);
    }
    const serialized = JSON.stringify(message);
    for (const client of clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(serialized);
      }
    }
  }

  async function handleSignalDelivery(raw) {
    let event;
    try {
      event = JSON.parse(raw);
    } catch (error) {
      return;
    }
    if (!event || !Number.isFinite(event.targetId)) {
      return;
    }
    const target = clients.get(event.targetId);
    if (!target) {
      return;
    }
    const payload = await stateStore.consumeSignal(event.targetId, event.signalId);
    if (!payload) {
      return;
    }
    sendJson(target.ws, {
      type: 'signal',
      from: payload.from,
      data: payload.data,
    });
  }

  return { handleConnection, broadcastFromRedis, handleSignalDelivery };
}

module.exports = { createHandlers };
