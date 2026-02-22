(function () {
  const DEFAULT_COLOR = '#ffffff';
  const APPEAR_DURATION_MS = 750;
  const DISAPPEAR_DURATION_MS = 650;
  const BLOB_POINT_COUNT = 120;
  const BLOB_SPEED = 1.2;
  const BLOB_FREQ_A = 1.6;
  const BLOB_FREQ_B = 2.4;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function easeOutCubic(t) {
    const x = clamp(t, 0, 1);
    return 1 - Math.pow(1 - x, 3);
  }

  function easeInCubic(t) {
    const x = clamp(t, 0, 1);
    return x * x * x;
  }

  class RoomRingOverlay {
    constructor() {
      this.roomEl = null;
      this.canvas = null;
      this.ctx = null;
      this.resizeObserver = null;
      this.boundHandleWindowResize = this.handleWindowResize.bind(this);
      this.color = DEFAULT_COLOR;
      this.baseRadius = 0;
      this.overlaySize = 0;
      this.targetActive = false;
      this.progress = 0;
      this.animationFrameId = null;
      this.lastFrameTime = 0;
      this.time = 0;
      this.boundAnimate = this.animate.bind(this);
      this.pointAngles = new Array(BLOB_POINT_COUNT);
      for (let i = 0; i < BLOB_POINT_COUNT; i += 1) {
        this.pointAngles[i] = (i / BLOB_POINT_COUNT) * Math.PI * 2;
      }
    }

    mount(roomEl) {
      if (!roomEl || !(roomEl instanceof HTMLElement)) {
        return;
      }
      if (this.roomEl && this.roomEl !== roomEl) {
        this.destroy();
      }
      if (this.roomEl === roomEl && this.canvas) {
        this.updateCanvasSize();
        this.draw();
        return;
      }

      this.roomEl = roomEl;
      this.ensureRoomPositioning();

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'room-ring-overlay';
      this.canvas.setAttribute('aria-hidden', 'true');
      this.roomEl.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');

      if (typeof ResizeObserver === 'function') {
        this.resizeObserver = new ResizeObserver(() => {
          this.updateCanvasSize();
          this.draw();
        });
        this.resizeObserver.observe(this.roomEl);
      }

      window.addEventListener('resize', this.boundHandleWindowResize);
      this.updateCanvasSize();
      this.draw();
    }

    setColor(hex) {
      if (typeof hex === 'string' && hex.trim()) {
        this.color = hex.trim();
      } else {
        this.color = DEFAULT_COLOR;
      }
      this.draw();
    }

    setActive(active) {
      const next = Boolean(active);
      if (this.targetActive === next) {
        return;
      }
      this.targetActive = next;
      this.startAnimation();
    }

    startAnimation() {
      if (this.animationFrameId !== null) {
        return;
      }
      this.lastFrameTime = 0;
      this.animationFrameId = window.requestAnimationFrame(this.boundAnimate);
    }

    animate(timestamp) {
      if (!this.canvas || !this.ctx) {
        this.animationFrameId = null;
        return;
      }

      if (this.lastFrameTime === 0) {
        this.lastFrameTime = timestamp;
      }

      const elapsed = Math.max(0, timestamp - this.lastFrameTime);
      this.lastFrameTime = timestamp;
      const duration = this.targetActive ? APPEAR_DURATION_MS : DISAPPEAR_DURATION_MS;
      const delta = elapsed / Math.max(1, duration);

      this.time += (elapsed / 1000) * BLOB_SPEED;

      if (this.targetActive) {
        this.progress = clamp(this.progress + delta, 0, 1);
      } else {
        this.progress = clamp(this.progress - delta, 0, 1);
      }

      this.draw();

      const isTransitioning = this.targetActive ? this.progress < 1 : this.progress > 0;
      const shouldKeepAnimating = isTransitioning || this.progress > 0.001;
      if (!shouldKeepAnimating) {
        this.animationFrameId = null;
        this.lastFrameTime = 0;
        return;
      }
      this.animationFrameId = window.requestAnimationFrame(this.boundAnimate);
    }

    destroy() {
      window.removeEventListener('resize', this.boundHandleWindowResize);

      if (this.animationFrameId !== null) {
        window.cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }

      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }

      if (this.canvas && this.canvas.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
      }

      this.roomEl = null;
      this.canvas = null;
      this.ctx = null;
      this.baseRadius = 0;
      this.overlaySize = 0;
      this.lastFrameTime = 0;
      this.progress = 0;
      this.targetActive = false;
      this.time = 0;
    }

    handleWindowResize() {
      this.updateCanvasSize();
      this.draw();
    }

    ensureRoomPositioning() {
      if (!this.roomEl) {
        return;
      }
      const computed = window.getComputedStyle(this.roomEl);
      if (computed.position === 'static') {
        this.roomEl.style.position = 'relative';
      }
    }

    updateCanvasSize() {
      if (!this.roomEl || !this.canvas || !this.ctx) {
        return;
      }
      const rect = this.roomEl.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const baseRadius = Math.min(width, height) / 2;
      const padding = Math.max(40, baseRadius * 0.25);
      const overlaySize = Math.max(2, (baseRadius + padding) * 2);
      const dpr = Math.max(1, window.devicePixelRatio || 1);

      this.baseRadius = baseRadius;
      this.overlaySize = overlaySize;

      this.canvas.style.width = `${overlaySize}px`;
      this.canvas.style.height = `${overlaySize}px`;
      this.canvas.style.left = '50%';
      this.canvas.style.top = '50%';
      this.canvas.style.marginLeft = `${-overlaySize / 2}px`;
      this.canvas.style.marginTop = `${-overlaySize / 2}px`;

      this.canvas.width = Math.round(overlaySize * dpr);
      this.canvas.height = Math.round(overlaySize * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    draw() {
      if (!this.canvas || !this.ctx) {
        return;
      }
      const ctx = this.ctx;
      const size = this.overlaySize || 1;
      const center = size / 2;
      const progress = this.targetActive ? easeOutCubic(this.progress) : easeInCubic(this.progress);
      const outerRadius = size / 2;
      const baseRingRadius = this.baseRadius + (outerRadius - this.baseRadius) * 0.6;
      const ringRadius = baseRingRadius * (0.92 + 0.08 * progress);
      const lineWidth = Math.max(3, this.baseRadius * (0.05 + 0.03 * progress));
      const alpha = 0.45 * progress;
      const amplitude = Math.max(1, ringRadius * 0.028);
      const phase = this.time;

      ctx.clearRect(0, 0, size, size);
      if (progress <= 0.001) {
        return;
      }

      ctx.beginPath();
      for (let i = 0; i < BLOB_POINT_COUNT; i += 1) {
        const angle = this.pointAngles[i];
        const wobblePrimary = Math.sin(phase + angle * BLOB_FREQ_A);
        const wobbleSecondary = Math.sin(phase * 0.7 + angle * BLOB_FREQ_B + 1.2);
        const offset = wobblePrimary * amplitude + wobbleSecondary * amplitude * 0.55;
        const pointRadius = ringRadius + offset;
        const x = center + Math.cos(angle) * pointRadius;
        const y = center + Math.sin(angle) * pointRadius;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = this.color;
      ctx.globalAlpha = alpha;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  window.RoomRingOverlay = RoomRingOverlay;
})();
