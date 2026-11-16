/**
 * Controller unificato:
 * - Joystick virtuale dinamico su meta' sinistra dello schermo (touch/mouse)
 * - Gamepad / Controller API (Stick Sx + D-Pad movimento, Stick Dx mira twin-stick, X/A/R2 attacco, L1/L2 scudo, B/R1 dash, Y interagisci)
 * - Pulsantiera destra (Attacco rosso, Scudo blu hold, Dash giallo/arancio sopra, Interagisci viola)
 * - Fallback completo PC (WASD / Frecce, Spazio/J = Attacco, Shift/K = Dash, F/L = Scudo, E = Interagisci)
 */
export class GameControls {
  constructor(elements) {
    this.el = elements;
    this.keys = new Set();
    this.uiBlocked = false; // True mentre la modale della porta o impostazioni e' aperta

    this.joy = {
      active: false,
      pointerId: null,
      originX: 0,
      originY: 0,
      dx: 0,
      dz: 0,
      maxRadius: 56
    };

    this.buttons = {
      attackQueued: false,
      dashQueued: false,
      interactQueued: false,
      pauseQueued: false,
      shieldTouchHeld: false,
      shieldPointerId: null
    };

    this.gamepad = {
      connected: false,
      name: '',
      prevAttack: false,
      prevDash: false,
      prevInteract: false,
      prevPause: false
    };

    this._bindKeyboard();
    this._bindDynamicJoystick();
    this._bindActionButtons();
    this._bindGamepadEvents();
    this._bindMobileSafety();
  }

  _bindMobileSafety() {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    // Evita pinch/gesture zoom accidentali su iOS Safari durante il gioco multi-touch
    if (typeof document.addEventListener === 'function') {
      for (const evName of ['gesturestart', 'gesturechange']) {
        document.addEventListener(evName, (e) => {
          if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) {
            e.preventDefault();
          }
        }, { passive: false });
      }
    }
    // Paracadute multi-touch se un dito esce dallo schermo o iOS interrompe il puntatore
    const onGlobalRelease = (e) => {
      if (this.joy.active && (e.pointerId === undefined || e.pointerId === this.joy.pointerId)) {
        this._resetJoystick();
      }
      if (this.buttons.shieldTouchHeld && (e.pointerId === undefined || e.pointerId === this.buttons.shieldPointerId)) {
        this.buttons.shieldTouchHeld = false;
        this.buttons.shieldPointerId = null;
        this.el.btnShield?.classList.remove('active');
      }
    };
    window.addEventListener('pointerup', onGlobalRelease, { passive: true });
    window.addEventListener('pointercancel', onGlobalRelease, { passive: true });
  }

  _bindGamepadEvents() {
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepad.connected = true;
      this.gamepad.name = e.gamepad?.id || 'Controller';
    });
    window.addEventListener('gamepaddisconnected', () => {
      const active = this._getActiveGamepad();
      this.gamepad.connected = Boolean(active);
      this.gamepad.name = active?.id || '';
    });
  }

  _getActiveGamepad() {
    const list = navigator.getGamepads?.();
    if (!list) return null;
    let first = null;
    for (const gp of list) {
      if (!gp || !gp.connected) continue;
      if (!first) first = gp;
      if (gp.mapping === 'standard') return gp;
    }
    return first;
  }

  _applyStickDeadzone(rawX, rawY, deadzone = 0.18) {
    const x = Number.isFinite(rawX) ? rawX : 0;
    const y = Number.isFinite(rawY) ? rawY : 0;
    const mag = Math.hypot(x, y);
    if (mag < deadzone) return { x: 0, z: 0 };
    const norm = Math.min(1, (mag - deadzone) / (1 - deadzone));
    return { x: (x / mag) * norm, z: (y / mag) * norm };
  }

  _isGpPressed(gp, idx, threshold = 0.35) {
    const b = gp.buttons?.[idx];
    return Boolean(b && (b.pressed || (b.value ?? 0) > threshold));
  }

  _pollGamepad() {
    const gp = this._getActiveGamepad();
    this.gamepad.connected = Boolean(gp);
    if (!gp) {
      this.gamepad.prevAttack = false;
      this.gamepad.prevDash = false;
      this.gamepad.prevInteract = false;
      this.gamepad.prevPause = false;
      return {
        moveX: 0,
        moveZ: 0,
        aimX: 0,
        aimZ: 0,
        shieldHeld: false,
        attackPressed: false,
        dashPressed: false,
        interactPressed: false,
        pausePressed: false,
        confirmPressed: false
      };
    }

    this.gamepad.name = gp.id || 'Controller';

    // Stick sinistro + D-Pad (12=Su, 13=Giu, 14=Sx, 15=Dx)
    let stickMove = this._applyStickDeadzone(gp.axes?.[0], gp.axes?.[1], 0.18);
    let dpadX = 0;
    let dpadZ = 0;
    if (this._isGpPressed(gp, 14)) dpadX -= 1;
    if (this._isGpPressed(gp, 15)) dpadX += 1;
    if (this._isGpPressed(gp, 12)) dpadZ -= 1;
    if (this._isGpPressed(gp, 13)) dpadZ += 1;
    if (dpadX !== 0 || dpadZ !== 0) {
      const len = Math.hypot(dpadX, dpadZ);
      stickMove = { x: dpadX / len, z: dpadZ / len };
    }

    // Stick destro per mira Twin-Stick opzionale
    const stickAim = this._applyStickDeadzone(gp.axes?.[2], gp.axes?.[3], 0.26);

    // Tasti standard Xbox / PlayStation:
    // Attacco: A/Croce (0), X/Quadrato (2), RT/R2 (7)
    // Dash: B/Cerchio (1), RB/R1 (5)
    // Scudo hold: LB/L1 (4), LT/L2 (6)
    // Interagisci: Y/Triangolo (3)
    // Pausa: Start/Options (9)
    const atkNow = this._isGpPressed(gp, 0) || this._isGpPressed(gp, 2) || this._isGpPressed(gp, 7);
    const dashNow = this._isGpPressed(gp, 1) || this._isGpPressed(gp, 5);
    const intNow = this._isGpPressed(gp, 3);
    const pauseNow = this._isGpPressed(gp, 9);
    const shieldHeld = this._isGpPressed(gp, 4) || this._isGpPressed(gp, 6);

    const attackPressed = atkNow && !this.gamepad.prevAttack;
    const dashPressed = dashNow && !this.gamepad.prevDash;
    const interactPressed = intNow && !this.gamepad.prevInteract;
    const pausePressed = pauseNow && !this.gamepad.prevPause;

    this.gamepad.prevAttack = atkNow;
    this.gamepad.prevDash = dashNow;
    this.gamepad.prevInteract = intNow;
    this.gamepad.prevPause = pauseNow;

    return {
      moveX: stickMove.x,
      moveZ: stickMove.z,
      aimX: stickAim.x,
      aimZ: stickAim.z,
      shieldHeld,
      attackPressed,
      dashPressed,
      interactPressed,
      pausePressed,
      confirmPressed: attackPressed
    };
  }

  rumble(durationMs = 90, weak = 0.25, strong = 0.45) {
    const gp = this._getActiveGamepad();
    const act = gp?.vibrationActuator;
    if (act && typeof act.playEffect === 'function') {
      act.playEffect('dual-rumble', {
        startDelay: 0,
        duration: durationMs,
        weakMagnitude: weak,
        strongMagnitude: strong
      }).catch(() => null);
    }
  }

  setUiBlocked(blocked) {
    this.uiBlocked = Boolean(blocked);
    if (this.uiBlocked) {
      this._resetJoystick();
      this.buttons.shieldTouchHeld = false;
      this.buttons.shieldPointerId = null;
      this.el.btnShield?.classList.remove('active');
    }
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      if (!e.repeat && e.code === 'Escape') {
        this.buttons.pauseQueued = true;
      }
      if (!e.repeat && !this.uiBlocked) {
        if (e.code === 'Space' || e.code === 'KeyJ') this.buttons.attackQueued = true;
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyK') this.buttons.dashQueued = true;
        if (e.code === 'KeyE') this.buttons.interactQueued = true;
      }
      this.keys.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this._resetJoystick();
      this.buttons.shieldTouchHeld = false;
    });
  }

  _bindDynamicJoystick() {
    const zone = this.el.joystickZone;
    const base = this.el.joystickBase;
    const knob = this.el.joystickKnob;
    if (!zone || !base || !knob) return;

    const updateStick = (clientX, clientY) => {
      const vx = clientX - this.joy.originX;
      const vy = clientY - this.joy.originY;
      const dist = Math.hypot(vx, vy);
      const r = this.joy.maxRadius;
      const clamped = Math.min(dist, r);
      const ang = Math.atan2(vy, vx);
      const kx = Math.cos(ang) * clamped;
      const ky = Math.sin(ang) * clamped;

      knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;

      const norm = clamped / r;
      if (norm < 0.14) {
        this.joy.dx = 0;
        this.joy.dz = 0;
      } else {
        this.joy.dx = Math.cos(ang) * norm;
        this.joy.dz = Math.sin(ang) * norm;
      }
    };

    zone.addEventListener('pointerdown', (e) => {
      if (this.uiBlocked) return;
      // Attivo ovunque nella meta' sinistra dello schermo
      if (e.clientX > window.innerWidth * 0.5 || this.joy.active) return;
      e.preventDefault();
      zone.setPointerCapture?.(e.pointerId);
      this.joy.active = true;
      this.joy.pointerId = e.pointerId;
      this.joy.originX = e.clientX;
      this.joy.originY = e.clientY;
      base.style.left = `${e.clientX}px`;
      base.style.top = `${e.clientY}px`;
      base.classList.add('visible');
      updateStick(e.clientX, e.clientY);
    });

    zone.addEventListener('pointermove', (e) => {
      if (!this.joy.active || e.pointerId !== this.joy.pointerId) return;
      e.preventDefault();
      updateStick(e.clientX, e.clientY);
    });

    const endStick = (e) => {
      if (!this.joy.active || e.pointerId !== this.joy.pointerId) return;
      this._resetJoystick();
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);
    zone.addEventListener('lostpointercapture', endStick);
  }

  _resetJoystick() {
    this.joy.active = false;
    this.joy.pointerId = null;
    this.joy.dx = 0;
    this.joy.dz = 0;
    if (this.el.joystickBase) this.el.joystickBase.classList.remove('visible');
    if (this.el.joystickKnob) this.el.joystickKnob.style.transform = 'translate(-50%, -50%)';
  }

  _bindActionButtons() {
    const bindTap = (btn, onPress) => {
      if (!btn) return;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.uiBlocked) return;
        btn.classList.add('pressed');
        onPress();
      });
      const clear = () => btn.classList.remove('pressed');
      btn.addEventListener('pointerup', clear);
      btn.addEventListener('pointercancel', clear);
      btn.addEventListener('pointerleave', clear);
    };

    bindTap(this.el.btnAttack, () => { this.buttons.attackQueued = true; });
    bindTap(this.el.btnDash, () => { this.buttons.dashQueued = true; });
    bindTap(this.el.btnInteract, () => { this.buttons.interactQueued = true; });

    // Scudo a pressione continua (hold)
    const shield = this.el.btnShield;
    if (shield) {
      shield.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.uiBlocked) return;
        shield.setPointerCapture?.(e.pointerId);
        this.buttons.shieldTouchHeld = true;
        this.buttons.shieldPointerId = e.pointerId;
        shield.classList.add('active');
      });
      const releaseShield = (e) => {
        if (this.buttons.shieldPointerId !== null && e.pointerId !== this.buttons.shieldPointerId) return;
        this.buttons.shieldTouchHeld = false;
        this.buttons.shieldPointerId = null;
        shield.classList.remove('active');
      };
      shield.addEventListener('pointerup', releaseShield);
      shield.addEventListener('pointercancel', releaseShield);
      shield.addEventListener('lostpointercapture', releaseShield);
    }
  }

  setInteractVisible(visible, label = 'INTERAGISCI') {
    if (!this.el.btnInteract) return;
    this.el.btnInteract.classList.toggle('visible', Boolean(visible));
    const sub = this.el.btnInteract.querySelector('.btn-sub');
    if (sub) {
      sub.textContent = this.gamepad.connected ? `${label} [Y/E]` : label;
    }
  }

  setDashCooldownRatio(ratio) {
    if (!this.el.btnDashFill) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    this.el.btnDashFill.style.transform = `scaleY(${clamped})`;
  }

  poll() {
    const gpState = this._pollGamepad();
    const pausePressed = this.buttons.pauseQueued || gpState.pausePressed;
    this.buttons.pauseQueued = false;

    if (this.uiBlocked) {
      this.buttons.attackQueued = false;
      this.buttons.dashQueued = false;
      this.buttons.interactQueued = false;
      return {
        moveX: 0,
        moveZ: 0,
        aimX: 0,
        aimZ: 0,
        shieldHeld: false,
        attackPressed: false,
        dashPressed: false,
        interactPressed: false,
        pausePressed,
        confirmPressed: gpState.confirmPressed,
        gamepadConnected: this.gamepad.connected
      };
    }

    let kx = 0;
    let kz = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) kz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) kz += 1;

    const kLen = Math.hypot(kx, kz);
    if (kLen > 1) {
      kx /= kLen;
      kz /= kLen;
    }

    const hasGpMove = Math.hypot(gpState.moveX, gpState.moveZ) > 0.01;
    const moveX = this.joy.active ? this.joy.dx : (hasGpMove ? gpState.moveX : kx);
    const moveZ = this.joy.active ? this.joy.dz : (hasGpMove ? gpState.moveZ : kz);

    const shieldHeld = this.buttons.shieldTouchHeld || this.keys.has('KeyF') || this.keys.has('KeyL') || gpState.shieldHeld;
    this.el.btnShield?.classList.toggle('active', shieldHeld);

    const attackPressed = this.buttons.attackQueued || gpState.attackPressed;
    const dashPressed = this.buttons.dashQueued || gpState.dashPressed;
    const interactPressed = this.buttons.interactQueued || gpState.interactPressed;

    this.buttons.attackQueued = false;
    this.buttons.dashQueued = false;
    this.buttons.interactQueued = false;

    return {
      moveX,
      moveZ,
      aimX: gpState.aimX,
      aimZ: gpState.aimZ,
      shieldHeld,
      attackPressed,
      dashPressed,
      interactPressed,
      pausePressed,
      confirmPressed: gpState.confirmPressed,
      gamepadConnected: this.gamepad.connected
    };
  }
}
