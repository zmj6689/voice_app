const game = document.getElementById('game');
const player = document.getElementById('player');
const instruction = document.getElementById('instruction');

const keys = new Map();
const SPEED = 260; // pixels per second
let lastTime = null;

const position = {
  x: 0,
  y: 0,
};

const relevantKeys = new Set(['w', 'a', 's', 'd']);

function setInitialPosition() {
  position.x = (game.clientWidth - player.offsetWidth) / 2;
  position.y = (game.clientHeight - player.offsetHeight) / 2;
  applyPosition();
}

function clampPosition() {
  const maxX = game.clientWidth - player.offsetWidth;
  const maxY = game.clientHeight - player.offsetHeight;
  position.x = Math.min(Math.max(position.x, 0), Math.max(maxX, 0));
  position.y = Math.min(Math.max(position.y, 0), Math.max(maxY, 0));
}

function applyPosition() {
  player.style.transform = `translate(${position.x}px, ${position.y}px)`;
}

function update(delta) {
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

  if (moved && instruction) {
    instruction.style.opacity = '0';
  }

  clampPosition();
  applyPosition();
}

function loop(timestamp) {
  if (lastTime === null) {
    lastTime = timestamp;
  }
  const delta = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  update(delta);
  requestAnimationFrame(loop);
}

function handleKeyChange(event, isPressed) {
  const key = event.key.toLowerCase();

  if (!relevantKeys.has(key)) {
    return;
  }

  event.preventDefault();
  keys.set(key, isPressed);
}

document.addEventListener('keydown', (event) => handleKeyChange(event, true));
document.addEventListener('keyup', (event) => handleKeyChange(event, false));

window.addEventListener('resize', () => {
  clampPosition();
  applyPosition();
});

setInitialPosition();
requestAnimationFrame(loop);
