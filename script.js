const MAX_PLAYERS = 100;
const SPEED = 340;
const POSITION_SEND_INTERVAL = 120; // ms
const WAVE_BAR_COUNT = 19;
const AUTH_SESSION_KEY = 'waveFieldSession';
const AUTH_CONFIG_META = document.querySelector('meta[name="app-api-origin"]');
const AUTH_CONFIG =
  (window.__APP_CONFIG__ && window.__APP_CONFIG__.apiOrigin) ||
  (document.documentElement && document.documentElement.dataset
    ? document.documentElement.dataset.apiOrigin
    : '') ||
  (AUTH_CONFIG_META ? AUTH_CONFIG_META.content : '');

function buildApiOrigins() {
  const origins = [];
  const seen = new Set();
  const addOrigin = (origin) => {
    if (!origin) {
      return;
    }
    const trimmed = origin.replace(/\/$/, '');
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    origins.push(trimmed);
  };
  const protocol =
    window.location && window.location.protocol && window.location.protocol.startsWith('http')
      ? window.location.protocol
      : 'http:';
  const hostname = (window.location && window.location.hostname) || 'localhost';
  const preferredPort =
    (window.__APP_CONFIG__ && window.__APP_CONFIG__.apiPort) ||
    (document.documentElement && document.documentElement.dataset
      ? document.documentElement.dataset.apiPort
      : '') ||
    '';
  const parsedPort = Number(preferredPort);
  const fallbackPort = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000;
  const currentOrigin =
    window.location && window.location.origin && window.location.origin !== 'null'
      ? window.location.origin
      : '';
  const configuredOrigin = AUTH_CONFIG && AUTH_CONFIG.trim();
  const prefersHttps =
    (configuredOrigin && configuredOrigin.startsWith('https://')) || protocol === 'https:';
  addOrigin(configuredOrigin);
  addOrigin(currentOrigin);
  addOrigin(`${protocol}//${hostname}:${fallbackPort}`);
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    addOrigin(`http://${hostname}:3000`);
  }
  addOrigin('http://localhost:3000');
  addOrigin('http://127.0.0.1:3000');
  if (prefersHttps) {
    addOrigin('https://localhost:3000');
    addOrigin('https://127.0.0.1:3000');
  }
  return origins;
}

const API_ORIGINS = buildApiOrigins();
const AUTH_API_ORIGINS = API_ORIGINS;

function buildAuthApiUrls(endpoint) {
  const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (AUTH_API_ORIGINS.length === 0) {
    return [`/api/auth${normalized}`];
  }
  return AUTH_API_ORIGINS.map((origin) => `${origin}/api/auth${normalized}`);
}
const TURN_DEFAULT_USERNAME = 'voiceapp';
const TURN_DEFAULT_CREDENTIAL = 'voiceapp';
const ROOM_NAME_MIN_LENGTH = 2;
const ROOM_NAME_MAX_LENGTH = 40;
const ROOM_PASSWORD_MIN_LENGTH = 4;
const ROOM_ROLE_MAX = 8;
const ROOM_ROLE_NAME_MAX_LENGTH = 30;
const DEFAULT_ROOM_RING_COLOR = '#ffffff';
const VOICE_MESSAGE_HOLD_MS = 3000;
const VOICE_MESSAGE_MAX_BYTES = 650000;
const VOICE_MESSAGE_MAX_DURATION_MS = 10000;
const VOICE_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;
const VOICE_MESSAGE_PRUNE_INTERVAL_MS = 60 * 1000;
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const LOCAL_TURN_HOST = window.location.hostname || 'localhost';
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: `turn:${LOCAL_TURN_HOST}:3478?transport=udp`,
    username: TURN_DEFAULT_USERNAME,
    credential: TURN_DEFAULT_CREDENTIAL,
  },
  {
    urls: `turn:${LOCAL_TURN_HOST}:3478?transport=tcp`,
    username: TURN_DEFAULT_USERNAME,
    credential: TURN_DEFAULT_CREDENTIAL,
  },
];

let ICE_SERVERS = [...DEFAULT_ICE_SERVERS];
let iceConfigLoaded = false;
let pendingSocketConnect = false;

function buildIceConfigUrls() {
  const urls = [];
  const seen = new Set();
  const push = (url) => {
    if (!url || seen.has(url)) {
      return;
    }
    seen.add(url);
    urls.push(url);
  };
  push('/config/ice');
  API_ORIGINS.forEach((origin) => {
    push(`${origin}/config/ice`);
  });
  return urls;
}

async function loadIceConfig() {
  const urls = buildIceConfigUrls();
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'include',
      });
      if (!response.ok) {
        continue;
      }
      const data = await response.json();
      if (data && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
        ICE_SERVERS = data.iceServers;
        return;
      }
    } catch (error) {
      console.warn('Failed to fetch ICE config from', url, error);
    }
  }
  ICE_SERVERS = [...DEFAULT_ICE_SERVERS];
}

loadIceConfig()
  .catch(() => {
    ICE_SERVERS = [...DEFAULT_ICE_SERVERS];
  })
  .finally(() => {
    iceConfigLoaded = true;
    if (pendingSocketConnect && gameStarted) {
      pendingSocketConnect = false;
      connectToServer();
    }
  });

const game = document.getElementById('game');
const world = document.getElementById('world');
const player = document.getElementById('player');
const waveElement = player?.querySelector('.wave');
const micButton = document.getElementById('micButton');
const statusElement = document.getElementById('connectionStatus');
const populationElement = document.getElementById('populationStatus');
const audioLayer = document.getElementById('audioLayer');
const authOverlay = document.getElementById('authOverlay');
const authTabs = Array.from(document.querySelectorAll('[data-auth-mode]'));
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const authErrorElement = document.getElementById('authError');
const logoutButton = document.getElementById('logoutButton');
const userGreetingElement = document.getElementById('userGreeting');
const settingsButton = document.getElementById('settingsButton');
const statusSettingsButton = document.getElementById('statusSettingsButton');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsDialog = document.getElementById('settingsDialog');
const settingsCloseButton = document.getElementById('settingsCloseButton');
const settingsAccountName = document.getElementById('settingsAccountName');
const settingsAccountEmail = document.getElementById('settingsAccountEmail');
const settingsAccountForm = document.getElementById('settingsAccountForm');
const settingsAccountNameInput = document.getElementById('settingsAccountNameInput');
const settingsAccountFeedback = document.getElementById('settingsAccountFeedback');
const settingsCreatedList = document.getElementById('settingsCreatedList');
const settingsCreatedCount = document.getElementById('settingsCreatedCount');
const settingsCreatedEmpty = document.getElementById('settingsCreatedEmpty');
const settingsJoinedList = document.getElementById('settingsJoinedList');
const settingsJoinedCount = document.getElementById('settingsJoinedCount');
const settingsJoinedEmpty = document.getElementById('settingsJoinedEmpty');
const bodyElement = document.body;
const serverMenuButton = document.getElementById('serverMenuButton');
const serverPanel = document.getElementById('serverPanel');
const mainServerEntry = document.querySelector('[data-server-entry="main"]');
const mainServerInfo = document.querySelector('[data-server-info="main"]');
const bottomBar = document.getElementById('bottomBar');
const roomContextMenu = document.getElementById('roomContext');
const roomForm = document.getElementById('roomForm');
const roomTypeInputs = Array.from(
  document.querySelectorAll('input[name="roomVisibility"]')
);
const roomNameInput = document.getElementById('roomName');
const roomCapacityInput = document.getElementById('roomCapacity');
const roomPasswordField = document.getElementById('roomPasswordField');
const roomPasswordInput = document.getElementById('roomPassword');
const roomCreateError = document.getElementById('roomCreateError');
const roomCancelButton = document.getElementById('roomCancelButton');
const roomInfoCard = document.getElementById('roomInfoCard');
const roomInfoName = document.getElementById('roomInfoName');
const roomInfoOwner = document.getElementById('roomInfoOwner');
const roomInfoCreated = document.getElementById('roomInfoCreated');
const roomInfoCapacity = document.getElementById('roomInfoCapacity');
const roomInfoMembers = document.getElementById('roomInfoMembers');
const roomInfoCloseButton = document.getElementById('roomInfoClose');
const roomManageOverlay = document.getElementById('roomManageOverlay');
const roomManageDialog = document.getElementById('roomManageDialog');
const roomManageCloseButton = document.getElementById('roomManageCloseButton');
const roomManageForm = document.getElementById('roomManageForm');
const roomManageNameInput = document.getElementById('roomManageName');
const roomManageCapacityInput = document.getElementById('roomManageCapacity');
const roomManagePasswordField = document.getElementById('roomManagePasswordField');
const roomManagePasswordInput = document.getElementById('roomManagePassword');
const roomManageRingColorInput = document.getElementById('roomManageRingColor');
const roomManageVisibilityInputs = Array.from(
  document.querySelectorAll('input[name="roomManageVisibility"]')
);
const roomManageRoleInput = document.getElementById('roomManageRoleInput');
const roomManageRoleAddButton = document.getElementById('roomManageRoleAdd');
const roomManageRoleList = document.getElementById('roomManageRoleList');
const roomManageRoleCount = document.getElementById('roomManageRoleCount');
const roomManageRolesEmpty = document.getElementById('roomManageRolesEmpty');
const roomManageFeedback = document.getElementById('roomManageFeedback');
const roomManageSubmitButton = document.getElementById('roomManageSubmit');
const roomManageTeleportButton = document.getElementById('roomManageTeleport');
const roomManageDeleteButton = document.getElementById('roomManageDelete');
const roomManageSummaryName = document.getElementById('roomManageSummaryName');
const roomManageSummaryOwner = document.getElementById('roomManageSummaryOwner');
const roomManageSummaryCreated = document.getElementById('roomManageSummaryCreated');
const roomManageSummaryMembers = document.getElementById('roomManageSummaryMembers');
const roomManageSummaryVisibility = document.getElementById(
  'roomManageSummaryVisibility'
);
const ROOM_MANAGE_DEFAULT_MESSAGE =
  '통화방 정보를 확인하고 수정한 뒤 저장을 누르면 즉시 반영됩니다.';

const keys = new Map();
const relevantKeys = new Set(['w', 'a', 's', 'd']);

const position = { x: 0, y: 0 };
const CALL_ROOM_BASE_RADIUS = 180;
const CALL_ROOM_GROWTH_RATIO = 0.45; // up to 45% larger at full capacity
const CALL_ROOM_MAX_RADIUS = CALL_ROOM_BASE_RADIUS * (1 + CALL_ROOM_GROWTH_RATIO);
let lastTime = null;
let positionDirty = true;
let lastSentPositionTime = 0;

const remotePlayers = new Map();
const peerStates = new Map();
const audioElements = new Map();
const callRooms = new Map();
const playerRoomMembership = new Map();
const voiceMessages = new Map();

let socket = null;
let reconnectTimer = null;
let clientId = null;
let micAccessEnabled = false;
let micMuted = false;
let voiceRecorder = null;
let voiceRecorderChunks = [];
let voiceRecorderTimeout = null;
let gameStarted = false;
let currentUser = null;
let currentAuthMode = 'login';

let localStream = null;
let audioContext = null;
let localAnalyser = null;
let localDataArray = null;
let waveLevel = 0.18;

const localWaveBars = [];

let pendingRoomPosition = null;
let activeRoomId = null;
let roomUnderPlayerId = null;
let pendingJoinRoomId = null;
let roomManageTargetId = null;
let roomManageRoles = [];
let roomManageOpen = false;
let roomManageSubmitting = false;
let lastRoomManageTrigger = null;
let visibleRoomInfoId = null;
let settingsOpen = false;
let lastSettingsTrigger = null;
let voiceMessageRecording = false;
let voiceMessageStartTimer = null;
let voiceMessageDropActive = false;
let voiceMessageDropPosition = null;
let lastActivityAt = Date.now();
let inactivityTimer = null;

function setServerPanelOpen(open) {
  if (!serverPanel || !serverMenuButton) {
    return;
  }
  serverPanel.classList.toggle('is-open', open);
  serverMenuButton.setAttribute('aria-expanded', String(open));
  serverMenuButton.setAttribute('aria-label', open ? '서버 메뉴 닫기' : '서버 메뉴 열기');
  serverPanel.setAttribute('aria-hidden', String(!open));
  if (bodyElement) {
    bodyElement.classList.toggle('server-panel-open', open);
  }
}

function toggleServerPanel() {
  if (!serverPanel || !serverMenuButton) {
    return;
  }
  const shouldOpen = !serverPanel.classList.contains('is-open');
  setServerPanelOpen(shouldOpen);
}

setServerPanelOpen(false);
updateRoomPasswordVisibility();

function isWithinOverlay(target) {
  if (!target) {
    return false;
  }
  const elements = [
    authOverlay,
    serverPanel,
    serverMenuButton,
    bottomBar,
    roomContextMenu,
    roomInfoCard,
    settingsOverlay,
    roomManageOverlay,
  ];
  return elements.some((element) => element && element.contains(target));
}

function getWorldCoordinatesFromEvent(event) {
  if (!game) {
    return null;
  }
  const rect = game.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const offsetX = game.clientWidth / 2 - position.x;
  const offsetY = game.clientHeight / 2 - position.y;
  return {
    x: localX - offsetX,
    y: localY - offsetY,
  };
}

function closeRoomContextMenu() {
  pendingRoomPosition = null;
  if (roomForm) {
    roomForm.reset();
  }
  if (roomNameInput) {
    roomNameInput.value = '';
  }
  if (roomPasswordInput) {
    roomPasswordInput.value = '';
  }
  if (roomCreateError) {
    roomCreateError.hidden = true;
    roomCreateError.textContent = '';
  }
  updateRoomPasswordVisibility();
  if (roomContextMenu) {
    roomContextMenu.hidden = true;
    roomContextMenu.classList.remove('is-open');
  }
}

function updateRoomPasswordVisibility() {
  if (!roomPasswordField) {
    return;
  }
  const selectedType = roomTypeInputs.find((input) => input.checked);
  const isPrivate = selectedType && selectedType.value === 'private';
  roomPasswordField.hidden = !isPrivate;
  if (!isPrivate && roomPasswordInput) {
    roomPasswordInput.value = '';
  }
}

function closeRoomInfoCard() {
  visibleRoomInfoId = null;
  if (!roomInfoCard) {
    return;
  }
  roomInfoCard.hidden = true;
  roomInfoCard.removeAttribute('data-room-id');
}

function formatRoomTimestamp(value) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  try {
    const formatter = new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    return formatter.format(date);
  } catch (error) {
    return date.toLocaleString();
  }
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

function setSleepingState(isSleeping) {
  if (!player) {
    return;
  }
  player.classList.toggle('is-sleeping', isSleeping);
}

function scheduleInactivityCheck() {
  if (inactivityTimer) {
    window.clearTimeout(inactivityTimer);
  }
  inactivityTimer = window.setTimeout(() => {
    const elapsed = Date.now() - lastActivityAt;
    if (elapsed >= INACTIVITY_TIMEOUT_MS) {
      setSleepingState(true);
    }
  }, INACTIVITY_TIMEOUT_MS + 200);
}

function registerActivity() {
  lastActivityAt = Date.now();
  if (player && player.classList.contains('is-sleeping')) {
    setSleepingState(false);
  }
  scheduleInactivityCheck();
}

let lastActivityEventAt = 0;

function registerActivityThrottled() {
  const now = Date.now();
  if (now - lastActivityEventAt < 1000) {
    return;
  }
  lastActivityEventAt = now;
  registerActivity();
}

function normalizeRingColor(value) {
  if (typeof value !== 'string') {
    return DEFAULT_ROOM_RING_COLOR;
  }
  const trimmed = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return DEFAULT_ROOM_RING_COLOR;
  }
  return trimmed.toLowerCase();
}

function getRoomRingColor(roomData) {
  if (!roomData || typeof roomData !== 'object') {
    return DEFAULT_ROOM_RING_COLOR;
  }
  const theme = roomData.roomTheme;
  if (!theme || typeof theme !== 'object') {
    return DEFAULT_ROOM_RING_COLOR;
  }
  return normalizeRingColor(theme.ringColor);
}

function updateRoomManagePasswordVisibility() {
  if (!roomManagePasswordField) {
    return;
  }
  const selected = roomManageVisibilityInputs.find((input) => input.checked);
  const isPrivate = selected && selected.value === 'private';
  roomManagePasswordField.hidden = !isPrivate;
  if (!isPrivate && roomManagePasswordInput) {
    roomManagePasswordInput.value = '';
  }
}

function setRoomManageFeedback(message, type) {
  if (!roomManageFeedback) {
    return;
  }
  roomManageFeedback.textContent = message || '';
  roomManageFeedback.classList.remove('is-error', 'is-success');
  if (type === 'error') {
    roomManageFeedback.classList.add('is-error');
  } else if (type === 'success') {
    roomManageFeedback.classList.add('is-success');
  }
}

function setRoomManageSubmitting(isSubmitting) {
  roomManageSubmitting = Boolean(isSubmitting);
  if (roomManageSubmitButton) {
    roomManageSubmitButton.disabled = roomManageSubmitting;
  }
  if (roomManageTeleportButton) {
    roomManageTeleportButton.disabled = roomManageSubmitting;
  }
  if (roomManageDeleteButton) {
    roomManageDeleteButton.disabled = roomManageSubmitting;
  }
  if (roomManageRingColorInput) {
    const canEditColor =
      roomManageTargetId !== null &&
      callRooms.get(roomManageTargetId) &&
      callRooms.get(roomManageTargetId).data &&
      callRooms.get(roomManageTargetId).data.ownerId === clientId;
    roomManageRingColorInput.disabled = roomManageSubmitting || !canEditColor;
  }
}

function updateRoomManageRoleControls() {
  const limitReached = roomManageRoles.length >= ROOM_ROLE_MAX;
  if (roomManageRoleInput) {
    roomManageRoleInput.disabled = false;
  }
  if (roomManageRoleAddButton) {
    const rawValue = roomManageRoleInput ? roomManageRoleInput.value : '';
    const hasValue = typeof rawValue === 'string' && rawValue.trim().length > 0;
    roomManageRoleAddButton.disabled = limitReached || !hasValue;
  }
  if (roomManageRoleCount) {
    roomManageRoleCount.textContent = `${roomManageRoles.length}/${ROOM_ROLE_MAX}`;
  }
  if (roomManageRolesEmpty) {
    roomManageRolesEmpty.hidden = roomManageRoles.length > 0;
  }
}

function renderRoomManageRoles() {
  if (roomManageRoleList) {
    roomManageRoleList.innerHTML = '';
    roomManageRoles.forEach((role, index) => {
      const item = document.createElement('li');
      item.className = 'room-manage-role-item';

      const name = document.createElement('span');
      name.className = 'room-manage-role-name';
      name.textContent = role;
      item.appendChild(name);

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'ghost-button room-manage-role-remove';
      removeButton.dataset.roomRoleRemove = String(index);
      removeButton.textContent = '삭제';
      item.appendChild(removeButton);

      roomManageRoleList.appendChild(item);
    });
  }
  updateRoomManageRoleControls();
}

function updateRoomManageSummary(roomData) {
  const entry = roomData && typeof roomData.id === 'number' ? callRooms.get(roomData.id) : null;
  const memberCount = roomData
    ? Array.isArray(roomData.members)
      ? roomData.members.length
      : entry && entry.members
        ? entry.members.size
        : 0
    : 0;
  const capacity = roomData && Number.isFinite(roomData.capacity) ? roomData.capacity : 0;
  const displayName =
    roomData && roomData.name && roomData.name.trim()
      ? roomData.name.trim()
      : roomData && typeof roomData.id === 'number'
        ? `통화방 #${roomData.id}`
        : '-';
  const ownerName = roomData
    ? resolveDisplayName({
        displayName: roomData.ownerName,
        userId: roomData.ownerUserId || roomData.ownerSessionId,
        id: roomData.ownerId,
      })
    : '-';
  const createdLabel = roomData ? formatRoomTimestamp(roomData.createdAt) : '-';
  const visibilityLabel = roomData
    ? roomData.type === 'private'
      ? '개인 · 비밀번호 보호'
      : '공개'
    : '-';

  if (roomManageSummaryName) {
    roomManageSummaryName.textContent = displayName;
  }
  if (roomManageSummaryOwner) {
    roomManageSummaryOwner.textContent = ownerName;
  }
  if (roomManageSummaryCreated) {
    roomManageSummaryCreated.textContent = createdLabel;
  }
  if (roomManageSummaryMembers) {
    roomManageSummaryMembers.textContent = `${memberCount} / ${capacity}명`;
  }
  if (roomManageSummaryVisibility) {
    roomManageSummaryVisibility.textContent = visibilityLabel;
  }
}

function applyRoomManageData(roomData) {
  if (!roomData) {
    updateRoomManageSummary(null);
    return;
  }
  if (roomManageNameInput) {
    const displayName =
      roomData.name && roomData.name.trim()
        ? roomData.name.trim()
        : `통화방 #${roomData.id}`;
    roomManageNameInput.value = displayName;
  }
  if (roomManageCapacityInput) {
    roomManageCapacityInput.value = String(roomData.capacity || 1);
  }
  const targetVisibility = roomData.type === 'private' ? 'private' : 'public';
  roomManageVisibilityInputs.forEach((input) => {
    input.checked = input.value === targetVisibility;
  });
  if (roomManagePasswordInput) {
    roomManagePasswordInput.value = '';
  }
  if (roomManageRingColorInput) {
    roomManageRingColorInput.value = DEFAULT_ROOM_RING_COLOR;
    roomManageRingColorInput.disabled = false;
  }
  const canEditTheme = roomData.ownerId === clientId;
  if (roomManageRingColorInput) {
    roomManageRingColorInput.value = getRoomRingColor(roomData);
    roomManageRingColorInput.disabled = !canEditTheme;
  }
  roomManageRoles = Array.isArray(roomData.roles)
    ? roomData.roles.slice(0, ROOM_ROLE_MAX)
    : [];
  renderRoomManageRoles();
  updateRoomManagePasswordVisibility();
  updateRoomManageSummary(roomData);
  if (!roomManageFeedback || roomManageFeedback.textContent.trim().length === 0) {
    setRoomManageFeedback(ROOM_MANAGE_DEFAULT_MESSAGE);
  }
}

function openRoomManageOverlayForRoom(roomId, trigger) {
  if (!roomManageOverlay || !roomManageDialog) {
    return;
  }
  const entry = callRooms.get(roomId);
  if (!entry || !entry.data) {
    setStatus('통화방 정보를 불러올 수 없습니다.');
    return;
  }
  if (entry.data.ownerId !== clientId) {
    setStatus('내가 만든 통화방만 관리할 수 있습니다.');
    return;
  }
  roomManageTargetId = roomId;
  lastRoomManageTrigger = trigger instanceof HTMLElement ? trigger : null;
  applyRoomManageData(entry.data);
  setRoomManageSubmitting(false);
  roomManageOverlay.hidden = false;
  roomManageOverlay.setAttribute('aria-hidden', 'false');
  roomManageOpen = true;
  if (bodyElement) {
    bodyElement.classList.add('room-manage-open');
  }
  window.requestAnimationFrame(() => {
    roomManageDialog.focus();
  });
}

function closeRoomManageOverlay() {
  if (!roomManageOverlay || roomManageOverlay.hidden) {
    return;
  }
  roomManageOverlay.hidden = true;
  roomManageOverlay.setAttribute('aria-hidden', 'true');
  roomManageOpen = false;
  roomManageTargetId = null;
  roomManageRoles = [];
  setRoomManageSubmitting(false);
  setRoomManageFeedback('');
  if (roomManageForm) {
    roomManageForm.reset();
  }
  if (roomManagePasswordInput) {
    roomManagePasswordInput.value = '';
  }
  renderRoomManageRoles();
  updateRoomManagePasswordVisibility();
  if (bodyElement) {
    bodyElement.classList.remove('room-manage-open');
  }
  updateRoomManageSummary(null);
  const trigger = lastRoomManageTrigger;
  lastRoomManageTrigger = null;
  if (trigger && typeof trigger.focus === 'function') {
    trigger.focus();
  }
}

function handleRoomManageOverlayClick(event) {
  if (!(event.target instanceof Element)) {
    return;
  }
  if (
    event.target.hasAttribute('data-room-manage-close') ||
    event.target.classList.contains('room-manage-backdrop')
  ) {
    closeRoomManageOverlay();
  }
}

function attemptAddRoomManageRole() {
  if (!roomManageRoleInput) {
    return;
  }
  const rawValue = roomManageRoleInput.value || '';
  let normalized = rawValue.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    setRoomManageFeedback('역할 이름을 입력해주세요.', 'error');
    roomManageRoleInput.focus();
    return;
  }
  normalized = normalized.slice(0, ROOM_ROLE_NAME_MAX_LENGTH);
  if (roomManageRoles.some((role) => role.toLowerCase() === normalized.toLowerCase())) {
    setRoomManageFeedback('이미 동일한 역할이 있습니다.', 'error');
    roomManageRoleInput.focus();
    roomManageRoleInput.select();
    return;
  }
  if (roomManageRoles.length >= ROOM_ROLE_MAX) {
    setRoomManageFeedback('역할은 더 이상 추가할 수 없습니다.', 'error');
    return;
  }
  roomManageRoles.push(normalized);
  roomManageRoleInput.value = '';
  renderRoomManageRoles();
  setRoomManageFeedback('역할이 추가되었습니다.', 'success');
}

function handleRoomManageFormSubmit(event) {
  event.preventDefault();
  if (!roomManageOpen || roomManageTargetId === null) {
    setRoomManageFeedback('관리할 통화방을 선택해주세요.', 'error');
    return;
  }
  const entry = callRooms.get(roomManageTargetId);
  if (!entry || !entry.data) {
    setRoomManageFeedback('통화방 정보를 찾을 수 없습니다.', 'error');
    return;
  }
  const rawName = roomManageNameInput ? String(roomManageNameInput.value || '') : '';
  const normalizedName = rawName.replace(/\s+/g, ' ').trim();
  if (normalizedName.length < ROOM_NAME_MIN_LENGTH) {
    setRoomManageFeedback(`서버 이름은 최소 ${ROOM_NAME_MIN_LENGTH}자 이상이어야 합니다.`, 'error');
    if (roomManageNameInput) {
      roomManageNameInput.focus();
      roomManageNameInput.select();
    }
    return;
  }
  let capacity = entry.data.capacity || 1;
  if (roomManageCapacityInput) {
    const parsed = Number(roomManageCapacityInput.value);
    if (Number.isFinite(parsed)) {
      capacity = Math.min(MAX_PLAYERS, Math.max(1, Math.floor(parsed)));
    }
  }
  let visibility = 'public';
  const selectedVisibility = roomManageVisibilityInputs.find((input) => input.checked);
  if (selectedVisibility && selectedVisibility.value === 'private') {
    visibility = 'private';
  }
  let password = '';
  const trimmedPassword = roomManagePasswordInput
    ? roomManagePasswordInput.value.trim()
    : '';
  if (visibility === 'private') {
    const requiresPassword = entry.data.type !== 'private';
    if (trimmedPassword.length > 0 && trimmedPassword.length < ROOM_PASSWORD_MIN_LENGTH) {
      setRoomManageFeedback(
        `비밀번호는 최소 ${ROOM_PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`,
        'error'
      );
      if (roomManagePasswordInput) {
        roomManagePasswordInput.focus();
        roomManagePasswordInput.select();
      }
      return;
    }
    if (requiresPassword && trimmedPassword.length < ROOM_PASSWORD_MIN_LENGTH) {
      setRoomManageFeedback('개인 통화방으로 전환하려면 비밀번호를 설정하세요.', 'error');
      if (roomManagePasswordInput) {
        roomManagePasswordInput.focus();
      }
      return;
    }
    if (trimmedPassword.length >= ROOM_PASSWORD_MIN_LENGTH) {
      password = trimmedPassword;
    }
  } else if (roomManagePasswordInput) {
    roomManagePasswordInput.value = '';
  }
  setRoomManageSubmitting(true);
  setRoomManageFeedback('통화방 설정을 저장하는 중입니다…');
  sendToServer({
    type: 'room-manage-update',
    roomId: roomManageTargetId,
    name: normalizedName.slice(0, ROOM_NAME_MAX_LENGTH),
    capacity,
    visibility,
    password,
    roles: roomManageRoles.slice(0, ROOM_ROLE_MAX),
  });
}

function handleRoomManageRingColorChange() {
  if (!roomManageOpen || roomManageTargetId === null || !roomManageRingColorInput) {
    return;
  }
  const entry = callRooms.get(roomManageTargetId);
  if (!entry || !entry.data) {
    return;
  }
  if (entry.data.ownerId !== clientId) {
    roomManageRingColorInput.value = getRoomRingColor(entry.data);
    setRoomManageFeedback('방장만 링 색상을 변경할 수 있습니다.', 'error');
    return;
  }
  const ringColor = normalizeRingColor(roomManageRingColorInput.value);
  roomManageRingColorInput.value = ringColor;
  sendToServer({
    type: 'room-theme-update',
    roomId: roomManageTargetId,
    ringColor,
  });
}

function handleRoomManageTeleport() {
  if (roomManageTargetId === null) {
    setRoomManageFeedback('이동할 통화방을 선택해주세요.', 'error');
    return;
  }
  const entry = callRooms.get(roomManageTargetId);
  if (!entry || !entry.data) {
    setRoomManageFeedback('통화방 위치를 찾을 수 없습니다.', 'error');
    return;
  }
  const targetX = Number(entry.data.x);
  const targetY = Number(entry.data.y);
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
    setRoomManageFeedback('통화방 좌표가 올바르지 않습니다.', 'error');
    return;
  }
  position.x = Math.round(targetX);
  position.y = Math.round(targetY);
  positionDirty = true;
  applyPosition();
  if (socket && socket.readyState === WebSocket.OPEN) {
    sendToServer({ type: 'position', x: position.x, y: position.y });
  }
  setStatus('통화방 위치로 이동했습니다.');
  closeRoomManageOverlay();
}

function handleRoomManageDelete() {
  if (!roomManageOpen || roomManageTargetId === null) {
    setRoomManageFeedback('삭제할 통화방을 선택해주세요.', 'error');
    return;
  }
  const entry = callRooms.get(roomManageTargetId);
  if (!entry || !entry.data) {
    setRoomManageFeedback('통화방 정보를 찾을 수 없습니다.', 'error');
    return;
  }
  if (entry.data.ownerId !== clientId) {
    setRoomManageFeedback('내가 만든 통화방만 삭제할 수 있습니다.', 'error');
    return;
  }
  const confirmName =
    entry.data.name && entry.data.name.trim() ? entry.data.name.trim() : `통화방 #${entry.id}`;
  const confirmed = window.confirm(
    `"${confirmName}" 통화방을 삭제할까요? 삭제 후에는 복구할 수 없습니다.`
  );
  if (!confirmed) {
    return;
  }
  setRoomManageSubmitting(true);
  setRoomManageFeedback('통화방을 삭제하는 중입니다…');
  sendToServer({ type: 'room-delete', roomId: roomManageTargetId });
}

function handleRoomManageResult(payload) {
  if (!payload) {
    return;
  }
  if (payload.room) {
    handleRoomUpdated(payload.room);
  }
  if (!roomManageOpen || roomManageTargetId === null) {
    return;
  }
  if (typeof payload.roomId === 'number' && payload.roomId !== roomManageTargetId) {
    return;
  }
  setRoomManageSubmitting(false);
  if (payload.success) {
    setRoomManageFeedback('통화방 설정이 저장되었습니다.', 'success');
  } else {
    let message = '통화방 설정을 저장하지 못했습니다.';
    switch (payload.reason) {
      case 'invalid-name':
        message = `서버 이름은 최소 ${ROOM_NAME_MIN_LENGTH}자 이상이어야 합니다.`;
        break;
      case 'invalid-password':
        message = `비밀번호는 최소 ${ROOM_PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`;
        break;
      case 'missing':
        message = '통화방을 찾을 수 없습니다.';
        break;
      case 'forbidden':
        message = '해당 통화방을 관리할 권한이 없습니다.';
        break;
      default:
        break;
    }
    setRoomManageFeedback(message, 'error');
  }
}

function handleRoomThemeResult(payload) {
  if (!payload || typeof payload.roomId !== 'number') {
    return;
  }
  if (payload.room) {
    handleRoomUpdated(payload.room);
  }
  if (!roomManageOpen || roomManageTargetId !== payload.roomId) {
    return;
  }
  if (payload.success) {
    setRoomManageFeedback('링 색상이 적용되었습니다.', 'success');
  } else {
    if (roomManageRingColorInput) {
      const entry = callRooms.get(payload.roomId);
      roomManageRingColorInput.value = getRoomRingColor(entry ? entry.data : null);
    }
    if (payload.reason === 'forbidden') {
      setRoomManageFeedback('방장만 링 색상을 변경할 수 있습니다.', 'error');
    } else {
      setRoomManageFeedback('링 색상을 변경하지 못했습니다.', 'error');
    }
  }
}

function handleRoomDeleteResult(payload) {
  if (!payload || typeof payload.roomId !== 'number') {
    return;
  }
  if (roomManageTargetId !== payload.roomId) {
    return;
  }
  setRoomManageSubmitting(false);
  if (payload.success) {
    setRoomManageFeedback('통화방이 삭제되었습니다.', 'success');
    closeRoomManageOverlay();
  } else {
    let message = '통화방을 삭제하지 못했습니다.';
    switch (payload.reason) {
      case 'missing':
        message = '통화방을 찾을 수 없습니다.';
        break;
      case 'forbidden':
        message = '삭제 권한이 없습니다.';
        break;
      default:
        break;
    }
    setRoomManageFeedback(message, 'error');
  }
}

function createVoiceMessageElement(messageId) {
  if (!world) {
    return null;
  }
  const element = document.createElement('div');
  element.className = 'voice-message';
  element.dataset.voiceMessageId = String(messageId);

  const bubble = document.createElement('div');
  bubble.className = 'voice-message-bubble';
  element.appendChild(bubble);

  const label = document.createElement('span');
  label.className = 'voice-message-label';
  label.textContent = '음성 메시지';
  element.appendChild(label);

  world.appendChild(element);

  return element;
}

function scheduleVoiceMessageExpiry(entry) {
  if (!entry || !entry.data) {
    return;
  }
  if (entry.expireTimer) {
    window.clearTimeout(entry.expireTimer);
    entry.expireTimer = null;
  }
  const expiresAt = Number(entry.data.expiresAt || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    return;
  }
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) {
    removeVoiceMessage(entry.id);
    return;
  }
  entry.expireTimer = window.setTimeout(() => {
    removeVoiceMessage(entry.id);
  }, Math.min(remaining, VOICE_MESSAGE_TTL_MS));
}

function updateVoiceMessageEntry(entry, data) {
  if (!entry || !data) {
    return;
  }
  entry.data = data;
  const x = Number(data.x);
  const y = Number(data.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    entry.element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }
  if (data.ownerName) {
    entry.element.dataset.ownerName = data.ownerName;
  } else {
    delete entry.element.dataset.ownerName;
  }
  if (data.createdAt) {
    entry.element.dataset.createdAt = String(data.createdAt);
  } else {
    delete entry.element.dataset.createdAt;
  }
  scheduleVoiceMessageExpiry(entry);
}

function ensureVoiceMessage(data) {
  if (!data || typeof data.id !== 'number') {
    return null;
  }
  let entry = voiceMessages.get(data.id);
  if (!entry) {
    const element = createVoiceMessageElement(data.id);
    if (!element) {
      return null;
    }
    entry = {
      id: data.id,
      element,
      data: null,
      audioUrl: null,
      audio: null,
      expireTimer: null,
    };
    voiceMessages.set(data.id, entry);
  }
  updateVoiceMessageEntry(entry, data);
  return entry;
}

function removeVoiceMessage(messageId) {
  const entry = voiceMessages.get(messageId);
  if (!entry) {
    return;
  }
  if (entry.expireTimer) {
    window.clearTimeout(entry.expireTimer);
  }
  if (entry.element) {
    entry.element.remove();
  }
  if (entry.audioUrl) {
    URL.revokeObjectURL(entry.audioUrl);
  }
  voiceMessages.delete(messageId);
}

function pruneVoiceMessages() {
  const now = Date.now();
  voiceMessages.forEach((entry) => {
    if (entry.data && entry.data.expiresAt && entry.data.expiresAt <= now) {
      removeVoiceMessage(entry.id);
    }
  });
}

function playVoiceMessage(messageId) {
  const entry = voiceMessages.get(messageId);
  if (!entry || !entry.data) {
    return;
  }
  if (!entry.data.audio) {
    setStatus('재생할 음성 메시지가 없습니다.');
    return;
  }
  if (!entry.audioUrl) {
    const mimeType = entry.data.mimeType || 'audio/webm';
    const binary = atob(entry.data.audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });
    entry.audioUrl = URL.createObjectURL(blob);
  }
  const audio = entry.audio || new Audio();
  audio.src = entry.audioUrl;
  entry.audio = audio;
  audio
    .play()
    .then(() => {
      setStatus('음성 메시지를 재생 중입니다.');
    })
    .catch((error) => {
      console.error('Failed to play voice message', error);
      setStatus('음성 메시지를 재생할 수 없습니다.');
    });
}

function syncRoomManageRoom(roomData) {
  if (!roomManageOpen || !roomData || roomData.id !== roomManageTargetId) {
    return;
  }
  applyRoomManageData(roomData);
}

function applyRoomInfo(entry) {
  if (!roomInfoCard || !entry || !entry.data) {
    return;
  }
  const name =
    entry.data.name && entry.data.name.trim()
      ? entry.data.name.trim()
      : `통화방 #${entry.id}`;
  if (roomInfoName) {
    roomInfoName.textContent = name;
  }
  const ownerName = resolveDisplayName({
    displayName: entry.data.ownerName,
    userId: entry.data.ownerUserId || entry.data.ownerSessionId,
    id: entry.data.ownerId ?? entry.id,
  });
  if (roomInfoOwner) {
    roomInfoOwner.textContent = ownerName;
  }
  if (roomInfoCreated) {
    roomInfoCreated.textContent = formatRoomTimestamp(entry.data.createdAt);
  }
  if (roomInfoCapacity) {
    roomInfoCapacity.textContent = `${entry.data.capacity}명`;
  }
  if (roomInfoMembers) {
    roomInfoMembers.textContent = `${entry.members.size}명`;
  }
  roomInfoCard.dataset.roomId = String(entry.id);
}

function refreshRoomInfoCard() {
  if (visibleRoomInfoId === null) {
    return;
  }
  const entry = callRooms.get(visibleRoomInfoId);
  if (!entry || !entry.data) {
    closeRoomInfoCard();
    return;
  }
  applyRoomInfo(entry);
}

function openRoomInfoCard(event, entry) {
  if (!game || !roomInfoCard) {
    return;
  }
  if (!entry || !entry.data) {
    closeRoomInfoCard();
    return;
  }
  applyRoomInfo(entry);
  visibleRoomInfoId = entry.id;
  const rect = game.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const width = roomInfoCard.offsetWidth || 240;
  const height = roomInfoCard.offsetHeight || 200;
  let left = localX;
  let top = localY;
  if (left + width > game.clientWidth) {
    left = game.clientWidth - width - 12;
  }
  if (top + height > game.clientHeight) {
    top = game.clientHeight - height - 12;
  }
  left = Math.max(12, left);
  top = Math.max(12, top);
  roomInfoCard.style.left = `${left}px`;
  roomInfoCard.style.top = `${top}px`;
  roomInfoCard.hidden = false;
}

function openRoomContextMenu(event) {
  if (!roomContextMenu || !roomForm || !game) {
    return;
  }
  const coords = getWorldCoordinatesFromEvent(event);
  if (!coords) {
    return;
  }
  pendingRoomPosition = coords;
  roomContextMenu.hidden = false;
  roomContextMenu.classList.add('is-open');
  updateRoomPasswordVisibility();

  const rect = game.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;

  const menuWidth = roomContextMenu.offsetWidth || 240;
  const menuHeight = roomContextMenu.offsetHeight || 200;

  let left = localX;
  let top = localY;

  if (left + menuWidth > game.clientWidth) {
    left = game.clientWidth - menuWidth - 12;
  }
  if (top + menuHeight > game.clientHeight) {
    top = game.clientHeight - menuHeight - 12;
  }
  left = Math.max(12, left);
  top = Math.max(12, top);

  roomContextMenu.style.left = `${left}px`;
  roomContextMenu.style.top = `${top}px`;

  if (roomNameInput) {
    roomNameInput.focus();
    roomNameInput.select();
  } else if (roomCapacityInput) {
    roomCapacityInput.focus();
    roomCapacityInput.select();
  }
}

function handleGlobalPointerDown(event) {
  const target = event.target;
  if (roomContextMenu && !roomContextMenu.hidden && !roomContextMenu.contains(target)) {
    closeRoomContextMenu();
  }
  if (roomInfoCard && !roomInfoCard.hidden && !roomInfoCard.contains(target)) {
    closeRoomInfoCard();
  }
}

function handleEscapeKey(event) {
  if (event.key === 'Escape') {
    closeRoomContextMenu();
    closeRoomInfoCard();
    closeRoomManageOverlay();
    closeSettingsPanel();
  }
}

function handleRoomFormSubmit(event) {
  event.preventDefault();
  if (!gameStarted) {
    closeRoomContextMenu();
    return;
  }
  if (!pendingRoomPosition) {
    if (roomCreateError) {
      roomCreateError.hidden = false;
      roomCreateError.textContent = '생성 위치를 확인할 수 없습니다.';
    }
    return;
  }
  const rawName = roomNameInput ? String(roomNameInput.value || '') : '';
  const normalizedName = rawName.replace(/\s+/g, ' ').trim();
  if (normalizedName.length < ROOM_NAME_MIN_LENGTH) {
    if (roomCreateError) {
      roomCreateError.hidden = false;
      roomCreateError.textContent = `통화방 이름은 최소 ${ROOM_NAME_MIN_LENGTH}자 이상 입력해주세요.`;
    }
    if (roomNameInput) {
      roomNameInput.focus();
      roomNameInput.select();
    }
    return;
  }
  const roomName = normalizedName.slice(0, ROOM_NAME_MAX_LENGTH);
  let visibility = 'public';
  const selectedType = roomTypeInputs.find((input) => input.checked);
  if (selectedType && selectedType.value === 'private') {
    visibility = 'private';
  }
  let capacity = 6;
  if (roomCapacityInput) {
    const parsed = Number(roomCapacityInput.value);
    if (Number.isFinite(parsed)) {
      capacity = Math.min(MAX_PLAYERS, Math.max(1, Math.floor(parsed)));
    }
  }
  let password = '';
  if (visibility === 'private') {
    const rawPassword = roomPasswordInput ? String(roomPasswordInput.value || '') : '';
    const trimmedPassword = rawPassword.trim();
    if (trimmedPassword.length < ROOM_PASSWORD_MIN_LENGTH) {
      if (roomCreateError) {
        roomCreateError.hidden = false;
        roomCreateError.textContent = `비밀번호는 최소 ${ROOM_PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`;
      }
      if (roomPasswordInput) {
        roomPasswordInput.focus();
        roomPasswordInput.select();
      }
      return;
    }
    password = trimmedPassword;
  }
  if (roomCreateError) {
    roomCreateError.hidden = true;
    roomCreateError.textContent = '';
  }
  sendToServer({
    type: 'create-room',
    x: pendingRoomPosition.x,
    y: pendingRoomPosition.y,
    capacity,
    visibility,
    name: roomName,
    password: visibility === 'private' ? password : '',
  });
  closeRoomContextMenu();
  setStatus('새 통화방을 준비하고 있습니다…');
}

function handleGameContextMenu(event) {
  if (!gameStarted) {
    return;
  }
  if (isWithinOverlay(event.target)) {
    return;
  }
  const target = event.target;
  if (target instanceof Element) {
    const roomElement = target.closest('.call-room');
    if (roomElement) {
      event.preventDefault();
      const roomId = Number(roomElement.dataset.roomId);
      if (Number.isFinite(roomId)) {
        const entry = callRooms.get(roomId);
        if (entry) {
          closeRoomContextMenu();
          openRoomInfoCard(event, entry);
          return;
        }
      }
    }
  }
  closeRoomInfoCard();
  event.preventDefault();
  closeRoomContextMenu();
  openRoomContextMenu(event);
}

function safeGetStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn('localStorage get failed', error);
    return null;
  }
}

function safeSetStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn('localStorage set failed', error);
    return false;
  }
}

function safeRemoveStorage(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn('localStorage remove failed', error);
  }
}

function generateSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `sess-${timePart}-${randomPart}`;
}

const RETRYABLE_STATUS = new Set([404, 405, 0, 502, 503, 504]);

async function callJsonApi(
  urls,
  { method = 'POST', payload = null, token = null, allowFallback = true } = {}
) {
  const targets = Array.isArray(urls) ? urls : [urls];
  const headers = { 'Content-Type': 'application/json' };
  const authToken = token || (currentUser && currentUser.authToken);
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  let lastError = null;
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    try {
      const response = await fetch(target, {
        method,
        headers,
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (error) {
          console.warn('Failed to parse JSON response', error);
        }
      }
      if (!response.ok) {
        const message = data && data.error ? data.error : '요청을 처리할 수 없습니다.';
        const canRetry =
          allowFallback && index < targets.length - 1 && RETRYABLE_STATUS.has(response.status);
        if (canRetry) {
          lastError = new Error(message);
          continue;
        }
        throw new Error(message);
      }
      return data;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('서버와 통신할 수 없습니다. 잠시 후 다시 시도해주세요.');
}

function callAuthApi(endpoint, options) {
  return callJsonApi(buildAuthApiUrls(endpoint), options);
}

function loadPersistedSession() {
  const raw = safeGetStorage(AUTH_SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.email === 'string' &&
      typeof parsed.sessionId === 'string' &&
      parsed.sessionId &&
      typeof parsed.authToken === 'string' &&
      parsed.authToken
    ) {
      return {
        id: typeof parsed.id === 'number' ? parsed.id : null,
        email: parsed.email,
        name: typeof parsed.name === 'string' ? parsed.name : '',
        authToken: parsed.authToken,
        sessionId: parsed.sessionId,
      };
    }
  } catch (error) {
    console.warn('Invalid session data', error);
  }
  return null;
}

function persistSession(user) {
  return safeSetStorage(
    AUTH_SESSION_KEY,
    JSON.stringify({
      id: typeof user.id === 'number' ? user.id : null,
      email: user.email,
      name: user.name,
      authToken: user.authToken,
      sessionId: user.sessionId,
    })
  );
}

function clearSessionStorage() {
  safeRemoveStorage(AUTH_SESSION_KEY);
}

function showAuthError(message) {
  if (!authErrorElement) {
    return;
  }
  if (!message) {
    authErrorElement.textContent = '';
    authErrorElement.hidden = true;
  } else {
    authErrorElement.textContent = message;
    authErrorElement.hidden = false;
  }
}

function switchAuthMode(mode) {
  currentAuthMode = mode;
  authTabs.forEach((tab) => {
    const isActive = tab.dataset.authMode === mode;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
  if (loginForm) {
    loginForm.classList.toggle('is-active', mode === 'login');
  }
  if (registerForm) {
    registerForm.classList.toggle('is-active', mode === 'register');
  }
  showAuthError('');
}

function setAuthOverlayVisible(visible) {
  if (!authOverlay || !bodyElement) {
    return;
  }
  if (visible) {
    authOverlay.classList.remove('is-hidden');
    bodyElement.classList.add('auth-locked');
  } else {
    authOverlay.classList.add('is-hidden');
    bodyElement.classList.remove('auth-locked');
  }
}

function applyUserGreeting() {
  if (userGreetingElement) {
    if (currentUser) {
      userGreetingElement.textContent = `${currentUser.name} 님 환영합니다!`;
    } else {
      userGreetingElement.textContent = '로그인 후 입장할 수 있습니다.';
    }
  }
  if (logoutButton) {
    logoutButton.hidden = !currentUser;
    logoutButton.disabled = !currentUser;
  }
  updateSettingsButtons();
}

function updateSettingsButtons() {
  const hasUser = !!currentUser;
  if (settingsButton) {
    settingsButton.hidden = !hasUser;
    settingsButton.disabled = !hasUser;
  }
  const shouldShowStatus = hasUser && activeRoomId !== null;
  if (statusSettingsButton) {
    statusSettingsButton.hidden = !shouldShowStatus;
    statusSettingsButton.disabled = !shouldShowStatus;
  }
}

function showSettingsAccountFeedback(message, variant) {
  if (!settingsAccountFeedback) {
    return;
  }
  settingsAccountFeedback.textContent = message || '';
  settingsAccountFeedback.classList.remove('is-error', 'is-success');
  if (variant === 'error') {
    settingsAccountFeedback.classList.add('is-error');
  } else if (variant === 'success') {
    settingsAccountFeedback.classList.add('is-success');
  }
}

function renderSettingsPanel() {
  if (!settingsOpen) {
    return;
  }
  const hasUser = !!currentUser;
  if (settingsAccountName) {
    settingsAccountName.textContent = hasUser ? currentUser.name : '-';
  }
  if (settingsAccountEmail) {
    settingsAccountEmail.textContent = hasUser ? currentUser.email : '-';
  }
  if (settingsAccountNameInput) {
    settingsAccountNameInput.value = hasUser ? currentUser.name : '';
    settingsAccountNameInput.disabled = !hasUser;
  }
  if (settingsAccountForm) {
    const controls = settingsAccountForm.querySelectorAll('input, button');
    controls.forEach((control) => {
      control.disabled = !hasUser;
    });
  }
  if (!settingsCreatedList || !settingsJoinedList) {
    return;
  }
  const createdEntries = [];
  const joinedEntries = [];
  callRooms.forEach((entry) => {
    if (!entry || !entry.data) {
      return;
    }
    const ownerSessionMatch =
      currentUser &&
      currentUser.sessionId &&
      (entry.data.ownerUserId || entry.data.ownerSessionId) === currentUser.sessionId;
    if (ownerSessionMatch || entry.data.ownerId === clientId) {
      createdEntries.push(entry);
    }
    if (entry.members && entry.members.has(clientId)) {
      joinedEntries.push(entry);
    }
  });

  const getCreatedValue = (entry) => {
    if (entry && entry.data && typeof entry.data.createdAt === 'number') {
      return entry.data.createdAt;
    }
    return 0;
  };

  createdEntries.sort((a, b) => getCreatedValue(b) - getCreatedValue(a));

  joinedEntries.sort((a, b) => {
    const nameA =
      a && a.data && typeof a.data.name === 'string' ? a.data.name.trim().toLowerCase() : '';
    const nameB =
      b && b.data && typeof b.data.name === 'string' ? b.data.name.trim().toLowerCase() : '';
    if (nameA && nameB) {
      return nameA.localeCompare(nameB);
    }
    if (nameA) {
      return -1;
    }
    if (nameB) {
      return 1;
    }
    return (a?.id || 0) - (b?.id || 0);
  });

  const createRoomListItem = (entry, options = {}) => {
    const item = document.createElement('li');
    item.className = 'settings-room-item';
    item.dataset.roomId = String(entry.id);

    const meta = document.createElement('div');
    meta.className = 'settings-room-meta';

    const nameElement = document.createElement('span');
    nameElement.className = 'settings-room-name';
    const displayName =
      entry.data && entry.data.name && entry.data.name.trim()
        ? entry.data.name.trim()
        : `통화방 #${entry.id}`;
    nameElement.textContent = displayName;
    meta.appendChild(nameElement);

    const details = document.createElement('span');
    details.className = 'settings-room-details';
    const typeLabel = entry.data && entry.data.type === 'private' ? '개인' : '공개';
    const capacityValue =
      entry.data && typeof entry.data.capacity === 'number' ? entry.data.capacity : null;
    const occupancyLabel =
      capacityValue !== null ? `${entry.members.size}/${capacityValue}명` : `${entry.members.size}명`;
    const detailParts = [typeLabel, occupancyLabel];
    if (entry.data && entry.data.createdAt) {
      const createdLabel = formatRoomTimestamp(entry.data.createdAt);
      if (createdLabel && createdLabel !== '-') {
        detailParts.push(`생성 ${createdLabel}`);
      }
    }
    details.textContent = detailParts.join(' · ');
    meta.appendChild(details);

    item.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'settings-room-actions';

    const manageButton = document.createElement('button');
    manageButton.type = 'button';
    manageButton.className = 'ghost-button';
    if (options.infoAction === 'manage') {
      manageButton.dataset.roomManage = String(entry.id);
    } else {
      manageButton.dataset.roomInfo = String(entry.id);
    }
    manageButton.textContent = options.infoLabel || '정보';
    actions.appendChild(manageButton);

    if (options.includeLeave) {
      const leaveButton = document.createElement('button');
      leaveButton.type = 'button';
      leaveButton.className = 'ghost-button';
      leaveButton.dataset.roomLeave = String(entry.id);
      leaveButton.textContent = '나가기';
      actions.appendChild(leaveButton);
    }

    item.appendChild(actions);
    return item;
  };

  settingsCreatedList.innerHTML = '';
  createdEntries.forEach((entry) => {
    settingsCreatedList.appendChild(
      createRoomListItem(entry, { infoLabel: '관리', infoAction: 'manage' })
    );
  });

  settingsJoinedList.innerHTML = '';
  joinedEntries.forEach((entry) => {
    settingsJoinedList.appendChild(
      createRoomListItem(entry, { infoLabel: '정보', includeLeave: true })
    );
  });

  if (settingsCreatedCount) {
    settingsCreatedCount.textContent = String(createdEntries.length);
  }
  if (settingsJoinedCount) {
    settingsJoinedCount.textContent = String(joinedEntries.length);
  }
  if (settingsCreatedEmpty) {
    settingsCreatedEmpty.hidden = createdEntries.length > 0;
  }
  if (settingsJoinedEmpty) {
    settingsJoinedEmpty.hidden = joinedEntries.length > 0;
  }
}

function refreshSettingsData() {
  if (settingsOpen) {
    renderSettingsPanel();
  }
}

function openSettingsPanel(trigger) {
  if (!currentUser) {
    setStatus('로그인 후 이용 가능합니다.');
    return;
  }
  if (!settingsOverlay || !settingsDialog) {
    return;
  }
  lastSettingsTrigger = trigger instanceof HTMLElement ? trigger : null;
  settingsOverlay.hidden = false;
  settingsOverlay.setAttribute('aria-hidden', 'false');
  settingsOpen = true;
  if (bodyElement) {
    bodyElement.classList.add('settings-open');
  }
  showSettingsAccountFeedback('');
  renderSettingsPanel();
  window.requestAnimationFrame(() => {
    if (settingsDialog) {
      settingsDialog.focus();
    }
  });
}

function closeSettingsPanel() {
  if (!settingsOverlay || !settingsOpen) {
    return;
  }
  settingsOverlay.hidden = true;
  settingsOverlay.setAttribute('aria-hidden', 'true');
  settingsOpen = false;
  if (bodyElement) {
    bodyElement.classList.remove('settings-open');
  }
  closeRoomManageOverlay();
  showSettingsAccountFeedback('');
  const trigger = lastSettingsTrigger;
  lastSettingsTrigger = null;
  if (trigger && typeof trigger.focus === 'function') {
    trigger.focus();
  }
}

function handleSettingsOverlayClick(event) {
  if (!(event.target instanceof Element)) {
    return;
  }
  if (
    event.target.hasAttribute('data-settings-close') ||
    event.target.classList.contains('settings-backdrop')
  ) {
    closeSettingsPanel();
    return;
  }
  const manageButton = event.target.closest('[data-room-manage]');
  if (manageButton) {
    const roomId = Number(manageButton.getAttribute('data-room-manage'));
    if (Number.isFinite(roomId)) {
      const trigger = manageButton instanceof HTMLElement ? manageButton : null;
      openRoomManageOverlayForRoom(roomId, trigger);
    }
    return;
  }
  const infoButton = event.target.closest('[data-room-info]');
  if (infoButton) {
    const roomId = Number(infoButton.getAttribute('data-room-info'));
    if (Number.isFinite(roomId)) {
      const entry = callRooms.get(roomId);
      if (entry && entry.data) {
        closeSettingsPanel();
        openRoomInfoFromSettings(entry);
      }
    }
    return;
  }
  const leaveButton = event.target.closest('[data-room-leave]');
  if (leaveButton) {
    const roomId = Number(leaveButton.getAttribute('data-room-leave'));
    if (Number.isFinite(roomId)) {
      closeSettingsPanel();
      requestLeaveRoom(roomId);
    }
  }
}

async function handleSettingsAccountSubmit(event) {
  event.preventDefault();
  if (!currentUser) {
    showSettingsAccountFeedback('로그인 후 이용해주세요.', 'error');
    return;
  }
  const rawValue = settingsAccountNameInput ? settingsAccountNameInput.value : '';
  const normalized = typeof rawValue === 'string' ? rawValue.replace(/\s+/g, ' ').trim() : '';
  if (!normalized || normalized.length < 2) {
    showSettingsAccountFeedback('닉네임은 2자 이상 입력해주세요.', 'error');
    if (settingsAccountNameInput) {
      settingsAccountNameInput.focus();
      settingsAccountNameInput.select();
    }
    return;
  }
  showSettingsAccountFeedback('닉네임을 저장 중입니다…', 'pending');
  try {
    const response = await callAuthApi('/profile', {
      method: 'PUT',
      payload: { name: normalized },
    });
    const updatedName =
      response && response.user && response.user.displayName
        ? response.user.displayName
        : normalized;
    currentUser = { ...currentUser, name: updatedName };
    if (!persistSession(currentUser)) {
      console.warn('Failed to persist updated session');
    }
    applyUserGreeting();
    renderSettingsPanel();
    if (socket && socket.readyState === WebSocket.OPEN) {
      sendToServer({ type: 'identify', name: updatedName });
    }
    showSettingsAccountFeedback('닉네임이 저장되었습니다.', 'success');
    setStatus('닉네임이 업데이트되었습니다.');
  } catch (error) {
    showSettingsAccountFeedback(error.message || '닉네임을 저장할 수 없습니다.', 'error');
  }
}

function openRoomInfoFromSettings(entry) {
  if (!roomInfoCard || !entry || !entry.data) {
    return;
  }
  applyRoomInfo(entry);
  visibleRoomInfoId = entry.id;
  roomInfoCard.style.left = '24px';
  roomInfoCard.style.top = '24px';
  roomInfoCard.hidden = false;
}

function computeServerUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const hostname = window.location.hostname || 'localhost';
  const portSegment = ':3000';
  return `${protocol}://${hostname}${portSegment}`;
}

const SERVER_URL = computeServerUrl();

function setStatus(message) {
  if (statusElement) {
    statusElement.textContent = message;
  }
}

function updatePopulation(count) {
  if (populationElement) {
    populationElement.textContent = `${count} / ${MAX_PLAYERS}명 접속 중`;
  }
  if (mainServerInfo) {
    mainServerInfo.textContent = `정원 ${MAX_PLAYERS}명 · 현재 ${count}명`;
  }
  if (mainServerEntry) {
    mainServerEntry.setAttribute(
      'aria-label',
      `메인 서버, 정원 ${MAX_PLAYERS}명, 현재 ${count}명`
    );
  }
}

function updateMicButtonState(active) {
  if (!micButton) {
    return;
  }
  if (!micAccessEnabled) {
    micButton.textContent = '로그인 후 마이크 사용';
    micButton.disabled = true;
    return;
  }
  if (active) {
    micButton.textContent = micMuted ? '🔇 음소거됨' : '🎧 마이크 연결됨';
    micButton.disabled = false;
  } else {
    micButton.textContent = '🎙️ 마이크 연결';
    micButton.disabled = false;
  }
}

function lockMicButton() {
  micAccessEnabled = false;
  updateMicButtonState(false);
}

function unlockMicButton() {
  micAccessEnabled = true;
  updateMicButtonState(!!localStream);
}

function setMicMutedState(shouldMute) {
  if (!localStream) {
    micMuted = false;
    updateMicButtonState(false);
    return;
  }
  micMuted = Boolean(shouldMute);
  const tracks = localStream.getAudioTracks();
  tracks.forEach((track) => {
    track.enabled = !micMuted;
  });
  updateMicButtonState(true);
}

function toggleMicMutedState() {
  if (!localStream) {
    return;
  }
  setMicMutedState(!micMuted);
  setStatus(micMuted ? '마이크가 음소거되었습니다.' : '마이크 음소거가 해제되었습니다.');
}

function handlePlayerPressStart() {
  if (!micAccessEnabled) {
    setStatus('로그인 후에 마이크를 사용할 수 있습니다.');
    return;
  }
  if (voiceMessageRecording) {
    return;
  }
  registerActivity();
  if (player) {
    player.classList.add('is-holding');
  }
  if (voiceMessageStartTimer) {
    window.clearTimeout(voiceMessageStartTimer);
  }
  voiceMessageStartTimer = window.setTimeout(async () => {
    voiceMessageStartTimer = null;
    if (player) {
      player.classList.remove('is-holding');
    }
    if (!localStream) {
      try {
        await startMicrophone();
      } catch (error) {
        return;
      }
    }
    startVoiceMessageRecording();
  }, VOICE_MESSAGE_HOLD_MS);
}

function handlePlayerPressEnd() {
  if (voiceMessageStartTimer) {
    window.clearTimeout(voiceMessageStartTimer);
    voiceMessageStartTimer = null;
  }
  if (player) {
    player.classList.remove('is-holding');
  }
}

function handleVoiceMessageDropStart(event) {
  if (!voiceMessageRecording || !game) {
    return;
  }
  event.preventDefault();
  registerActivity();
  voiceMessageDropActive = true;
  voiceMessageDropPosition = getWorldCoordinatesFromEvent(event);
}

function handleVoiceMessageDropMove(event) {
  if (!voiceMessageDropActive) {
    return;
  }
  registerActivity();
  voiceMessageDropPosition = getWorldCoordinatesFromEvent(event);
}

function handleVoiceMessageDropEnd() {
  if (!voiceMessageDropActive) {
    return;
  }
  voiceMessageDropActive = false;
  stopVoiceMessageRecording();
}

function ensureAudioContext() {
  if (audioContext) {
    return audioContext;
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return null;
  }
  audioContext = new AudioCtx();
  return audioContext;
}

function createWaveBars(container) {
  const bars = [];
  if (!container) {
    return bars;
  }
  container.innerHTML = '';
  for (let i = 0; i < WAVE_BAR_COUNT; i += 1) {
    const bar = document.createElement('div');
    bar.className = 'wave-bar';
    container.appendChild(bar);
    bars.push(bar);
  }
  return bars;
}

function applyWaveLevel(bars, level) {
  const normalized = Math.min(1, Math.max(0, 0.25 + level * 0.75));
  const count = bars.length;
  for (let i = 0; i < count; i += 1) {
    const bar = bars[i];
    const ratio = count <= 1 ? 0 : i / (count - 1);
    const distanceFromCenter = Math.abs(ratio - 0.5) * 2;
    const influence = 1 - Math.pow(distanceFromCenter, 1.6);
    const height = 28 + normalized * influence * 96;
    const opacity = 0.35 + normalized * influence * 0.55;
    bar.style.setProperty('--bar-height', `${height.toFixed(2)}px`);
    bar.style.setProperty('--bar-opacity', opacity.toFixed(2));
  }
}

function updateWorldTransform() {
  if (!game || !world) {
    return;
  }
  const offsetX = game.clientWidth / 2 - position.x;
  const offsetY = game.clientHeight / 2 - position.y;
  world.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
}

function applyPosition() {
  if (!player) {
    return;
  }
  player.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
  updateWorldTransform();
}

function calculateRoomRadius(capacity, memberCount) {
  const safeCapacity = Math.max(1, Number.isFinite(capacity) ? capacity : 1);
  const occupants = Math.min(safeCapacity, Math.max(0, Number.isFinite(memberCount) ? memberCount : 0));
  const occupancyRatio = occupants / safeCapacity;
  const growth = occupancyRatio * CALL_ROOM_GROWTH_RATIO;
  return Math.min(CALL_ROOM_MAX_RADIUS, CALL_ROOM_BASE_RADIUS * (1 + growth));
}

function createCallRoomElement(roomId) {
  if (!world) {
    return null;
  }
  const element = document.createElement('div');
  element.className = 'call-room';
  element.dataset.roomId = String(roomId);
  element.style.setProperty('--call-room-size', `${CALL_ROOM_BASE_RADIUS * 2}px`);

  const bubble = document.createElement('div');
  bubble.className = 'call-room-bubble';

  const sheen = document.createElement('span');
  sheen.className = 'call-room-sheen';
  bubble.appendChild(sheen);

  const core = document.createElement('span');
  core.className = 'call-room-core';
  bubble.appendChild(core);

  const count = document.createElement('span');
  count.className = 'call-room-count';
  bubble.appendChild(count);

  element.appendChild(bubble);

  const prompt = document.createElement('div');
  prompt.className = 'call-room-prompt';

  const title = document.createElement('h3');
  title.className = 'call-room-title';
  title.textContent = '새 통화방';
  prompt.appendChild(title);

  const message = document.createElement('p');
  message.className = 'call-room-message';
  message.textContent = '서버에 가입 하시겠습니까?';
  prompt.appendChild(message);

  const passwordWrapper = document.createElement('label');
  passwordWrapper.className = 'call-room-password';
  passwordWrapper.hidden = true;

  const passwordLabel = document.createElement('span');
  passwordLabel.textContent = '비밀번호';
  passwordWrapper.appendChild(passwordLabel);

  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.placeholder = '비밀번호 입력';
  passwordInput.autocomplete = 'off';
  passwordWrapper.appendChild(passwordInput);

  prompt.appendChild(passwordWrapper);

  const actions = document.createElement('div');
  actions.className = 'call-room-actions';

  const joinButton = document.createElement('button');
  joinButton.type = 'button';
  joinButton.dataset.roomJoin = String(roomId);
  joinButton.className = 'call-room-join primary-action';
  joinButton.textContent = '참여하기';
  actions.appendChild(joinButton);

  prompt.appendChild(actions);

  element.appendChild(prompt);

  world.appendChild(element);

  const entry = {
    id: roomId,
    element,
    bubble,
    count,
    prompt,
    title,
    message,
    joinButton,
    passwordWrapper,
    passwordInput,
    members: new Set(),
    data: null,
    isPlayerInside: false,
    radius: CALL_ROOM_BASE_RADIUS,
    roles: [],
    ringOverlay: null,
  };

  if (typeof window.RoomRingOverlay === 'function') {
    entry.ringOverlay = new window.RoomRingOverlay();
    entry.ringOverlay.mount(element);
  }

  passwordInput.addEventListener('input', () => {
    updateRoomPrompt(entry);
  });
  return entry;
}

function ensureCallRoom(roomData) {
  if (!roomData || typeof roomData.id !== 'number') {
    return null;
  }
  let entry = callRooms.get(roomData.id);
  if (!entry) {
    entry = createCallRoomElement(roomData.id);
    if (!entry) {
      return null;
    }
    callRooms.set(roomData.id, entry);
  }
  return entry;
}

function setActiveRoom(newRoomId) {
  if (activeRoomId === newRoomId) {
    return;
  }
  activeRoomId = newRoomId;
  if (newRoomId === null) {
    playerRoomMembership.delete(clientId);
  } else if (clientId !== null) {
    playerRoomMembership.set(clientId, newRoomId);
  }
  updatePeerConnections();
  callRooms.forEach((entry) => {
    updateRoomPrompt(entry);
    entry.element.classList.toggle('is-joined', entry.id === activeRoomId);
  });
  updateSettingsButtons();
  refreshSettingsData();
}

function updateRoomAria(entry) {
  if (!entry || !entry.element || !entry.data) {
    return;
  }
  const name =
    entry.data.name && entry.data.name.trim()
      ? entry.data.name.trim()
      : `통화방 #${entry.id}`;
  const visibility = entry.data.type === 'private' ? '개인' : '공개';
  const ownerLabel =
    entry.data.ownerId === clientId ? '내가 만든 통화방' : '다른 플레이어 통화방';
  const ownerName = resolveDisplayName({
    displayName: entry.data.ownerName,
    userId: entry.data.ownerUserId || entry.data.ownerSessionId,
    id: entry.data.ownerId ?? entry.id,
  });
  entry.element.setAttribute(
    'aria-label',
    `${name}, ${visibility} 통화방, 방장 ${ownerName}, ${ownerLabel}, 정원 ${entry.data.capacity}명, 현재 ${entry.members.size}명`
  );
}

function updateCallRoomEntry(entry, roomData) {
  if (!entry || !roomData) {
    return;
  }
  entry.data = roomData;
  const roles = Array.isArray(roomData.roles)
    ? roomData.roles.slice(0, ROOM_ROLE_MAX)
    : [];
  entry.roles = roles;
  if (entry.data) {
    entry.data.roles = roles;
  }
  if (entry.title) {
    const displayName =
      roomData.name && roomData.name.trim() ? roomData.name.trim() : `통화방 #${roomData.id}`;
    entry.title.textContent = displayName;
  }
  if (entry.element) {
    if (roomData.name) {
      entry.element.dataset.roomName = roomData.name;
    } else {
      delete entry.element.dataset.roomName;
    }
    if (roomData.ownerName) {
      entry.element.dataset.ownerName = roomData.ownerName;
    } else {
      delete entry.element.dataset.ownerName;
    }
    if (roomData.createdAt) {
      entry.element.dataset.createdAt = String(roomData.createdAt);
    } else {
      delete entry.element.dataset.createdAt;
    }
  }

  const previousMembers = entry.members;
  const nextMembers = new Set(Array.isArray(roomData.members) ? roomData.members : []);
  entry.members = nextMembers;
  entry.count.textContent = `${nextMembers.size}/${roomData.capacity}`;
  entry.element.dataset.visibility = roomData.type === 'private' ? 'private' : 'public';
  entry.element.classList.toggle('is-owner', roomData.ownerId === clientId);

  const radius = calculateRoomRadius(roomData.capacity, nextMembers.size);
  entry.radius = radius;
  entry.element.style.setProperty('--call-room-size', `${(radius * 2).toFixed(2)}px`);
  entry.element.style.transform = `translate3d(${(roomData.x - radius).toFixed(2)}px, ${(roomData.y - radius).toFixed(2)}px, 0)`;
  if (entry.ringOverlay) {
    entry.ringOverlay.setColor(getRoomRingColor(roomData));
    entry.ringOverlay.setActive(nextMembers.size > 0);
  }

  nextMembers.forEach((memberId) => {
    playerRoomMembership.set(memberId, roomData.id);
    if (memberId !== clientId) {
      const remote = remotePlayers.get(memberId);
      if (remote) {
        remote.roomId = roomData.id;
      }
    }
  });

  previousMembers.forEach((memberId) => {
    if (!nextMembers.has(memberId)) {
      if (playerRoomMembership.get(memberId) === roomData.id) {
        playerRoomMembership.delete(memberId);
      }
      if (memberId !== clientId) {
        const remote = remotePlayers.get(memberId);
        if (remote && remote.roomId === roomData.id) {
          remote.roomId = null;
        }
      }
    }
  });

  if (nextMembers.has(clientId)) {
    setActiveRoom(roomData.id);
  } else if (activeRoomId === roomData.id) {
    setActiveRoom(null);
  }

  updateRoomPrompt(entry);
  updateRoomAria(entry);
  refreshRoomInfoCard();
  updatePeerConnections();
  refreshSettingsData();
}

function updateRoomPrompt(entry) {
  if (!entry || !entry.data) {
    return;
  }
  const isMember = entry.members.has(clientId);
  const isOwner = entry.data.ownerId === clientId;
  const isPrivate = entry.data.type === 'private' && !isOwner;
  const isFull = entry.members.size >= entry.data.capacity;
  const inAnotherRoom = activeRoomId !== null && activeRoomId !== entry.id;
  const isPending = pendingJoinRoomId === entry.id;

  const roomName =
    entry.data.name && entry.data.name.trim()
      ? entry.data.name.trim()
      : '통화방';
  let message = `${roomName}에 참여하시겠습니까?`;
  let joinEnabled = true;
  let joinLabel = '참여하기';
  const shouldShowPassword = isPrivate && !isMember;
  let hasValidPassword = true;
  if (entry.passwordWrapper) {
    entry.passwordWrapper.hidden = !shouldShowPassword;
  }
  if (shouldShowPassword && entry.passwordInput) {
    const trimmed = entry.passwordInput.value.trim();
    hasValidPassword = trimmed.length >= ROOM_PASSWORD_MIN_LENGTH;
    if (!hasValidPassword && !isPending) {
      message = `비밀번호를 입력하면 참여할 수 있습니다.`;
    }
  } else if (!shouldShowPassword && entry.passwordInput) {
    entry.passwordInput.value = '';
  }
  if (isPending) {
    message = '참여 요청을 보내는 중입니다…';
    joinEnabled = false;
  } else if (isMember) {
    message = '통화방에 참여중입니다.';
    joinEnabled = false;
    joinLabel = '참여중';
  } else if (isFull) {
    message = '정원이 가득 찼습니다.';
    joinEnabled = false;
  } else if (inAnotherRoom) {
    message = '다른 통화방에 참여중입니다.';
    joinEnabled = false;
  } else if (shouldShowPassword) {
    joinLabel = '입장하기';
    joinEnabled = hasValidPassword;
  } else if (isOwner && entry.data.type === 'private') {
    message = '내가 만든 개인 통화방입니다.';
  }

  entry.message.textContent = message;
  entry.joinButton.textContent = joinLabel;
  entry.joinButton.disabled = !joinEnabled;
  entry.joinButton.classList.toggle('is-disabled', !joinEnabled);
  entry.joinButton.dataset.roomJoin = String(entry.id);
}

function removeCallRoom(roomId) {
  const entry = callRooms.get(roomId);
  if (!entry) {
    return;
  }
  if (entry.members) {
    entry.members.forEach((memberId) => {
      if (playerRoomMembership.get(memberId) === roomId) {
        playerRoomMembership.delete(memberId);
      }
      if (memberId !== clientId) {
        const remote = remotePlayers.get(memberId);
        if (remote && remote.roomId === roomId) {
          remote.roomId = null;
        }
      }
    });
  }
  if (entry.element) {
    if (entry.ringOverlay) {
      entry.ringOverlay.destroy();
      entry.ringOverlay = null;
    }
    entry.element.remove();
  }
  callRooms.delete(roomId);
  if (activeRoomId === roomId) {
    setActiveRoom(null);
  }
  if (visibleRoomInfoId === roomId) {
    closeRoomInfoCard();
  }
  refreshSettingsData();
}

function clearRooms() {
  callRooms.forEach((entry) => {
    if (entry.ringOverlay) {
      entry.ringOverlay.destroy();
      entry.ringOverlay = null;
    }
    if (entry.element) {
      entry.element.remove();
    }
  });
  callRooms.clear();
  roomUnderPlayerId = null;
  setActiveRoom(null);
  pendingJoinRoomId = null;
  closeRoomInfoCard();
  refreshSettingsData();
}

function requestJoinRoom(roomId) {
  if (!gameStarted || !socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  if (pendingJoinRoomId === roomId) {
    return;
  }
  const entry = callRooms.get(roomId);
  let password = null;
  if (entry && entry.data) {
    const needsPassword =
      entry.data.type === 'private' && entry.data.ownerId !== clientId && !entry.members.has(clientId);
    if (needsPassword) {
      const value = entry.passwordInput ? entry.passwordInput.value.trim() : '';
      if (value.length < ROOM_PASSWORD_MIN_LENGTH) {
        setStatus('비밀번호를 입력한 후 다시 시도해주세요.');
        if (entry.passwordInput) {
          entry.passwordInput.focus();
          entry.passwordInput.select();
        }
        return;
      }
      password = value;
    }
  }
  pendingJoinRoomId = roomId;
  const payload = { type: 'room-join', roomId };
  if (password !== null) {
    payload.password = password;
  }
  sendToServer(payload);
  if (entry) {
    updateRoomPrompt(entry);
  }
}

function requestLeaveRoom(roomId) {
  if (roomId === null) {
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    setActiveRoom(null);
    return;
  }
  if (pendingJoinRoomId === roomId) {
    pendingJoinRoomId = null;
  }
  if (activeRoomId === roomId) {
    setActiveRoom(null);
  }
  sendToServer({ type: 'room-leave', roomId });
}

function closePeerConnection(remoteId) {
  const state = peerStates.get(remoteId);
  if (state) {
    try {
      state.pc.close();
    } catch (error) {
      /* ignore */
    }
    peerStates.delete(remoteId);
  }
  const audio = audioElements.get(remoteId);
  if (audio) {
    audio.srcObject = null;
    audio.remove();
    audioElements.delete(remoteId);
  }
  const remote = remotePlayers.get(remoteId);
  if (remote) {
    remote.analyser = null;
    remote.dataArray = null;
  }
}

function shouldConnectToRemote(remoteId) {
  if (activeRoomId === null) {
    return false;
  }
  return playerRoomMembership.get(remoteId) === activeRoomId;
}

function updatePeerConnections() {
  remotePlayers.forEach((remote) => {
    const shouldConnect = shouldConnectToRemote(remote.id);
    const hasPeer = peerStates.has(remote.id);
    if (shouldConnect) {
      const state = ensurePeerState(remote.id);
      if (!state) {
        return;
      }
      if (!state.inCall) {
        state.inCall = true;
        attachLocalStreamToPeer(state.pc);
        initiateOffer(remote.id).catch((error) => {
          console.error('Offer negotiation failed', error);
        });
      }
    } else if (hasPeer) {
      closePeerConnection(remote.id);
    }
  });
}

function updateRoomPresence() {
  if (!gameStarted) {
    return;
  }
  let nearestRoomId = null;
  let nearestDistance = Infinity;
  callRooms.forEach((entry) => {
    if (!entry.data) {
      entry.isPlayerInside = false;
      entry.element.classList.remove('is-hovered');
      return;
    }
    const dx = position.x - entry.data.x;
    const dy = position.y - entry.data.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const radius = entry.radius || CALL_ROOM_BASE_RADIUS;
    const isInside = distance <= radius * 0.9;
    entry.isPlayerInside = isInside;
    if (isInside && distance < nearestDistance) {
      nearestDistance = distance;
      nearestRoomId = entry.id;
    }
  });

  if (roomUnderPlayerId !== nearestRoomId) {
    roomUnderPlayerId = nearestRoomId;
    callRooms.forEach((entry) => {
      const hovered = entry.id === roomUnderPlayerId;
      entry.element.classList.toggle('is-hovered', hovered);
      if (hovered) {
        updateRoomPrompt(entry);
      }
    });
  }

  if (activeRoomId !== null) {
    const activeEntry = callRooms.get(activeRoomId);
    if (activeEntry && !activeEntry.isPlayerInside) {
      requestLeaveRoom(activeRoomId);
    }
  }
}

function handleRoomCreated(roomData) {
  if (!roomData) {
    return;
  }
  const entry = ensureCallRoom(roomData);
  if (!entry) {
    return;
  }
  updateCallRoomEntry(entry, roomData);
  syncRoomManageRoom(roomData);
}

function handleRoomUpdated(roomData) {
  if (!roomData) {
    return;
  }
  const entry = ensureCallRoom(roomData);
  if (!entry) {
    return;
  }
  updateCallRoomEntry(entry, roomData);
}

function handleWorldClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const messageTarget = target.closest('.voice-message');
  if (messageTarget) {
    const messageId = Number(messageTarget.dataset.voiceMessageId);
    if (Number.isFinite(messageId)) {
      playVoiceMessage(messageId);
    }
    return;
  }
  const joinButton = target.closest('[data-room-join]');
  if (joinButton) {
    event.preventDefault();
    const roomId = Number(joinButton.dataset.roomJoin);
    if (Number.isFinite(roomId)) {
      requestJoinRoom(roomId);
    }
    return;
  }
}

function ensureRemotePlayer(id) {
  if (remotePlayers.has(id)) {
    return remotePlayers.get(id);
  }
  if (!world) {
    return null;
  }
  const element = document.createElement('div');
  element.className = 'avatar remote';
  element.dataset.id = String(id);

  const face = document.createElement('div');
  face.className = 'avatar-face';
  const eyeLeft = document.createElement('div');
  eyeLeft.className = 'avatar-eye';
  const eyeRight = document.createElement('div');
  eyeRight.className = 'avatar-eye';
  face.appendChild(eyeLeft);
  face.appendChild(eyeRight);
  element.appendChild(face);

  const wave = document.createElement('div');
  wave.className = 'wave';
  element.appendChild(wave);

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = resolveDisplayName({ id, userId: id });
  element.appendChild(label);

  world.appendChild(element);

  const waveBars = createWaveBars(wave);

  const remote = {
    id,
    element,
    waveBars,
    position: { x: 0, y: 0 },
    level: 0.18,
    analyser: null,
    dataArray: null,
    roomId: null,
    displayName: '',
    userId: null,
    label,
  };
  remotePlayers.set(id, remote);
  return remote;
}

function updateRemoteAvatar(remote) {
  remote.element.style.transform = `translate3d(${remote.position.x}px, ${remote.position.y}px, 0)`;
}

function updateRemoteLabel(remote) {
  if (!remote || !remote.label) {
    return;
  }
  remote.label.textContent = resolveDisplayName({
    displayName: remote.displayName,
    userId: remote.userId,
    id: remote.id,
  });
}

function removeRemotePlayer(id) {
  const remote = remotePlayers.get(id);
  if (remote) {
    remote.element.remove();
    remotePlayers.delete(id);
  }
  closePeerConnection(id);
  playerRoomMembership.delete(id);
}

function resetRemoteState() {
  peerStates.forEach((state) => {
    try {
      state.pc.close();
    } catch (error) {
      /* ignore */
    }
  });
  peerStates.clear();
  audioElements.forEach((audio) => {
    audio.srcObject = null;
    audio.remove();
  });
  audioElements.clear();
  remotePlayers.forEach((remote) => {
    remote.element.remove();
  });
  remotePlayers.clear();
  playerRoomMembership.clear();
  clearRooms();
  updatePopulation(0);
}

function sendToServer(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function scheduleReconnect() {
  if (!gameStarted) {
    return;
  }
  if (reconnectTimer) {
    return;
  }
  const delay = 3000 + Math.floor(Math.random() * 2000);
  const seconds = Math.round(delay / 1000);
  setStatus(`서버 연결이 종료되었습니다. ${seconds}초 후 다시 시도합니다…`);
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectToServer();
  }, delay);
}

function ensurePeerState(remoteId) {
  if (peerStates.has(remoteId)) {
    return peerStates.get(remoteId);
  }

  const pc = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
  });

  const state = {
    pc,
    makingOffer: false,
    ignoreOffer: false,
    isSettingRemoteAnswerPending: false,
    polite: clientId !== null ? clientId < remoteId : true,
    inCall: false,
  };

  pc.addEventListener('icecandidate', (event) => {
    if (event.candidate) {
      sendToServer({
        type: 'signal',
        to: remoteId,
        data: { candidate: event.candidate },
      });
    }
  });

  pc.addEventListener('track', (event) => {
    const [stream] = event.streams;
    if (!stream) {
      return;
    }
    handleRemoteStream(remoteId, stream);
  });

  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      removeRemotePlayer(remoteId);
    }
  });

  pc.addEventListener('negotiationneeded', () => {
    initiateOffer(remoteId).catch((error) => {
      console.error('Offer negotiation failed', error);
    });
  });

  attachLocalStreamToPeer(pc);

  peerStates.set(remoteId, state);
  return state;
}

async function initiateOffer(remoteId) {
  const state = ensurePeerState(remoteId);
  if (!state) {
    return;
  }
  const { pc } = state;
  try {
    state.makingOffer = true;
    const offer = await pc.createOffer();
    if (pc.signalingState !== 'stable') {
      return;
    }
    await pc.setLocalDescription(offer);
    sendToServer({
      type: 'signal',
      to: remoteId,
      data: { description: pc.localDescription },
    });
  } catch (error) {
    console.error('createOffer failed', error);
  } finally {
    state.makingOffer = false;
  }
}

async function handleSignalMessage(from, payload) {
  if (!shouldConnectToRemote(from)) {
    closePeerConnection(from);
    return;
  }
  const state = ensurePeerState(from);
  const { pc } = state;
  if (!pc) {
    return;
  }

  if (payload.description) {
    const description = payload.description;
    const readyForOffer =
      !state.makingOffer &&
      (pc.signalingState === 'stable' || state.isSettingRemoteAnswerPending);
    const offerCollision = description.type === 'offer' && !readyForOffer;

    state.ignoreOffer = !state.polite && offerCollision;
    if (state.ignoreOffer) {
      return;
    }

    state.isSettingRemoteAnswerPending = description.type === 'offer';
    try {
      await pc.setRemoteDescription(description);
      state.isSettingRemoteAnswerPending = false;
      if (description.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendToServer({
          type: 'signal',
          to: from,
          data: { description: pc.localDescription },
        });
      }
    } catch (error) {
      console.error('Error handling description', error);
    }
    return;
  }

  if (payload.candidate) {
    try {
      await pc.addIceCandidate(payload.candidate);
    } catch (error) {
      if (!state.ignoreOffer) {
        console.error('Error adding ICE candidate', error);
      }
    }
  }
}

function attachLocalStreamToPeer(pc) {
  if (!localStream) {
    return;
  }
  const tracks = localStream.getAudioTracks();
  tracks.forEach((track) => {
    const alreadyAdded = pc
      .getSenders()
      .some((sender) => sender.track && sender.track.id === track.id);
    if (!alreadyAdded) {
      pc.addTrack(track, localStream);
    }
  });
}

function attachLocalStreamToPeers() {
  peerStates.forEach((state) => {
    attachLocalStreamToPeer(state.pc);
  });
}

function handleRemoteStream(remoteId, stream) {
  const remote = ensureRemotePlayer(remoteId);
  if (!remote) {
    return;
  }
  let audio = audioElements.get(remoteId);
  if (!audio) {
    audio = document.createElement('audio');
    audio.autoplay = true;
    audio.playsInline = true;
    if (audioLayer) {
      audioLayer.appendChild(audio);
    }
    audioElements.set(remoteId, audio);
  }
  audio.srcObject = stream;

  const context = ensureAudioContext();
  if (!context) {
    remote.analyser = null;
    remote.dataArray = null;
    return;
  }

  try {
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    const array = new Uint8Array(analyser.fftSize);
    source.connect(analyser);
    remote.analyser = analyser;
    remote.dataArray = array;
  } catch (error) {
    console.error('Remote audio analysis failed', error);
    remote.analyser = null;
    remote.dataArray = null;
  }
}

function updateRemoteLevel(remote) {
  if (!remote.analyser || !remote.dataArray) {
    return remote.level;
  }
  remote.analyser.getByteTimeDomainData(remote.dataArray);
  let sumSquares = 0;
  for (let i = 0; i < remote.dataArray.length; i += 1) {
    const value = (remote.dataArray[i] - 128) / 128;
    sumSquares += value * value;
  }
  const rms = Math.sqrt(sumSquares / remote.dataArray.length);
  const target = Math.min(1, rms * 6);
  remote.level = remote.level * 0.82 + target * 0.18;
  return remote.level;
}

function updateWaveVisual() {
  let targetLevel = 0.12;
  if (localAnalyser && localDataArray) {
    localAnalyser.getByteTimeDomainData(localDataArray);
    let sumSquares = 0;
    for (let i = 0; i < localDataArray.length; i += 1) {
      const value = (localDataArray[i] - 128) / 128;
      sumSquares += value * value;
    }
    const rms = Math.sqrt(sumSquares / localDataArray.length);
    targetLevel = Math.min(1, rms * 6);
  }
  waveLevel = waveLevel * 0.82 + targetLevel * 0.18;
  applyWaveLevel(localWaveBars, waveLevel);
  if (localStream && waveLevel > 0.25) {
    registerActivity();
  }

  remotePlayers.forEach((remote) => {
    const level = updateRemoteLevel(remote);
    applyWaveLevel(remote.waveBars, level);
  });

  window.requestAnimationFrame(updateWaveVisual);
}

function stopLocalStream() {
  if (localStream) {
    const tracks = localStream.getTracks();
    tracks.forEach((track) => {
      try {
        track.stop();
      } catch (error) {
        /* ignore */
      }
    });
    localStream = null;
  }
  if (audioContext && typeof audioContext.suspend === 'function') {
    audioContext
      .suspend()
      .catch(() => {
        /* ignore */
      });
  }
  localAnalyser = null;
  localDataArray = null;
  waveLevel = 0.18;
  micMuted = false;
  updateMicButtonState(false);
}

async function startMicrophone() {
  if (!micAccessEnabled) {
    setStatus('로그인 후에 마이크를 사용할 수 있습니다.');
    throw new Error('microphone not available');
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('이 브라우저에서는 마이크를 사용할 수 없습니다.');
    throw new Error('getUserMedia not supported');
  }

  if (localStream) {
    if (audioContext && audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    updateMicButtonState(true);
    attachLocalStreamToPeers();
    return localStream;
  }

  setStatus('마이크 권한을 요청하는 중입니다…');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
      video: false,
    });

    localStream = stream;

    const context = ensureAudioContext();
    if (context) {
      if (context.state === 'suspended') {
        await context.resume();
      }
      localAnalyser = context.createAnalyser();
      localAnalyser.fftSize = 1024;
      localDataArray = new Uint8Array(localAnalyser.fftSize);
      const source = context.createMediaStreamSource(stream);
      source.connect(localAnalyser);
    }

    updateMicButtonState(true);
    setStatus('마이크가 연결되었습니다. 다른 플레이어에게 음성이 전송됩니다.');
    attachLocalStreamToPeers();
    return stream;
  } catch (error) {
    console.error(error);
    setStatus(`마이크 연결에 실패했습니다: ${error.message}`);
    throw error;
  }
}

function isRecorderSupported() {
  return typeof window.MediaRecorder !== 'undefined';
}

function createVoiceMessageRecorder(stream) {
  if (!isRecorderSupported()) {
    return null;
  }
  const preferredType = 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(preferredType)) {
    return new MediaRecorder(stream, { mimeType: preferredType });
  }
  return new MediaRecorder(stream);
}

function stopVoiceMessageRecording() {
  if (voiceRecorderTimeout) {
    window.clearTimeout(voiceRecorderTimeout);
    voiceRecorderTimeout = null;
  }
  if (voiceRecorder && voiceRecorder.state !== 'inactive') {
    voiceRecorder.stop();
  }
  if (player) {
    player.classList.remove('is-recording');
    player.classList.remove('is-holding');
  }
  voiceMessageRecording = false;
}

function startVoiceMessageRecording() {
  if (!localStream) {
    setStatus('마이크를 먼저 연결해주세요.');
    return;
  }
  if (!isRecorderSupported()) {
    setStatus('이 브라우저에서는 음성 메시지를 녹음할 수 없습니다.');
    return;
  }
  if (voiceRecorder && voiceRecorder.state !== 'inactive') {
    return;
  }
  if (!player) {
    setStatus('캐릭터가 준비되지 않았습니다.');
    return;
  }
  registerActivity();
  voiceRecorder = createVoiceMessageRecorder(localStream);
  if (!voiceRecorder) {
    setStatus('음성 메시지 녹음에 실패했습니다.');
    return;
  }
  voiceMessageRecording = true;
  player.classList.add('is-recording');
  voiceMessageDropPosition = { x: position.x, y: position.y };
  voiceRecorderChunks = [];
  const wasMuted = micMuted;
  if (wasMuted) {
    setMicMutedState(false);
  }
  voiceRecorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size > 0) {
      voiceRecorderChunks.push(event.data);
    }
  });
  voiceRecorder.addEventListener('stop', () => {
    if (wasMuted) {
      setMicMutedState(true);
    }
    const blob = new Blob(voiceRecorderChunks, { type: voiceRecorder.mimeType });
    voiceRecorderChunks = [];
    if (!blob || blob.size === 0) {
      setStatus('음성 메시지가 비어 있습니다.');
      return;
    }
    if (blob.size > VOICE_MESSAGE_MAX_BYTES) {
      setStatus('음성 메시지가 너무 깁니다. 더 짧게 녹음해주세요.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        setStatus('음성 메시지 저장에 실패했습니다.');
        return;
      }
      const base64 = result.split(',')[1] || '';
      if (!base64) {
        setStatus('음성 메시지 저장에 실패했습니다.');
        return;
      }
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        setStatus('서버와 연결되어 있지 않습니다.');
        return;
      }
      const drop = voiceMessageDropPosition || { x: position.x, y: position.y };
      sendToServer({
        type: 'voice-message-create',
        x: drop.x,
        y: drop.y,
        audio: base64,
        mimeType: voiceRecorder.mimeType || 'audio/webm',
      });
      setStatus('음성 메시지를 저장하는 중입니다…');
    };
    reader.readAsDataURL(blob);
  });
  voiceRecorder.start();
  voiceRecorderTimeout = window.setTimeout(() => {
    stopVoiceMessageRecording();
  }, VOICE_MESSAGE_MAX_DURATION_MS);
  setStatus('캐릭터를 눌러 드래그하면 음성 메시지를 남길 위치를 정할 수 있습니다.');
}

function setInitialPosition() {
  const range = 2400;
  position.x = Math.round((Math.random() - 0.5) * range);
  position.y = Math.round((Math.random() - 0.5) * range);
  applyPosition();
  positionDirty = true;
}

function maybeSendPosition(timestamp) {
  if (!gameStarted) {
    return;
  }
  if (!positionDirty) {
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  if (timestamp - lastSentPositionTime < POSITION_SEND_INTERVAL) {
    return;
  }
  lastSentPositionTime = timestamp;
  positionDirty = false;
  sendToServer({ type: 'position', x: position.x, y: position.y });
}

function updateMovement(delta) {
  let moved = false;
  const distance = SPEED * delta;
  if (keys.get('w')) {
    position.y -= distance;
    moved = true;
  }
  if (keys.get('s')) {
    position.y += distance;
    moved = true;
  }
  if (keys.get('a')) {
    position.x -= distance;
    moved = true;
  }
  if (keys.get('d')) {
    position.x += distance;
    moved = true;
  }

  if (moved) {
    positionDirty = true;
    applyPosition();
  }
}

function loop(timestamp) {
  if (!gameStarted) {
    lastTime = null;
    window.requestAnimationFrame(loop);
    return;
  }
  if (lastTime === null) {
    lastTime = timestamp;
  }
  const delta = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  updateMovement(delta);
  maybeSendPosition(timestamp);
  updateRoomPresence();

  window.requestAnimationFrame(loop);
}

function handleKeyChange(event, isPressed) {
  const target = event.target;
  const tagName = target && target.tagName ? target.tagName.toLowerCase() : '';
  const isTypingContext =
    (target && target.isContentEditable) ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select';
  if (isTypingContext) {
    return;
  }
  if (!gameStarted) {
    return;
  }
  const key = event.key.toLowerCase();
  if (!relevantKeys.has(key)) {
    return;
  }
  event.preventDefault();
  keys.set(key, isPressed);
}

function connectToServer() {
  if (!gameStarted) {
    return;
  }
  if (!iceConfigLoaded) {
    pendingSocketConnect = true;
    return;
  }
  if (socket) {
    try {
      socket.close();
    } catch (error) {
      /* ignore */
    }
    socket = null;
  }

  const sessionId = currentUser && currentUser.sessionId ? currentUser.sessionId : '';
  const socketUrl = sessionId ? `${SERVER_URL}?sessionId=${encodeURIComponent(sessionId)}` : SERVER_URL;

  try {
    socket = new WebSocket(socketUrl);
  } catch (error) {
    console.error('Failed to create WebSocket', error);
    scheduleReconnect();
    return;
  }

  socket.addEventListener('open', () => {
    setStatus('서버와 동기화 중…');
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (currentUser && currentUser.name) {
      sendToServer({ type: 'identify', name: currentUser.name });
    }
  });

  socket.addEventListener('message', (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (error) {
      console.error('Invalid server message', error);
      return;
    }
    switch (data.type) {
      case 'welcome': {
        clientId = data.id;
        if (
          data.position &&
          typeof data.position.x === 'number' &&
          typeof data.position.y === 'number'
        ) {
          position.x = Math.round(data.position.x);
          position.y = Math.round(data.position.y);
          applyPosition();
        }
        updatePopulation(data.population || 1);
        setStatus('서버에 연결되었습니다. 마이크 버튼을 눌러 음성을 공유하세요.');
        let resumedRoomId = null;
        if (typeof data.roomId === 'number') {
          resumedRoomId = data.roomId;
        }
        if (Array.isArray(data.players)) {
          data.players.forEach((info) => {
            if (!info || info.id === clientId) {
              return;
            }
            const remote = ensureRemotePlayer(info.id);
            if (!remote) {
              return;
            }
            remote.position.x = info.x || 0;
            remote.position.y = info.y || 0;
            remote.displayName = info.displayName || info.name || remote.displayName;
            remote.userId = info.userId || remote.userId;
            updateRemoteAvatar(remote);
            updateRemoteLabel(remote);
            const remoteRoom =
              typeof info.roomId === 'number' ? info.roomId : null;
            remote.roomId = remoteRoom;
            if (remoteRoom !== null) {
              playerRoomMembership.set(info.id, remoteRoom);
            }
          });
        }
        if (Array.isArray(data.rooms)) {
          data.rooms.forEach((roomInfo) => {
            handleRoomCreated(roomInfo);
          });
        }
        if (Array.isArray(data.voiceMessages)) {
          data.voiceMessages.forEach((message) => {
            ensureVoiceMessage(message);
          });
        }
        if (resumedRoomId !== null) {
          setActiveRoom(resumedRoomId);
        } else {
          setActiveRoom(null);
        }
        sendToServer({ type: 'position', x: position.x, y: position.y });
        break;
      }
      case 'player-joined': {
        updatePopulation(data.population || 0);
        if (data.id === clientId) {
          break;
        }
        const remote = ensureRemotePlayer(data.id);
        if (!remote) {
          break;
        }
        remote.position.x = data.x || 0;
        remote.position.y = data.y || 0;
        remote.displayName = data.displayName || data.name || remote.displayName;
        remote.userId = data.userId || remote.userId;
        updateRemoteAvatar(remote);
        updateRemoteLabel(remote);
        if (typeof data.roomId === 'number') {
          playerRoomMembership.set(data.id, data.roomId);
          remote.roomId = data.roomId;
        }
        {
          const name = resolveDisplayName({
            displayName: data.displayName,
            name: data.name,
            userId: data.userId,
            id: data.id,
          });
          setStatus(`${name} 님이 입장했습니다.`);
        }
        break;
      }
      case 'player-updated': {
        if (data.id === clientId) {
          break;
        }
        const remote = ensureRemotePlayer(data.id);
        if (!remote) {
          break;
        }
        remote.displayName = data.displayName || data.name || remote.displayName;
        remote.userId = data.userId || remote.userId;
        updateRemoteLabel(remote);
        break;
      }
      case 'player-left': {
        updatePopulation(data.population || 0);
        if (data.id !== clientId) {
          const name = resolveDisplayName({
            displayName: data.displayName,
            name: data.name,
            userId: data.userId,
            id: data.id,
          });
          removeRemotePlayer(data.id);
          setStatus(`${name} 님이 퇴장했습니다.`);
        }
        break;
      }
      case 'position': {
        if (data.id === clientId) {
          break;
        }
        const remote = ensureRemotePlayer(data.id);
        if (!remote) {
          break;
        }
        remote.position.x = data.x || 0;
        remote.position.y = data.y || 0;
        updateRemoteAvatar(remote);
        break;
      }
      case 'signal': {
        handleSignalMessage(data.from, data.data).catch((error) => {
          console.error('Signal handling failed', error);
        });
        break;
      }
      case 'room-created': {
        handleRoomCreated(data.room);
        if (data.room && data.room.ownerId === clientId) {
          setStatus('새 통화방이 만들어졌습니다. 가까이에서 참여하세요!');
        }
        break;
      }
      case 'room-create-result': {
        if (!data.success) {
          switch (data.reason) {
            case 'overlap':
              setStatus('다른 통화방과 너무 가까워 생성할 수 없습니다.');
              break;
            case 'rate-limit':
              setStatus('짧은 시간에 너무 많은 통화방을 만들 수 없습니다. 잠시 후 다시 시도해주세요.');
              break;
            case 'invalid-name':
              setStatus('통화방 이름이 올바르지 않습니다. 다시 확인해주세요.');
              break;
            case 'invalid-password':
              setStatus('비밀번호 형식이 올바르지 않습니다. 다시 입력해주세요.');
              break;
            default:
              setStatus('통화방을 만들 수 없습니다. 다시 시도해보세요.');
          }
        }
        break;
      }
      case 'room-updated': {
        handleRoomUpdated(data.room);
        break;
      }
      case 'room-removed': {
        if (typeof data.roomId === 'number') {
          removeCallRoom(data.roomId);
          if (roomManageTargetId === data.roomId) {
            closeRoomManageOverlay();
          }
          if (activeRoomId === data.roomId) {
            setStatus('참여 중인 통화방이 삭제되었습니다.');
          }
        }
        break;
      }
      case 'room-manage-result': {
        handleRoomManageResult(data);
        break;
      }
      case 'room-theme-result': {
        handleRoomThemeResult(data);
        break;
      }
      case 'room-delete-result': {
        handleRoomDeleteResult(data);
        break;
      }
      case 'voice-message-create-result': {
        if (data.success) {
          setStatus('음성 메시지가 생성되었습니다.');
        } else {
          switch (data.reason) {
            case 'rate-limit':
              setStatus('하루에 음성 메시지는 최대 3개까지 가능합니다.');
              break;
            case 'invalid-audio':
              setStatus('음성 메시지를 저장할 수 없습니다.');
              break;
            default:
              setStatus('음성 메시지를 만들 수 없습니다.');
              break;
          }
        }
        break;
      }
      case 'voice-message-created': {
        if (data.message) {
          ensureVoiceMessage(data.message);
        }
        break;
      }
      case 'voice-message-removed': {
        if (typeof data.messageId === 'number') {
          removeVoiceMessage(data.messageId);
        }
        break;
      }
      case 'room-join-result': {
        if (pendingJoinRoomId === data.roomId) {
          pendingJoinRoomId = null;
        }
        const entry = callRooms.get(data.roomId);
        if (entry) {
          if (data.success && entry.passwordInput) {
            entry.passwordInput.value = '';
          }
          updateRoomPrompt(entry);
        }
        if (data.success) {
          setStatus('통화방에 참여했습니다. 음성이 해당 방의 참가자에게만 전달됩니다.');
        } else {
          switch (data.reason) {
            case 'full':
              setStatus('통화방 정원이 가득 찼습니다. 다른 방을 시도해보세요.');
              break;
            case 'private':
            case 'password-required':
              setStatus('비밀번호가 필요한 개인 통화방입니다. 비밀번호를 입력해주세요.');
              if (entry && entry.passwordInput) {
                entry.passwordInput.focus();
                entry.passwordInput.select();
              }
              break;
            case 'wrong-password':
              setStatus('비밀번호가 올바르지 않습니다. 다시 입력해주세요.');
              if (entry && entry.passwordInput) {
                entry.passwordInput.value = '';
                entry.passwordInput.focus();
              }
              break;
            case 'missing':
              setStatus('통화방을 찾을 수 없습니다.');
              break;
            default:
              setStatus('통화방에 참여하지 못했습니다. 다시 시도해보세요.');
          }
        }
        break;
      }
      case 'room-left': {
        if (data.playerId === clientId) {
          setActiveRoom(null);
        }
        break;
      }
      case 'full': {
        setStatus(`서버 정원(${data.maxPlayers || MAX_PLAYERS}명)이 가득 찼습니다.`);
        if (socket) {
          socket.close();
        }
        break;
      }
      default:
        break;
    }
  });

  socket.addEventListener('close', () => {
    clientId = null;
    resetRemoteState();
    scheduleReconnect();
  });

  socket.addEventListener('error', (error) => {
    console.error('WebSocket error', error);
    if (socket) {
      socket.close();
    }
  });
}

function startGameSession() {
  if (gameStarted) {
    return;
  }
  keys.clear();
  gameStarted = true;
  positionDirty = true;
  lastSentPositionTime = 0;
  lastTime = null;
  setInitialPosition();
  connectToServer();
}

function stopGameSession() {
  if (!gameStarted) {
    return;
  }
  gameStarted = false;
  keys.clear();
  positionDirty = false;
  lastTime = null;
  lastSentPositionTime = 0;
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    try {
      socket.close();
    } catch (error) {
      /* ignore */
    }
  }
  socket = null;
  clientId = null;
  closeRoomContextMenu();
  resetRemoteState();
  position.x = 0;
  position.y = 0;
  applyPosition();
  setStatus('로그인 후 서버에 연결됩니다.');
  updatePopulation(0);
}

function completeAuthentication(user, options = {}) {
  const sanitizedEmail = typeof user.email === 'string' ? user.email.toLowerCase() : '';
  const sanitizedName =
    typeof user.name === 'string' && user.name.trim()
      ? user.name.trim()
      : sanitizedEmail;
  const authToken =
    typeof user.authToken === 'string' && user.authToken.trim()
      ? user.authToken.trim()
      : '';
  if (!authToken) {
    showAuthError('세션 토큰을 확인할 수 없습니다. 다시 로그인해주세요.');
    return;
  }
  let sessionId =
    options && typeof options.sessionId === 'string' && options.sessionId.trim()
      ? options.sessionId.trim()
      : typeof user.sessionId === 'string' && user.sessionId.trim()
      ? user.sessionId.trim()
      : '';
  if (!sessionId) {
    sessionId = generateSessionId();
  }
  currentUser = {
    id: typeof user.id === 'number' ? user.id : null,
    email: sanitizedEmail,
    name: sanitizedName,
    authToken,
    sessionId,
  };
  if (!persistSession(currentUser)) {
    console.warn('Failed to persist session information');
  }
  applyUserGreeting();
  if (loginForm) {
    loginForm.reset();
  }
  if (registerForm) {
    registerForm.reset();
  }
  showAuthError('');
  unlockMicButton();
  setAuthOverlayVisible(false);
  setStatus('서버에 연결 중…');
  updatePopulation(0);
  startGameSession();
}

async function attemptSessionRestore(session) {
  if (!session || !session.authToken || !session.sessionId) {
    setStatus('로그인 후 서버에 연결됩니다.');
    updatePopulation(0);
    setAuthOverlayVisible(true);
    return;
  }
  setStatus('이전 세션을 확인하는 중입니다…');
  try {
    const response = await callAuthApi('/session', {
      method: 'POST',
      payload: { token: session.authToken },
      token: session.authToken,
    });
    if (!response || !response.user) {
      throw new Error('세션 응답이 올바르지 않습니다.');
    }
    completeAuthentication(
      {
        id: response.user.id,
        email: response.user.email,
        name: response.user.displayName,
        authToken: session.authToken,
      },
      { sessionId: session.sessionId }
    );
  } catch (error) {
    console.warn('Failed to restore session', error);
    clearSessionStorage();
    setStatus('로그인 후 서버에 연결됩니다.');
    updatePopulation(0);
    setAuthOverlayVisible(true);
    showAuthError('');
  }
}

function handleLogout() {
  const token = currentUser && currentUser.authToken ? currentUser.authToken : null;
  clearSessionStorage();
  if (token) {
  callAuthApi('/logout', {
      method: 'POST',
      payload: { token },
      token,
    }).catch(() => {
      /* ignore logout errors */
    });
  }
  stopLocalStream();
  stopGameSession();
  currentUser = null;
  closeSettingsPanel();
  setServerPanelOpen(false);
  applyUserGreeting();
  lockMicButton();
  switchAuthMode('login');
  showAuthError('');
  if (loginForm) {
    loginForm.reset();
  }
  if (registerForm) {
    registerForm.reset();
  }
  setAuthOverlayVisible(true);
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  if (!loginForm) {
    return;
  }
  const identifierField = loginForm.elements.namedItem('loginEmail');
  const passwordField = loginForm.elements.namedItem('loginPassword');
  const identifierValue =
    identifierField && 'value' in identifierField
      ? String(identifierField.value).trim()
      : '';
  const passwordValue =
    passwordField && 'value' in passwordField ? String(passwordField.value) : '';
  if (!identifierValue || !passwordValue) {
    showAuthError('아이디와 비밀번호를 모두 입력해주세요.');
    return;
  }
  showAuthError('로그인 중입니다…');
  try {
    const response = await callAuthApi('/login', {
      method: 'POST',
      payload: { identifier: identifierValue, password: passwordValue },
    });
    if (!response || !response.user || !response.token) {
      throw new Error('로그인 응답이 올바르지 않습니다.');
    }
    completeAuthentication({
      id: response.user.id,
      email: response.user.email,
      name: response.user.displayName,
      authToken: response.token,
    });
  } catch (error) {
    showAuthError(error.message || '로그인에 실패했습니다.');
  }
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  if (!registerForm) {
    return;
  }
  const nameField = registerForm.elements.namedItem('registerName');
  const emailField = registerForm.elements.namedItem('registerEmail');
  const passwordField = registerForm.elements.namedItem('registerPassword');
  const rawName =
    nameField && 'value' in nameField ? String(nameField.value).trim() : '';
  const normalizedName = rawName.replace(/\s+/g, ' ').trim();
  const rawEmail =
    emailField && 'value' in emailField ? String(emailField.value).trim().toLowerCase() : '';
  const passwordValue =
    passwordField && 'value' in passwordField ? String(passwordField.value) : '';
  if (!normalizedName || normalizedName.length < 2) {
    showAuthError('닉네임은 2자 이상 입력해주세요.');
    return;
  }
  if (!rawEmail || !rawEmail.includes('@')) {
    showAuthError('유효한 이메일을 입력해주세요.');
    return;
  }
  if (!passwordValue || passwordValue.length < 6) {
    showAuthError('비밀번호는 최소 6자 이상이어야 합니다.');
    return;
  }
  showAuthError('회원가입 중입니다…');
  try {
    const response = await callAuthApi('/register', {
      method: 'POST',
      payload: { name: normalizedName, email: rawEmail, password: passwordValue },
    });
    if (!response || !response.user || !response.token) {
      throw new Error('회원가입 응답이 올바르지 않습니다.');
    }
    completeAuthentication({
      id: response.user.id,
      email: response.user.email,
      name: response.user.displayName,
      authToken: response.token,
    });
  } catch (error) {
    showAuthError(error.message || '회원가입에 실패했습니다.');
  }
}

function initializeAuth() {
  lockMicButton();
  applyUserGreeting();
  if (logoutButton) {
    logoutButton.addEventListener('click', handleLogout);
  }
  authTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.authMode === 'register' ? 'register' : 'login';
      switchAuthMode(mode);
    });
  });
  switchAuthMode('login');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLoginSubmit);
  }
  if (registerForm) {
    registerForm.addEventListener('submit', handleRegisterSubmit);
  }
  const session = loadPersistedSession();
  if (session && session.authToken && session.sessionId) {
    setAuthOverlayVisible(true);
    showAuthError('이전 로그인 정보를 확인 중입니다…');
    attemptSessionRestore(session);
    return;
  }
  setStatus('로그인 후 서버에 연결됩니다.');
  updatePopulation(0);
  setAuthOverlayVisible(true);
}

localWaveBars.push(...createWaveBars(waveElement));
applyWaveLevel(localWaveBars, waveLevel);
window.requestAnimationFrame(updateWaveVisual);

if (micButton) {
  micButton.addEventListener('click', () => {
    if (!micAccessEnabled) {
      setStatus('로그인 후에 마이크를 사용할 수 있습니다.');
      return;
    }
    if (!localStream) {
      startMicrophone().catch(() => {
        /* handled in startMicrophone */
      });
      return;
    }
    toggleMicMutedState();
  });
}

if (serverMenuButton) {
  serverMenuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleServerPanel();
  });
}

if (settingsButton) {
  settingsButton.addEventListener('click', (event) => {
    const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    openSettingsPanel(trigger);
  });
}

if (statusSettingsButton) {
  statusSettingsButton.addEventListener('click', (event) => {
    const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    openSettingsPanel(trigger);
  });
}

if (settingsCloseButton) {
  settingsCloseButton.addEventListener('click', () => {
    closeSettingsPanel();
  });
}

if (settingsOverlay) {
  settingsOverlay.addEventListener('click', handleSettingsOverlayClick);
}

if (settingsAccountForm) {
  settingsAccountForm.addEventListener('submit', handleSettingsAccountSubmit);
}

if (roomForm) {
  roomForm.addEventListener('submit', handleRoomFormSubmit);
}

if (roomCancelButton) {
  roomCancelButton.addEventListener('click', () => {
    closeRoomContextMenu();
  });
}

roomTypeInputs.forEach((input) => {
  input.addEventListener('change', () => {
    updateRoomPasswordVisibility();
  });
});

roomManageVisibilityInputs.forEach((input) => {
  input.addEventListener('change', () => {
    updateRoomManagePasswordVisibility();
  });
});

if (roomManageOverlay) {
  roomManageOverlay.addEventListener('click', handleRoomManageOverlayClick);
}

if (roomManageCloseButton) {
  roomManageCloseButton.addEventListener('click', () => {
    closeRoomManageOverlay();
  });
}

if (roomManageForm) {
  roomManageForm.addEventListener('submit', handleRoomManageFormSubmit);
}

if (roomManageRingColorInput) {
  roomManageRingColorInput.addEventListener('change', handleRoomManageRingColorChange);
}

if (roomManageTeleportButton) {
  roomManageTeleportButton.addEventListener('click', () => {
    handleRoomManageTeleport();
  });
}

if (roomManageDeleteButton) {
  roomManageDeleteButton.addEventListener('click', () => {
    handleRoomManageDelete();
  });
}

if (roomManageRoleAddButton) {
  roomManageRoleAddButton.addEventListener('click', () => {
    attemptAddRoomManageRole();
  });
}

if (roomManageRoleInput) {
  roomManageRoleInput.addEventListener('input', () => {
    updateRoomManageRoleControls();
    setRoomManageFeedback('');
  });
  roomManageRoleInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      attemptAddRoomManageRole();
    }
  });
}

if (roomManageRoleList) {
  roomManageRoleList.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const removeButton = event.target.closest('[data-room-role-remove]');
    if (!removeButton) {
      return;
    }
    const index = Number(removeButton.getAttribute('data-room-role-remove'));
    if (!Number.isFinite(index)) {
      return;
    }
    roomManageRoles.splice(index, 1);
    renderRoomManageRoles();
    setRoomManageFeedback('역할이 삭제되었습니다.', 'success');
  });
}

if (player) {
  player.addEventListener('pointerdown', (event) => {
    if (voiceMessageRecording) {
      handleVoiceMessageDropStart(event);
      return;
    }
    handlePlayerPressStart();
  });
  player.addEventListener('pointerup', () => {
    if (voiceMessageRecording && voiceMessageDropActive) {
      handleVoiceMessageDropEnd();
      return;
    }
    handlePlayerPressEnd();
  });
  player.addEventListener('pointerleave', () => {
    handlePlayerPressEnd();
  });
  player.addEventListener('pointercancel', () => {
    handlePlayerPressEnd();
  });
}

if (world) {
  world.addEventListener('pointermove', (event) => {
    handleVoiceMessageDropMove(event);
  });
  world.addEventListener('pointerup', () => {
    handleVoiceMessageDropEnd();
  });
  world.addEventListener('pointerleave', () => {
    handleVoiceMessageDropEnd();
  });
}

if (world) {
  world.addEventListener('click', handleWorldClick);
}

if (game) {
  game.addEventListener('contextmenu', handleGameContextMenu);
}

if (roomInfoCloseButton) {
  roomInfoCloseButton.addEventListener('click', () => {
    closeRoomInfoCard();
  });
}

updateRoomManagePasswordVisibility();
renderRoomManageRoles();
window.setInterval(() => {
  pruneVoiceMessages();
}, VOICE_MESSAGE_PRUNE_INTERVAL_MS);

if (settingsOverlay) {
  settingsOverlay.setAttribute('aria-hidden', 'true');
}

document.addEventListener('click', (event) => {
  if (!serverPanel || !serverMenuButton) {
    return;
  }
  if (!serverPanel.classList.contains('is-open')) {
    return;
  }
  const target = event.target;
  if (
    target instanceof Node &&
    (serverPanel.contains(target) || serverMenuButton.contains(target))
  ) {
    return;
  }
  setServerPanelOpen(false);
});

document.addEventListener('keydown', (event) => {
  registerActivity();
  handleEscapeKey(event);
  if (event.key === 'Escape') {
    setServerPanelOpen(false);
  }
  handleKeyChange(event, true);
});
document.addEventListener('keyup', (event) => handleKeyChange(event, false));
document.addEventListener('pointerdown', handleGlobalPointerDown);
document.addEventListener('pointerdown', registerActivity);
document.addEventListener('mousedown', registerActivity);
document.addEventListener('touchstart', registerActivity, { passive: true });
document.addEventListener('wheel', registerActivity, { passive: true });
document.addEventListener('mousemove', registerActivityThrottled);

window.addEventListener('resize', () => {
  updateWorldTransform();
});
applyPosition();
initializeAuth();
registerActivity();
window.requestAnimationFrame(loop);
