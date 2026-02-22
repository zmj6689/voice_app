const crypto = require('crypto');
const { getPrismaClient } = require('./client');

async function createUser({ email, displayName, passwordHash }) {
  const prisma = getPrismaClient();
  return prisma.user.create({
    data: {
      email,
      displayName,
      passwordHash,
    },
  });
}

async function findUserByEmail(email) {
  const prisma = getPrismaClient();
  return prisma.user.findUnique({
    where: { email },
  });
}

async function findUserByIdentifier(identifier) {
  if (!identifier) {
    return null;
  }
  const prisma = getPrismaClient();
  const trimmed = identifier.trim();
  const normalized = trimmed.toLowerCase();
  return prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: normalized, mode: 'insensitive' } },
        { displayName: { equals: trimmed, mode: 'insensitive' } },
      ],
    },
  });
}

async function findUserBySessionToken(token) {
  if (!token) {
    return null;
  }
  const prisma = getPrismaClient();
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  return session ? session.user : null;
}

async function issueSessionToken(userId) {
  const prisma = getPrismaClient();
  const token = crypto.randomUUID();
  await prisma.session.create({
    data: { userId, token },
  });
  return token;
}

async function clearSessionToken(token) {
  if (!token) {
    return null;
  }
  const prisma = getPrismaClient();
  return prisma.session.deleteMany({ where: { token } });
}

async function updateUserDisplayName(userId, displayName) {
  const prisma = getPrismaClient();
  return prisma.user.update({
    where: { id: userId },
    data: { displayName },
  });
}

async function createRoomRecord({
  ownerId,
  name,
  capacity,
  visibility,
  passwordHash,
}) {
  const prisma = getPrismaClient();
  return prisma.room.create({
    data: {
      ownerId,
      name,
      capacity,
      visibility,
      passwordHash,
    },
  });
}

async function updateRoomRecord(id, data) {
  const prisma = getPrismaClient();
  return prisma.room.update({ where: { id }, data });
}

async function upsertPresence({ userId, serverId, x, y, roomId }) {
  const prisma = getPrismaClient();
  return prisma.presence.upsert({
    where: { userId },
    update: { serverId, x, y, roomId },
    create: { userId, serverId, x, y, roomId },
  });
}

async function listRooms() {
  const prisma = getPrismaClient();
  return prisma.room.findMany();
}

module.exports = {
  createUser,
  findUserByEmail,
  findUserByIdentifier,
  findUserBySessionToken,
  issueSessionToken,
  updateUserDisplayName,
  clearSessionToken,
  createRoomRecord,
  updateRoomRecord,
  upsertPresence,
  listRooms,
};
