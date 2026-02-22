const express = require('express');
const {
  createUser,
  findUserByEmail,
  findUserByIdentifier,
  findUserBySessionToken,
  issueSessionToken,
  updateUserDisplayName,
  clearSessionToken,
} = require('../db');
const { sanitizeDisplayName } = require('../utils/sanitize');
const { hashUserPassword, verifyUserPassword } = require('../utils/password');

const PASSWORD_MIN_LENGTH = 6;

function formatUserResponse(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
  };
}

function extractToken(req) {
  if (!req) {
    return null;
  }
  const header = req.headers && req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token) {
      return token;
    }
  }
  if (req.body && typeof req.body.token === 'string' && req.body.token.trim()) {
    return req.body.token.trim();
  }
  return null;
}

function buildError(message) {
  return { error: message };
}

function registerAuthRoutes(app) {
  const router = express.Router();

  router.post('/register', async (req, res) => {
    try {
      const { name, email, password } = req.body || {};
      const normalizedEmail =
        typeof email === 'string' ? email.trim().toLowerCase() : '';
      const sanitizedName = sanitizeDisplayName(name);
      if (!sanitizedName || sanitizedName.length < 2) {
        return res.status(400).json(buildError('닉네임은 2자 이상 입력해주세요.'));
      }
      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        return res.status(400).json(buildError('유효한 이메일을 입력해주세요.'));
      }
      if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
        return res
          .status(400)
          .json(buildError(`비밀번호는 최소 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`));
      }
      const existingEmail = await findUserByEmail(normalizedEmail);
      if (existingEmail) {
        return res.status(409).json(buildError('이미 가입된 이메일입니다.'));
      }
      const existingHandle = await findUserByIdentifier(sanitizedName);
      if (
        existingHandle &&
        existingHandle.displayName &&
        existingHandle.displayName.toLowerCase() === sanitizedName.toLowerCase()
      ) {
        return res.status(409).json(buildError('이미 사용 중인 닉네임입니다.'));
      }
      const passwordHash = await hashUserPassword(password);
      const user = await createUser({
        email: normalizedEmail,
        displayName: sanitizedName,
        passwordHash,
      });
      const sessionToken = await issueSessionToken(user.id);
      return res.status(201).json({ user: formatUserResponse(user), token: sessionToken });
    } catch (error) {
      console.error('Failed to register user', error);
      return res.status(500).json(buildError('계정을 생성할 수 없습니다. 다시 시도해주세요.'));
    }
  });

  router.post('/login', async (req, res) => {
    try {
      const { identifier, password } = req.body || {};
      const normalizedIdentifier =
        typeof identifier === 'string' ? identifier.trim() : '';
      if (!normalizedIdentifier || !password) {
        return res.status(400).json(buildError('아이디와 비밀번호를 모두 입력해주세요.'));
      }
      const user = await findUserByIdentifier(normalizedIdentifier);
      if (!user) {
        return res.status(401).json(buildError('가입 정보를 찾을 수 없습니다.'));
      }
      const isValid = await verifyUserPassword(user.passwordHash, password);
      if (!isValid) {
        return res.status(401).json(buildError('비밀번호가 올바르지 않습니다.'));
      }
      const sessionToken = await issueSessionToken(user.id);
      return res.json({ user: formatUserResponse(user), token: sessionToken });
    } catch (error) {
      console.error('Failed to login', error);
      return res.status(500).json(buildError('로그인에 실패했습니다. 잠시 후 다시 시도해주세요.'));
    }
  });

  router.post('/session', async (req, res) => {
    try {
      const token = extractToken(req);
      if (!token) {
        return res.status(401).json(buildError('세션 토큰이 필요합니다.'));
      }
      const user = await findUserBySessionToken(token);
      if (!user) {
        return res.status(401).json(buildError('세션이 만료되었습니다. 다시 로그인해주세요.'));
      }
      return res.json({ user: formatUserResponse(user), token });
    } catch (error) {
      console.error('Failed to validate session', error);
      return res.status(500).json(buildError('세션을 확인할 수 없습니다.'));
    }
  });

  router.post('/logout', async (req, res) => {
    try {
      const token = extractToken(req);
      if (token) {
        await clearSessionToken(token);
      }
      return res.json({ ok: true });
    } catch (error) {
      console.error('Failed to logout', error);
      return res.status(500).json(buildError('로그아웃을 처리할 수 없습니다.'));
    }
  });

  router.put('/profile', async (req, res) => {
    try {
      const token = extractToken(req);
      if (!token) {
        return res.status(401).json(buildError('인증 토큰이 필요합니다.'));
      }
      const user = await findUserBySessionToken(token);
      if (!user) {
        return res.status(401).json(buildError('세션이 만료되었습니다. 다시 로그인해주세요.'));
      }
      const normalizedName = sanitizeDisplayName(req.body ? req.body.name : '');
      if (!normalizedName || normalizedName.length < 2) {
        return res.status(400).json(buildError('닉네임은 2자 이상 입력해주세요.'));
      }
      if (normalizedName.toLowerCase() !== user.displayName.toLowerCase()) {
        const duplicate = await findUserByIdentifier(normalizedName);
        if (
          duplicate &&
          duplicate.id !== user.id &&
          duplicate.displayName &&
          duplicate.displayName.toLowerCase() === normalizedName.toLowerCase()
        ) {
          return res.status(409).json(buildError('이미 사용 중인 닉네임입니다.'));
        }
      }
      const updated = await updateUserDisplayName(user.id, normalizedName);
      return res.json({ user: formatUserResponse(updated) });
    } catch (error) {
      console.error('Failed to update profile', error);
      return res.status(500).json(buildError('프로필을 수정할 수 없습니다.'));
    }
  });

  app.use('/api/auth', router);
}

module.exports = { registerAuthRoutes };
