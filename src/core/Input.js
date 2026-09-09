// Keyboard + pointer-lock mouse input.

export class Input {
  constructor (canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();     // edge-triggered, cleared each frame
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false, wheel: 0 };
    this.locked = false;
    this.enabled = true;

    addEventListener('keydown', e => {
      if (e.repeat) return;
      const c = e.code;
      // Tab / Escape are handled by the game shell even when input is "disabled"
      if (c === 'Tab') e.preventDefault();
      if (!this.enabled && c !== 'Tab' && c !== 'Escape') return;
      this.keys.add(c); this.pressed.add(c);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft', 'AltRight'].includes(c)) e.preventDefault();
    });
    addEventListener('keyup', e => { this.keys.delete(e.code); this.released.add(e.code); });
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
    });
    addEventListener('mousedown', e => {
      if (!this.locked || !this.enabled) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('wheel', e => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
  }

  requestLock () { this.canvas.requestPointerLock?.(); }
  exitLock () { document.exitPointerLock?.(); }

  down (code) { return this.enabled && this.keys.has(code); }
  hit (code) { return this.pressed.has(code); }
  up (code) { return this.released.has(code); }

  /** Movement intent in local space: x = strafe, y = forward. */
  moveAxis () {
    let x = 0, y = 0;
    if (this.down('KeyW')) y += 1;
    if (this.down('KeyS')) y -= 1;
    if (this.down('KeyD')) x += 1;
    if (this.down('KeyA')) x -= 1;
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  endFrame () {
    this.pressed.clear();
    this.released.clear();
    this.mouse.dx = this.mouse.dy = 0;
    this.mouse.wheel = 0;
    this.mouse.leftPressed = this.mouse.rightPressed = false;
  }
}
