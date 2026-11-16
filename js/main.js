import * as THREE from '../vendor/three.module.js';
import { CONFIG } from './config.js';
import { generateSymmetricMaze } from './maze.js';
import { createSandstoneWallTexture, createFloorTexture, createChestTexture } from './textures.js';
import { PlayerCube, createXRayMaterial, getForwardAttackCenter } from './player.js';
import { WorldPage, LootChest, CenterDoor, EnemyBot } from './entities.js';
import { GameControls } from './controls.js';
import { isIlluminatedWithLoS } from './visibility.js';
import { RealtimeNetwork, stepInterpolatedPose } from './network.js';
import { loadFirebaseConfig, saveFirebaseConfig } from './firebase-config.js';
import { audio } from './audio.js';

/**
 * Rappresentazione visiva di un giocatore avversario multiplayer (PvP / Co-op).
 * Rispetta rigorosamente lo stesso sistema X-Ray + invisibilita' totale nel buio e dietro i muri.
 */
class RemotePlayerVisual {
  constructor(id, scene, isCoop = true) {
    this.id = id;
    this.group = new THREE.Group();
    const s = CONFIG.PLAYER_SIZE;
    const half = s * 0.5;
    const bodyHex = isCoop ? 0x06b6d4 : 0xf59e0b;
    const frontHex = isCoop ? 0x22d3ee : 0xef4444;
    this.defaultFrontHex = frontHex;

    this.bodyMat = new THREE.MeshStandardMaterial({ color: bodyHex, roughness: 0.45 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), this.bodyMat);
    body.position.y = half;
    body.renderOrder = 1;
    this.group.add(body);

    this.frontMat = new THREE.MeshStandardMaterial({ color: frontHex, roughness: 0.4 });
    const front = new THREE.Mesh(new THREE.BoxGeometry(s * 0.78, s * 0.66, 0.14), this.frontMat);
    front.position.set(0, half + 0.04, half + 0.03);
    front.renderOrder = 1;
    this.group.add(front);

    this.slashMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.15, 0.18, 0.42),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
    );
    this.slashMesh.position.set(0, half + 0.05, CONFIG.ATTACK_OFFSET_Z);
    this.slashMesh.visible = false;
    this.group.add(this.slashMesh);

    this.xrayMat = createXRayMaterial(bodyHex, 0.52);
    const xray = new THREE.Mesh(new THREE.BoxGeometry(s * 1.002, s * 1.002, s * 1.002), this.xrayMat);
    xray.position.y = half;
    xray.renderOrder = 50;
    this.group.add(xray);

    this.group.visible = false;
    this.smoothPose = {
      initialized: false,
      x: 0,
      z: 0,
      rotY: 0,
      targetX: 0,
      targetZ: 0,
      vx: 0,
      vz: 0,
      rotTarget: 0,
      lastSeq: null,
      sincePacket: 0
    };
    scene.add(this.group);
  }

  sync(dt, data, maze, localPlayer) {
    if (!data || !data.alive) {
      this.group.visible = false;
      this.smoothPose.initialized = false;
      return;
    }
    stepInterpolatedPose(this.smoothPose, data, dt);
    const sx = this.smoothPose.x;
    const sz = this.smoothPose.z;
    const visible = localPlayer.alive && isIlluminatedWithLoS(maze, localPlayer.x, localPlayer.z, sx, sz, CONFIG.TORCH_RANGE);
    this.group.visible = visible;
    this.group.position.set(sx, 0, sz);
    this.group.rotation.y = this.smoothPose.rotY;
    this.frontMat.color.setHex(data.shieldActive ? 0x38bdf8 : this.defaultFrontHex);
    this.slashMesh.visible = Boolean(data.attacking);
  }

  dispose(scene) {
    scene.remove(this.group);
  }
}

class MazeRoyaleApp {
  constructor() {
    this.el = {
      canvas: document.getElementById('game-canvas'),
      loadingScreen: document.getElementById('loading-screen'),
      loadingBg: document.getElementById('loading-bg'),
      loadingFill: document.getElementById('loading-fill'),
      loadingPercent: document.getElementById('loading-percent'),
      loadingStep: document.getElementById('loading-step'),
      mainMenu: document.getElementById('main-menu'),
      btnMenuSingle: document.getElementById('btn-menu-single'),
      btnMenuCoop: document.getElementById('btn-menu-coop'),
      btnMenuMulti: document.getElementById('btn-menu-multi'),
      btnMenuMusic: document.getElementById('btn-menu-music'),
      modalCoop: document.getElementById('modal-coop'),
      coopHostCode: document.getElementById('coop-host-code'),
      coopInviteLink: document.getElementById('coop-invite-link'),
      btnCoopCopy: document.getElementById('btn-coop-copy'),
      btnCoopShare: document.getElementById('btn-coop-share'),
      btnCoopHost: document.getElementById('btn-coop-host'),
      inpCoopCode: document.getElementById('inp-coop-code'),
      btnCoopJoin: document.getElementById('btn-coop-join'),
      btnCoopClose: document.getElementById('btn-coop-close'),
      pauseCoopShare: document.getElementById('pause-coop-share'),
      pauseCoopCode: document.getElementById('pause-coop-code'),
      btnPauseShare: document.getElementById('btn-pause-share'),
      victoryOverlay: document.getElementById('victory-overlay'),
      victoryStats: document.getElementById('victory-stats'),
      btnVictoryRestart: document.getElementById('btn-victory-restart'),
      btnVictoryMenu: document.getElementById('btn-victory-menu'),
      hudTop: document.getElementById('hud-top'),
      btnHudMusic: document.getElementById('btn-hud-music'),
      btnHudPause: document.getElementById('btn-hud-pause'),
      actionCluster: document.getElementById('action-cluster'),
      modalPause: document.getElementById('modal-pause'),
      btnPauseResume: document.getElementById('btn-pause-resume'),
      btnPauseMusic: document.getElementById('btn-pause-music'),
      btnPauseRestart: document.getElementById('btn-pause-restart'),
      btnPauseMenu: document.getElementById('btn-pause-menu'),
      btnDeathMenu: document.getElementById('btn-death-menu'),
      hpFill: document.getElementById('hp-fill'),
      hpText: document.getElementById('hp-text'),
      statsLine: document.getElementById('stats-line'),
      levelBadge: document.getElementById('level-badge'),
      pageSlots: document.getElementById('page-slots'),
      netStatus: document.getElementById('net-status'),
      toast: document.getElementById('toast-banner'),
      damageFlash: document.getElementById('damage-flash'),
      deathOverlay: document.getElementById('death-overlay'),
      deathStats: document.getElementById('death-stats'),
      deathHint: document.getElementById('death-hint'),
      btnRestartArcade: document.getElementById('btn-restart-arcade'),
      btnRespawnPvp: document.getElementById('btn-respawn-pvp'),
      joystickZone: document.getElementById('joystick-zone'),
      joystickBase: document.getElementById('joystick-base'),
      joystickKnob: document.getElementById('joystick-knob'),
      btnAttack: document.getElementById('btn-attack'),
      btnShield: document.getElementById('btn-shield'),
      btnDash: document.getElementById('btn-dash'),
      btnDashFill: document.querySelector('#btn-dash .cd-fill'),
      btnInteract: document.getElementById('btn-interact'),
      modalDoor: document.getElementById('modal-door'),
      doorSlots: document.getElementById('door-code-slots'),
      doorKeypad: document.getElementById('door-keypad'),
      doorHint: document.getElementById('door-hint'),
      modalNet: document.getElementById('modal-net'),
      inpRoom: document.getElementById('inp-room'),
      inpSpawnSide: document.getElementById('inp-spawn-side'),
      inpFbJson: document.getElementById('inp-fb-json'),
      btnOpenNet: document.getElementById('btn-open-net'),
      btnCloseNet: document.getElementById('btn-close-net'),
      btnSaveNet: document.getElementById('btn-save-net'),
      btnClearFb: document.getElementById('btn-clear-fb'),
      btnNewMaze: document.getElementById('btn-new-maze')
    };

    this.controls = new GameControls(this.el);

    this.screenState = 'LOADING'; // 'LOADING' | 'MENU' | 'PLAYING' | 'PAUSED' | 'GAMEOVER' | 'VICTORY'
    this.gameMode = 'single'; // 'single' | 'coop'
    this.netModalOpen = false;
    this.coopModalOpen = false;
    this.doorModalOpen = false;
    this.hostRoomCode = this._generateRoomCode();
    this.pendingInviteRoom = this._extractRoomCode(
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('room') : ''
    );
    this._coopInitialSynced = false;
    this.sharedPages = [];
    this.level = 1;
    this.seed = Math.floor(Math.random() * 900000) + 1000;
    this.spawnSide = 'A';
    this.kills = 0;
    this.deadElapsed = 0;
    this.doorEntered = [];
    this.nearInteractable = null;
    this.elapsedSec = 0;
    this.lastTime = 0;

    this._initThree();
    this._bindModals();
    this._initNetwork();

    const unlockMobileAudio = () => {
      audio.startBgm();
      audio.unlock();
    };
    window.addEventListener('pointerdown', unlockMobileAudio, { passive: true, capture: true });
    window.addEventListener('touchstart', unlockMobileAudio, { passive: true, capture: true });
    window.addEventListener('keydown', unlockMobileAudio, { passive: true, capture: true });
    window.addEventListener('pagehide', () => this.network?.disconnect());

    audio.startBgm();
    this._syncMusicUi();

    const isLocalHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && !isLocalHost) {
      navigator.serviceWorker.register('./sw.js').catch(() => null);
    }

    this.setScreenState('LOADING');
    this._runInitialLoading();
    requestAnimationFrame((t) => this._loop(t));
  }

  _generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = 'MR';
    for (let i = 0; i < 6; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  _extractRoomCode(rawOrUrl) {
    const str = String(rawOrUrl || '').trim();
    if (!str) return '';
    let candidate = str;
    try {
      if (str.includes('room=')) {
        const parsed = str.startsWith('http') ? new URL(str) : new URL(str, 'https://example.com');
        candidate = parsed.searchParams.get('room') || str;
      }
    } catch (_) {
      const m = str.match(/[?&]room=([A-Za-z0-9_-]+)/i);
      if (m) candidate = m[1];
    }
    return candidate.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
  }

  _buildInviteUrl(roomCode) {
    const code = this._extractRoomCode(roomCode) || this.hostRoomCode;
    if (typeof window === 'undefined' || window.location.protocol === 'file:') {
      return `?room=${encodeURIComponent(code)}`;
    }
    const u = new URL(window.location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('room', code);
    return u.toString();
  }

  async _shareOrCopyInvite(roomCode) {
    const code = this._extractRoomCode(roomCode) || this.hostRoomCode;
    const url = this._buildInviteUrl(code);
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Maze Royale — Dark Labyrinth (Co-op)',
          text: `Entra nel mio labirinto Co-op (Codice: ${code}):`,
          url
        });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        this.showToast(`Link invito copiato! (${code})`);
        return;
      } catch (_) {}
    }
    this.showToast(`Link: ${url}`);
  }

  _syncControlsBlocked() {
    const blocked =
      this.screenState !== 'PLAYING' ||
      this.netModalOpen ||
      this.coopModalOpen ||
      this.doorModalOpen;
    this.controls.setUiBlocked(blocked);
  }

  setScreenState(nextState, opts = {}) {
    this.screenState = nextState;
    const showHud = nextState === 'PLAYING' || nextState === 'PAUSED' || nextState === 'GAMEOVER';
    const showWorldCanvas = showHud || nextState === 'VICTORY';

    if (this.el.canvas) {
      this.el.canvas.style.visibility = showWorldCanvas ? 'visible' : 'hidden';
    }

    this.el.mainMenu?.classList.toggle('hidden', nextState !== 'MENU');
    this.el.hudTop?.classList.toggle('hidden', !showHud);
    this.el.joystickZone?.classList.toggle('hidden', nextState !== 'PLAYING');
    this.el.actionCluster?.classList.toggle('hidden', nextState !== 'PLAYING');
    this.el.modalPause?.classList.toggle('hidden', nextState !== 'PAUSED');
    this.el.deathOverlay?.classList.toggle('hidden', nextState !== 'GAMEOVER');
    this.el.victoryOverlay?.classList.toggle('hidden', nextState !== 'VICTORY');

    if (nextState === 'PAUSED' && this.el.pauseCoopShare) {
      const showShare = this.gameMode === 'coop' && this.network?.roomId && this.network.roomId !== 'solo';
      this.el.pauseCoopShare.classList.toggle('hidden', !showShare);
      if (showShare && this.el.pauseCoopCode) {
        this.el.pauseCoopCode.textContent = this.network.roomId;
      }
    }

    if (nextState !== 'LOADING') {
      if (!opts.keepLoadingVisible) {
        this.el.loadingScreen?.classList.add('hidden');
      }
    } else {
      this.el.loadingScreen?.classList.remove('hidden', 'fade-out');
    }

    this._syncControlsBlocked();
  }

  startSingleplayer() {
    audio.unlock();
    this.gameMode = 'single';
    this.spawnSide = 'A';
    this._coopInitialSynced = false;
    this.network.connect('solo', 'solo');
    this.restartArcadeRun();
  }

  openCoopModal() {
    this.coopModalOpen = true;
    this.hostRoomCode = this.hostRoomCode || this._generateRoomCode();
    if (this.el.coopHostCode) this.el.coopHostCode.textContent = this.hostRoomCode;
    if (this.el.coopInviteLink) this.el.coopInviteLink.textContent = this._buildInviteUrl(this.hostRoomCode);
    this.el.modalCoop?.classList.remove('hidden');
    this._syncControlsBlocked();
  }

  closeCoopModal() {
    this.coopModalOpen = false;
    this.el.modalCoop?.classList.add('hidden');
    this._syncControlsBlocked();
  }

  openNetModal() {
    this.netModalOpen = true;
    this.el.modalNet?.classList.remove('hidden');
    const existingFb = loadFirebaseConfig();
    if (this.el.inpFbJson) {
      this.el.inpFbJson.value = existingFb.databaseURL ? JSON.stringify(existingFb, null, 2) : '';
    }
    if (this.el.inpSpawnSide) {
      this.el.inpSpawnSide.value = this.spawnSide;
    }
    this._syncControlsBlocked();
  }

  closeNetModal() {
    this.netModalOpen = false;
    this.el.modalNet?.classList.add('hidden');
    this._syncControlsBlocked();
  }

  async startCoopHost(rawCode) {
    audio.unlock();
    const cleanCode = String(rawCode || this.hostRoomCode || this._generateRoomCode())
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 20) || this._generateRoomCode();

    this.hostRoomCode = cleanCode;
    this.gameMode = 'coop';
    this.spawnSide = 'A';
    this.level = 1;
    this.seed = Math.floor(Math.random() * 900000) + 1000;
    this.kills = 0;
    this.deadElapsed = 0;
    this._coopInitialSynced = true;

    this.closeCoopModal();
    this.buildLevel(1, this.seed, false);
    const sp = this.maze.spawnA;
    this.player.resetToFreshRun(sp.x, sp.z);
    this.snapCameraToPlayer();

    await this.network.connect(cleanCode, 'host');
    this.network.publishFullRoomSync(this._buildRoomSnapshot());
    if (this.el.inpRoom) this.el.inpRoom.value = this.network.roomId;

    this.setScreenState('PLAYING');
    this._syncHud();
    this.showToast(`🤝 Mondo Co-op creato! Codice: ${this.network.roomId}`);
  }

  async startCoopGuest(rawCode, opts = {}) {
    const cleanCode = this._extractRoomCode(rawCode);

    if (!cleanCode) {
      this.showToast('Inserisci un codice stanza valido!');
      this.el.inpCoopCode?.focus();
      return;
    }

    audio.unlock();
    this.gameMode = 'coop';
    this.spawnSide = 'B';
    this.level = 1;
    this.seed = Math.floor(Math.random() * 900000) + 1000;
    this.kills = 0;
    this.deadElapsed = 0;
    this._coopInitialSynced = false;

    this.closeCoopModal();
    this.buildLevel(1, this.seed, false);
    const sp = this.maze.spawnB;
    this.player.resetToFreshRun(sp.x, sp.z);
    this.snapCameraToPlayer();

    this.setScreenState('PLAYING', opts);
    await this.network.connect(cleanCode, 'guest');
    if (this.el.inpRoom) this.el.inpRoom.value = this.network.roomId;

    this._syncHud();
    this.showToast(`🔑 Entrato in Co-op (${this.network.roomId}) — Spawn B!`);
  }

  pauseGame() {
    if (this.screenState !== 'PLAYING') return;
    this.setScreenState('PAUSED');
  }

  resumeGame() {
    if (this.screenState !== 'PAUSED') return;
    this.setScreenState('PLAYING');
  }

  returnToMainMenu() {
    this.closeDoorModal();
    this.closeCoopModal();
    this.closeNetModal();
    this.network?.disconnect();
    this.gameMode = 'single';
    this.spawnSide = 'A';
    this.hostRoomCode = this._generateRoomCode();
    if (typeof window !== 'undefined' && window.location.search.includes('room=')) {
      try {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('room');
        window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
      } catch (_) {}
    }
    this.setScreenState('MENU');
  }

  _runInitialLoading() {
    this.controls.setUiBlocked(true);
    const MIN_LOADING_MS = 5000;
    const startMs = performance.now();
    let assetsReady = false;

    const setProgress = (pct, label) => {
      const rounded = Math.max(0, Math.min(100, Math.round(pct)));
      if (this.el.loadingFill) this.el.loadingFill.style.width = `${rounded}%`;
      if (this.el.loadingPercent) this.el.loadingPercent.textContent = `${rounded}%`;
      if (this.el.loadingStep && label) this.el.loadingStep.textContent = label;
    };

    const waitImg = new Promise((resolve) => {
      const img = this.el.loadingBg;
      if (!img || img.complete) {
        resolve();
        return;
      }
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 1800);
    });

    waitImg.then(() => {
      this.buildLevel(this.level, this.seed, false);
      try {
        this.renderer.compile(this.scene, this.camera);
      } catch (_) {}
      assetsReady = true;
    });

    const tick = (now) => {
      const elapsed = now - startMs;
      const t = Math.min(1, elapsed / MIN_LOADING_MS);
      const pct = assetsReady ? t * 100 : Math.min(88, t * 100);

      let label = 'Caricamento motore 3D e texture arenaria...';
      if (this.pendingInviteRoom && pct >= 55) {
        label = `Invito Co-op rilevato (${this.pendingInviteRoom})...`;
      } else if (pct >= 88) {
        label = 'Attivazione touch mobile, controller e stanza online...';
      } else if (pct >= 62) {
        label = 'Calibrazione ombre reali della torcia e raggi X...';
      } else if (pct >= 32) {
        label = 'Generazione labirinto speculare, stanze e 5 simboli...';
      }

      setProgress(pct, label);

      if (elapsed >= MIN_LOADING_MS && assetsReady) {
        const invite = this.pendingInviteRoom;
        this.pendingInviteRoom = '';
        setProgress(100, invite ? `Ingresso Co-op (${invite})...` : 'Pronto! Apertura Menu Principale...');

        // Prepara gia' sotto il menu (o il gioco su invito) prima di far sfumare lo splash,
        // cosi' non si intravede mai il canvas 3D nudo durante la transizione.
        if (invite) {
          this.startCoopGuest(invite, { keepLoadingVisible: true });
        } else {
          this.setScreenState('MENU', { keepLoadingVisible: true });
        }

        requestAnimationFrame(() => {
          this.el.loadingScreen?.classList.add('fade-out');
          setTimeout(() => {
            this.el.loadingScreen?.classList.add('hidden');
            this.el.loadingScreen?.classList.remove('fade-out');
          }, 380);
        });
        return;
      }
      requestAnimationFrame(tick);
    };

    setProgress(0, 'Caricamento motore 3D e texture arenaria...');
    requestAnimationFrame(tick);
  }

  _initThree() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.el.canvas,
      antialias: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 1);
    // Shadow map attiva: impedisce alla torcia di illuminare muri oltre altre pareti
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    // Nebbia calibrata oltre la distanza camera-giocatore (~25.5): intorno al giocatore e' limpido, lontano cade nel nero totale
    this.scene.fog = new THREE.Fog(0x000000, CONFIG.FOG_NEAR, CONFIG.FOG_FAR);

    // Ambient minima: muri schermati da altri muri restano quasi completamente bui
    const ambient = new THREE.AmbientLight(0x1f1913, 0.08);
    this.scene.add(ambient);

    this.camera = new THREE.PerspectiveCamera(
      CONFIG.CAMERA.FOV,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.3,
      90
    );

    this.wallTex = createSandstoneWallTexture();
    this.floorTex = createFloorTexture();
    this.chestTex = createChestTexture();

    this.levelGroup = new THREE.Group();
    this.scene.add(this.levelGroup);

    this.player = new PlayerCube('local', 'TU', 0x3b82f6);
    this.scene.add(this.player.group);

    this.remoteVisuals = new Map();
    this.pages = [];
    this.chests = [];
    this.bots = [];
    this.door = null;

    this._resize();
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this._resize(), 120));
    window.visualViewport?.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const w = Math.max(1, window.visualViewport?.width || window.innerWidth);
    const h = Math.max(1, window.visualViewport?.height || window.innerHeight);
    const aspect = w / h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = aspect;
    // Compensa il FOV verticale in modalita' verticale (iPhone/Android Portrait) per vedere corridoi abbastanza ampi
    this.camera.fov = aspect < 1 ? Math.min(76, CONFIG.CAMERA.FOV / Math.max(0.58, aspect)) : CONFIG.CAMERA.FOV;
    this.camera.updateProjectionMatrix();
  }

  _initNetwork() {
    this.network = new RealtimeNetwork({
      onStatusChange: (label) => {
        if (this.el.netStatus) this.el.netStatus.textContent = label;
      },
      onPeerHello: () => {
        if (this.gameMode === 'coop' && this.maze) {
          this.network.publishFullRoomSync(this._buildRoomSnapshot());
        }
      },
      onRoomMeta: (meta) => {
        if (this.gameMode === 'coop') {
          this._applyFullRoomSync(meta);
        }
      },
      onFullRoomSync: (snapshot) => {
        if (this.gameMode === 'coop') {
          this._applyFullRoomSync(snapshot);
        }
      },
      onPlayersUpdate: (map) => {
        for (const [pid, vis] of this.remoteVisuals.entries()) {
          if (!map.has(pid)) {
            vis.dispose(this.scene);
            this.remoteVisuals.delete(pid);
          }
        }
        for (const pid of map.keys()) {
          if (!this.remoteVisuals.has(pid)) {
            this.remoteVisuals.set(pid, new RemotePlayerVisual(pid, this.scene, this.gameMode === 'coop'));
          }
        }
      },
      onIncomingHit: (hit) => {
        if (!this.player.alive || this.gameMode === 'coop') return;
        const lastPagesCount = this.player.collectedPages.length;
        const res = this.player.takeDamage(hit.damage || CONFIG.BASE_SWORD_DAMAGE, this.maze, (dropped) => {
          this._dropPagesToWorld(dropped, true);
        });
        if (res.blocked) {
          this.showToast('Colpo avversario parato con lo Scudo!');
        } else {
          this._triggerDamageFlash();
          if (res.died) this._onPlayerDied(lastPagesCount);
        }
      },
      onPageEvent: (ev) => {
        if (!ev) return;
        const wp = this.pages.find((p) => p.originalIndex === ev.index);
        if (ev.action === 'PICKUP') {
          if (wp) {
            wp.collected = true;
            wp.mesh.visible = false;
          }
          if (this.gameMode === 'coop') {
            this._applySharedPage({
              originalIndex: ev.index,
              slot: wp?.slot ?? ev.slot,
              symbol: wp?.symbol ?? ev.symbol
            }, true);
          }
        } else if (ev.action === 'DROP' && wp && this.gameMode !== 'coop') {
          wp.setWorldPosition(ev.x, ev.z);
        }
      },
      onChestOpened: (chestId) => {
        const ch = this.chests.find((c) => c.id === chestId);
        if (ch && !ch.opened) ch.open();
      },
      onLevelAdvance: (lvl, nextSeed, winnerName, victory = false) => {
        if (victory) {
          this._onVictory(winnerName);
          return;
        }
        this.level = Math.max(1, Math.min(CONFIG.MAX_LEVELS, lvl));
        this.seed = nextSeed;
        this.buildLevel(this.level, this.seed, false);
        this.showToast(`🚪 ${winnerName || 'Il tuo compagno'} ha risolto il Portale! Livello ${this.level}/${CONFIG.MAX_LEVELS}`);
      }
    });
    this.network.connect('solo', 'solo');
  }

  _buildRoomSnapshot() {
    return {
      level: this.level,
      seed: this.seed,
      collectedPages: this.sharedPages.map((p) => ({
        originalIndex: p.originalIndex,
        slot: p.slot,
        symbol: p.symbol
      })),
      openedChests: this.chests.filter((c) => c.opened).map((c) => c.id),
      victory: this.screenState === 'VICTORY'
    };
  }

  _applySharedPage(pageInfo, notify = false) {
    if (!pageInfo || pageInfo.symbol === undefined) return;
    const wp = this.pages.find((p) => p.originalIndex === pageInfo.originalIndex);
    if (wp) {
      wp.collected = true;
      wp.mesh.visible = false;
    }

    const entry = {
      originalIndex: pageInfo.originalIndex,
      slot: wp?.slot ?? pageInfo.slot,
      symbol: wp?.symbol ?? pageInfo.symbol
    };

    const alreadyShared = this.sharedPages.some((p) => p.originalIndex === entry.originalIndex);
    if (!alreadyShared) {
      this.sharedPages.push(entry);
    }

    const alreadyHeld = this.player.collectedPages.some((p) => p.originalIndex === entry.originalIndex);
    if (!alreadyHeld) {
      this.player.collectedPages.push(entry);
      if (notify) {
        audio.playPagePickup();
        this.showToast(`🤝 Foglio condiviso #${entry.slot}: ${entry.symbol}`);
      }
      if (this.doorModalOpen) {
        this._refreshDoorKeypadOwned();
      }
    }
    this._syncHud();
  }

  _applyFullRoomSync(snapshot) {
    if (!snapshot) return;
    if (snapshot.victory) {
      if (this.screenState !== 'VICTORY') {
        this._onVictory(snapshot.winnerName);
      }
      return;
    }
    if (!snapshot.seed) return;

    const targetLevel = Math.max(1, Math.min(CONFIG.MAX_LEVELS, snapshot.level || 1));
    const targetSeed = snapshot.seed;
    const changed = targetLevel !== this.level || targetSeed !== this.seed;

    if (changed || !this._coopInitialSynced) {
      const prevLevel = this.level;
      this._coopInitialSynced = true;
      this.buildLevel(targetLevel, targetSeed, false);
      if (snapshot.winnerName && targetLevel > prevLevel) {
        this.showToast(`🚪 ${snapshot.winnerName} ha sbloccato il Portale! Livello ${this.level}/${CONFIG.MAX_LEVELS}`);
      } else {
        this.showToast(`🤝 Mondo Co-op (${this.network.roomId}) — Livello ${this.level}/${CONFIG.MAX_LEVELS}`);
      }
    }

    for (const pg of (snapshot.collectedPages || [])) {
      this._applySharedPage(pg, false);
    }
    for (const cid of (snapshot.openedChests || [])) {
      const ch = this.chests.find((c) => c.id === cid);
      if (ch && !ch.opened) ch.open();
    }
    this._syncHud();
  }

  /**
   * Genera il labirinto speculare NxN, usa InstancedMesh per muri/pavimenti
   * e popola fogli, casse, bot e porta al centro (0, 0).
   */
  buildLevel(level, seed, publishMeta = false) {
    // Pulizia geometrie precedenti
    while (this.levelGroup.children.length > 0) {
      const child = this.levelGroup.children.pop();
      if (child.geometry) child.geometry.dispose();
    }
    this.pages = [];
    this.chests = [];
    this.bots = [];

    this.level = level;
    this.seed = seed;
    this.maze = generateSymmetricMaze(level, seed);

    const cs = this.maze.cellSize;
    const wallH = CONFIG.WALL_HEIGHT;

    // 1. InstancedMesh Muri arenaria egiziana (60 FPS garantiti anche su 41x41!)
    const wallGeo = new THREE.BoxGeometry(cs, wallH, cs);
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.wallTex,
      roughness: 0.88,
      metalness: 0.04,
      shadowSide: THREE.DoubleSide
    });
    const wallInst = new THREE.InstancedMesh(wallGeo, wallMat, this.maze.wallCells.length);
    wallInst.frustumCulled = false;
    wallInst.castShadow = true;
    wallInst.receiveShadow = true;
    wallInst.renderOrder = 0;

    const dummy = new THREE.Object3D();
    this.maze.wallCells.forEach((wc, idx) => {
      dummy.position.set(wc.x, wallH * 0.5, wc.z);
      dummy.updateMatrix();
      wallInst.setMatrixAt(idx, dummy.matrix);
    });
    wallInst.instanceMatrix.needsUpdate = true;
    this.levelGroup.add(wallInst);

    // 2. InstancedMesh Pavimento scuro pixel-art
    const floorGeo = new THREE.PlaneGeometry(cs, cs);
    floorGeo.rotateX(-Math.PI * 0.5);
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.floorTex,
      roughness: 0.94,
      metalness: 0.02
    });
    const floorInst = new THREE.InstancedMesh(floorGeo, floorMat, this.maze.floorCells.length);
    floorInst.frustumCulled = false;
    floorInst.castShadow = false;
    floorInst.receiveShadow = true;
    floorInst.renderOrder = 0;
    this.maze.floorCells.forEach((fc, idx) => {
      dummy.position.set(fc.x, 0, fc.z);
      dummy.updateMatrix();
      floorInst.setMatrixAt(idx, dummy.matrix);
    });
    floorInst.instanceMatrix.needsUpdate = true;
    this.levelGroup.add(floorInst);

    // 3. Porta finale esattamente al centro (0, 0)
    this.door = new CenterDoor(this.levelGroup);

    // 4. 5 Fogli nei vicoli ciechi/stanze
    for (const pData of this.maze.pageSpawns) {
      this.pages.push(new WorldPage(pData, this.levelGroup));
    }

    // 5. Casse loot anti-camper
    for (const cData of this.maze.chestSpawns) {
      this.chests.push(new LootChest(cData, this.levelGroup, this.chestTex));
    }

    // 6. Bot nemici verdi lenti (40 HP, invisibili nel buio e dietro i muri)
    for (const bData of this.maze.botSpawns) {
      this.bots.push(new EnemyBot(bData, this.levelGroup));
    }

    // Spawn giocatore: A (basso a sinistra) o B (alto a destra) + camera snap istantaneo!
    const sp = this.spawnSide === 'B' ? this.maze.spawnB : this.maze.spawnA;
    this.sharedPages = [];
    this.player.collectedPages = [];
    this.player.spawnAt(sp.x, sp.z, 0);
    this.snapCameraToPlayer();

    this.el.deathOverlay?.classList.add('hidden');
    this.el.victoryOverlay?.classList.add('hidden');
    this.closeDoorModal();
    this._syncHud();

    if (publishMeta && this.gameMode === 'coop') {
      this.network.publishFullRoomSync(this._buildRoomSnapshot());
    }
  }

  snapCameraToPlayer() {
    this.camera.position.set(
      this.player.x,
      CONFIG.CAMERA.HEIGHT,
      this.player.z + CONFIG.CAMERA.OFFSET_Z
    );
    this.camera.lookAt(
      this.player.x,
      0.5,
      this.player.z + CONFIG.CAMERA.LOOK_AHEAD_Z
    );
  }

  _updateCamera(dt) {
    const targetPosX = this.player.x;
    const targetPosY = CONFIG.CAMERA.HEIGHT;
    const targetPosZ = this.player.z + CONFIG.CAMERA.OFFSET_Z;

    const alpha = Math.min(1, dt * CONFIG.CAMERA.FOLLOW_LERP);
    this.camera.position.x += (targetPosX - this.camera.position.x) * alpha;
    this.camera.position.y += (targetPosY - this.camera.position.y) * alpha;
    this.camera.position.z += (targetPosZ - this.camera.position.z) * alpha;
    this.camera.lookAt(
      this.camera.position.x,
      0.5,
      this.camera.position.z - CONFIG.CAMERA.OFFSET_Z + CONFIG.CAMERA.LOOK_AHEAD_Z
    );
  }

  _dropPagesToWorld(droppedPages, broadcast = true) {
    for (const d of droppedPages) {
      const wp = this.pages.find((p) => p.originalIndex === d.originalIndex);
      if (wp) {
        wp.setWorldPosition(d.x, d.z);
        if (broadcast) {
          this.network.publishPageEvent({ action: 'DROP', index: wp.originalIndex, x: d.x, z: d.z });
        }
      }
    }
    this._syncHud();
  }

  _onPlayerDied(lastPagesCount = 0) {
    this.closeDoorModal();
    this.deadElapsed = 0;

    if (this.gameMode === 'coop') {
      // In Co-op le carte trovate restano condivise tra i giocatori anche dopo una caduta
      this.player.collectedPages = [...this.sharedPages];
      if (this.el.deathStats) {
        this.el.deathStats.textContent = `Livello ${this.level}/${CONFIG.MAX_LEVELS} (${this.maze.N}×${this.maze.N}) • Fogli condivisi: ${this.sharedPages.length}/5 • Guardiani eliminati: ${this.kills}`;
      }
      if (this.el.deathHint) {
        this.el.deathHint.textContent = 'Sei caduto! Puoi rientrare allo Spawn Co-op oppure ricominciare dal Livello 1.';
      }
      if (this.el.btnRespawnPvp) {
        this.el.btnRespawnPvp.textContent = '🔄 RIENTRA IN CO-OP';
        this.el.btnRespawnPvp.classList.remove('hidden');
      }
    } else {
      if (this.el.deathStats) {
        this.el.deathStats.textContent = `Livello raggiunto: ${this.level}/${CONFIG.MAX_LEVELS} (${this.maze.N}×${this.maze.N}) • Fogli raccolti: ${lastPagesCount}/5 • Guardiani eliminati: ${this.kills}`;
      }
      if (this.el.deathHint) {
        this.el.deathHint.textContent = 'Fine partita Arcade! Premi Spazio / Invio / Nuova Partita per ricominciare dal Livello 1.';
      }
      this.el.btnRespawnPvp?.classList.add('hidden');
    }

    this.setScreenState('GAMEOVER');
    this._syncHud();
  }

  _onVictory(winnerName = '') {
    this.closeDoorModal();
    this.player.shieldActive = false;
    if (this.el.victoryStats) {
      const modeLabel = this.gameMode === 'coop' ? `Co-op (${this.network.roomId})` : 'Singleplayer';
      const by = winnerName ? ` • Sbloccato da: ${winnerName}` : '';
      const maxN = 5 + CONFIG.MAX_LEVELS * 8;
      this.el.victoryStats.textContent = `${modeLabel} • 5/${CONFIG.MAX_LEVELS} Livelli completati (Labirinto finale ${maxN}×${maxN}) • Guardiani eliminati: ${this.kills}${by}`;
    }
    this.setScreenState('VICTORY');
    this._syncHud();
  }

  restartArcadeRun() {
    this.level = 1;
    this.seed = Math.floor(Math.random() * 900000) + 1000;
    this.kills = 0;
    this.deadElapsed = 0;
    this.sharedPages = [];
    this.controls.keys.delete('Space');
    this.controls.keys.delete('Enter');
    this.controls.buttons.attackQueued = false;
    this.controls.gamepad.prevAttack = true;
    this.buildLevel(1, this.seed, this.gameMode === 'coop');
    const sp = this.spawnSide === 'B' ? this.maze.spawnB : this.maze.spawnA;
    this.player.resetToFreshRun(sp.x, sp.z);
    this.snapCameraToPlayer();
    this.setScreenState('PLAYING');
    this._syncHud();
    if (this.gameMode === 'coop') {
      this.network.publishLevelAdvance(1, this.seed, this.player.name, false);
      this.network.publishFullRoomSync(this._buildRoomSnapshot());
      this.showToast(`Co-op riavviata — Livello 1/${CONFIG.MAX_LEVELS} (${this.maze.N}×${this.maze.N})!`);
    } else {
      this.showToast(`Partita Singleplayer — Livello 1/${CONFIG.MAX_LEVELS} (${this.maze.N}×${this.maze.N})!`);
    }
  }

  respawnInPvpRoom() {
    if (this.player.alive) return;
    const sp = this.spawnSide === 'B' ? this.maze.spawnB : this.maze.spawnA;
    this.player.collectedPages = [...this.sharedPages];
    this.player.spawnAt(sp.x, sp.z, 0);
    this.snapCameraToPlayer();
    this.setScreenState('PLAYING');
    this.showToast(`Sei rientrato allo Spawn ${this.spawnSide}!`);
    this._syncHud();
  }

  _triggerDamageFlash() {
    this.el.damageFlash.classList.remove('active');
    void this.el.damageFlash.offsetWidth;
    this.el.damageFlash.classList.add('active');
  }

  showToast(text) {
    if (!this.el.toast) return;
    this.el.toast.textContent = text;
    this.el.toast.classList.add('visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.el.toast.classList.remove('visible');
    }, 2400);
  }

  _toggleMusic() {
    const muted = audio.toggleBgmMuted();
    this._syncMusicUi();
    this.showToast(muted ? '🔇 Musica disattivata' : '🔊 Musica attivata');
  }

  _syncMusicUi() {
    const muted = audio.isBgmMuted();
    const label = muted ? '🔇 MUSICA: OFF' : '🔊 MUSICA: ON';
    if (this.el.btnMenuMusic) {
      this.el.btnMenuMusic.textContent = label;
      this.el.btnMenuMusic.classList.toggle('muted', muted);
    }
    if (this.el.btnPauseMusic) {
      this.el.btnPauseMusic.textContent = label;
      this.el.btnPauseMusic.classList.toggle('muted', muted);
    }
    if (this.el.btnHudMusic) {
      this.el.btnHudMusic.textContent = muted ? '🔇' : '🔊';
      this.el.btnHudMusic.classList.toggle('muted', muted);
      this.el.btnHudMusic.title = muted ? 'Musica OFF (Tocca per attivare)' : 'Musica ON (Tocca per disattivare)';
    }
  }

  _bindModals() {
    const closeBtn = document.getElementById('btn-door-close');
    const clearBtn = document.getElementById('btn-door-clear');
    const submitBtn = document.getElementById('btn-door-submit');

    closeBtn?.addEventListener('click', () => this.closeDoorModal());
    clearBtn?.addEventListener('click', () => {
      this.doorEntered = [];
      this._renderDoorSlots();
    });
    submitBtn?.addEventListener('click', () => this._submitDoorCode());

    this.el.btnRestartArcade?.addEventListener('click', () => this.restartArcadeRun());
    this.el.btnRespawnPvp?.addEventListener('click', () => this.respawnInPvpRoom());
    this.el.btnDeathMenu?.addEventListener('click', () => this.returnToMainMenu());
    this.el.btnVictoryRestart?.addEventListener('click', () => this.restartArcadeRun());
    this.el.btnVictoryMenu?.addEventListener('click', () => this.returnToMainMenu());

    this.el.btnMenuSingle?.addEventListener('click', () => this.startSingleplayer());
    this.el.btnMenuCoop?.addEventListener('click', () => this.openCoopModal());
    this.el.btnMenuMulti?.addEventListener('click', () => this.openNetModal());
    this.el.btnMenuMusic?.addEventListener('click', () => this._toggleMusic());

    this.el.btnCoopCopy?.addEventListener('click', () => {
      const code = this.el.coopHostCode?.textContent?.trim() || this.hostRoomCode;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(code).catch(() => null);
      }
      this.showToast(`Codice stanza copiato: ${code}`);
    });
    this.el.btnCoopShare?.addEventListener('click', () => {
      this._shareOrCopyInvite(this.el.coopHostCode?.textContent || this.hostRoomCode);
    });
    this.el.btnPauseShare?.addEventListener('click', () => {
      this._shareOrCopyInvite(this.network?.roomId || this.hostRoomCode);
    });
    this.el.btnCoopHost?.addEventListener('click', () => {
      this.startCoopHost(this.el.coopHostCode?.textContent || this.hostRoomCode);
    });
    this.el.btnCoopJoin?.addEventListener('click', () => {
      this.startCoopGuest(this.el.inpCoopCode?.value);
    });
    this.el.inpCoopCode?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.startCoopGuest(this.el.inpCoopCode.value);
      }
    });
    this.el.btnCoopClose?.addEventListener('click', () => this.closeCoopModal());

    this.el.btnHudMusic?.addEventListener('click', () => this._toggleMusic());
    this.el.btnHudPause?.addEventListener('click', () => this.pauseGame());
    this.el.btnPauseResume?.addEventListener('click', () => this.resumeGame());
    this.el.btnPauseMusic?.addEventListener('click', () => this._toggleMusic());
    this.el.btnPauseRestart?.addEventListener('click', () => this.restartArcadeRun());
    this.el.btnPauseMenu?.addEventListener('click', () => this.returnToMainMenu());

    this.el.btnOpenNet?.addEventListener('click', () => this.openNetModal());
    this.el.btnCloseNet?.addEventListener('click', () => this.closeNetModal());

    this.el.btnNewMaze?.addEventListener('click', () => {
      const nextSeed = Math.floor(Math.random() * 900000) + 1000;
      this.closeNetModal();
      this.buildLevel(1, nextSeed, this.gameMode === 'coop');
      this.setScreenState('PLAYING');
      this.showToast('Nuovo Labirinto Speculare generato!');
    });

    this.el.btnClearFb?.addEventListener('click', () => {
      saveFirebaseConfig(null);
      this.el.inpFbJson.value = '';
      if (this.gameMode === 'coop') {
        this.network.connect(this.el.inpRoom.value || this.network.roomId, this.spawnSide === 'B' ? 'guest' : 'host');
      }
      this.showToast("Modalita' Locale multi-scheda ripristinata");
    });

    this.el.btnSaveNet?.addEventListener('click', () => {
      const side = this.el.inpSpawnSide.value === 'B' ? 'B' : 'A';
      if (side !== this.spawnSide) {
        this.spawnSide = side;
        const sp = side === 'B' ? this.maze.spawnB : this.maze.spawnA;
        this.player.spawnAt(sp.x, sp.z, 0);
        this.snapCameraToPlayer();
      }

      const raw = (this.el.inpFbJson.value || '').trim();
      if (raw) {
        try {
          const parsed = raw.startsWith('http') ? { databaseURL: raw } : JSON.parse(raw);
          saveFirebaseConfig(parsed);
        } catch (_) {
          this.showToast('JSON Firebase non valido (oppure incolla solo databaseURL)');
          return;
        }
      }

      this.closeNetModal();
      const targetRoom = (this.el.inpRoom.value || '').trim();
      if (targetRoom) {
        this.gameMode = 'coop';
        const role = this.spawnSide === 'B' ? 'guest' : 'host';
        this.network.connect(targetRoom, role).then(() => {
          if (role === 'host') this.network.publishFullRoomSync(this._buildRoomSnapshot());
        });
      }
      this.showToast('Impostazioni stanza applicate');
    });
  }

  openDoorModal() {
    this.doorEntered = [];
    this.doorModalOpen = true;
    this.el.modalDoor.classList.remove('hidden');
    this._syncControlsBlocked();
    this._refreshDoorKeypadOwned();
    this._renderDoorSlots();
    this._syncHud();
  }

  _refreshDoorKeypadOwned() {
    if (!this.el.doorKeypad) return;
    const collectedBySlot = new Map(this.player.collectedPages.map((p) => [p.slot, p.symbol]));
    this.el.doorKeypad.innerHTML = '';
    for (const sym of CONFIG.SYMBOLS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sym-btn';
      const owned = [...collectedBySlot.values()].includes(sym);
      if (owned) btn.classList.add('owned');
      btn.textContent = sym;
      btn.addEventListener('click', () => {
        if (this.doorEntered.length >= 5) return;
        this.doorEntered.push(sym);
        this._renderDoorSlots();
      });
      this.el.doorKeypad.appendChild(btn);
    }
  }

  _renderDoorSlots() {
    this.el.doorSlots.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const cell = document.createElement('div');
      cell.className = 'door-slot';
      cell.textContent = this.doorEntered[i] || `${i + 1}`;
      if (this.doorEntered[i]) cell.classList.add('filled');
      cell.addEventListener('click', () => {
        if (this.doorEntered[i]) {
          this.doorEntered.splice(i, 1);
          this._renderDoorSlots();
        }
      });
      this.el.doorSlots.appendChild(cell);
    }
  }

  closeDoorModal() {
    this.doorModalOpen = false;
    this.el.modalDoor?.classList.add('hidden');
    this._syncControlsBlocked();
  }

  _submitDoorCode() {
    if (this.doorEntered.length < 5) {
      this.showToast('Seleziona 5 simboli prima di confermare!');
      return;
    }

    const expected = this.maze.doorCode;
    const isCorrect = expected.every((sym, idx) => this.doorEntered[idx] === sym);

    if (isCorrect) {
      audio.playSuccess();
      this.closeDoorModal();

      if (this.level >= CONFIG.MAX_LEVELS) {
        this.network.publishLevelAdvance(CONFIG.MAX_LEVELS, this.seed, this.player.name, true);
        this._onVictory(this.player.name);
        return;
      }

      const nextLevel = this.level + 1;
      const nextSeed = Math.floor(Math.random() * 900000) + 1000;
      this.network.publishLevelAdvance(nextLevel, nextSeed, this.player.name, false);
      this.buildLevel(nextLevel, nextSeed, false);
      this.showToast(`COMBINAZIONE ESATTA! Livello ${nextLevel}/${CONFIG.MAX_LEVELS} (${this.maze.N}×${this.maze.N})`);
      return;
    }

    // CODICE SBAGLIATO: chiudi UI, 20 danni e teletrasporto punitivo allo spawn!
    audio.playPunish();
    this.closeDoorModal();
    this._triggerDamageFlash();

    const wasShielding = this.player.shieldActive;
    const lastPagesCount = this.player.collectedPages.length;
    this.player.shieldActive = false; // La maledizione della porta non si para con lo scudo
    const res = this.player.takeDamage(
      CONFIG.WRONG_CODE_DAMAGE,
      this.maze,
      this.gameMode === 'coop'
        ? null
        : (dropped) => {
            this._dropPagesToWorld(dropped, false);
          }
    );
    this.player.shieldActive = wasShielding;

    if (res.died) {
      this._onPlayerDied(lastPagesCount);
      this.showToast('Codice Errato! -20 HP fatali!');
    } else {
      this.player.x = this.player.spawn.x;
      this.player.z = this.player.spawn.z;
      this.player.syncTransform();
      this.snapCameraToPlayer();
      this.showToast(`Codice Sbagliato! -${CONFIG.WRONG_CODE_DAMAGE} HP e Teletrasporto allo Spawn!`);
    }
    this._syncHud();
  }

  _handleInteract() {
    if (!this.nearInteractable || !this.player.alive) return;
    if (this.nearInteractable.kind === 'CHEST') {
      const reward = this.nearInteractable.target.open();
      if (!reward) return;
      audio.playChestOpen();
      if (reward.type === 'HEAL') {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + reward.amount);
      } else if (reward.type === 'MAX_HP') {
        this.player.maxHp += reward.amount;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + reward.amount);
      } else if (reward.type === 'DAMAGE') {
        this.player.swordDamage += reward.amount;
      }
      this.network.publishChestOpened(this.nearInteractable.target.id);
      this.showToast(reward.text);
      this._syncHud();
    } else if (this.nearInteractable.kind === 'DOOR') {
      this.openDoorModal();
    }
  }

  _updateWorldLogic(dt) {
    if (!this.maze) return;
    const input = this.controls.poll();

    // Tasto ESC o Start Controller: chiude modali o mette/toglie Pausa
    if (input.pausePressed) {
      if (this.doorModalOpen || !this.el.modalDoor?.classList.contains('hidden')) {
        this.closeDoorModal();
        return;
      }
      if (this.coopModalOpen || !this.el.modalCoop?.classList.contains('hidden')) {
        this.closeCoopModal();
        return;
      }
      if (this.netModalOpen || !this.el.modalNet?.classList.contains('hidden')) {
        this.closeNetModal();
        return;
      }
      if (this.screenState === 'PLAYING') {
        this.pauseGame();
        return;
      }
      if (this.screenState === 'PAUSED') {
        this.resumeGame();
        return;
      }
    }

    // Menu principale: conferma rapida da controller/tastiera (Invio) solo se nessun modale e' aperto
    if (this.screenState === 'MENU' && !this.netModalOpen && !this.coopModalOpen) {
      if (input.confirmPressed || this.controls.keys.has('Enter')) {
        this.controls.keys.delete('Enter');
        this.startSingleplayer();
      }
      return;
    }

    // Game Over: premi Spazio/Invio o Croce/A sul controller dopo 0.65s
    if (this.screenState === 'GAMEOVER') {
      this.deadElapsed += dt;
      if (this.deadElapsed > 0.65) {
        const gp = this.controls._getActiveGamepad?.();
        const padConfirm = Boolean(gp && (gp.buttons?.[0]?.pressed || gp.buttons?.[9]?.pressed));
        const keyConfirm = this.controls.keys.has('Enter') || this.controls.keys.has('Space');
        if (padConfirm || keyConfirm) {
          if (this.gameMode === 'coop') {
            this.respawnInPvpRoom();
          } else {
            this.restartArcadeRun();
          }
        }
      }
      return;
    }

    // In Loading / Pausa / Vittoria la simulazione del labirinto rimane ferma
    if (this.screenState !== 'PLAYING') return;

    if (input.attackPressed || input.dashPressed || input.interactPressed) {
      audio.unlock();
    }

    const activeHitbox = this.player.update(dt, this.maze, input);

    // Fendente spada contro Bot nemici (in Co-op ZERO fuoco amico verso il compagno!)
    if (activeHitbox && this.player.alive) {
      for (const bot of this.bots) {
        if (!bot.alive || activeHitbox.hitTargets.has(bot.id)) continue;
        const d = Math.hypot(bot.x - activeHitbox.x, bot.z - activeHitbox.z);
        if (d <= activeHitbox.radius + CONFIG.BOT_RADIUS) {
          activeHitbox.hitTargets.add(bot.id);
          const dx = bot.x - this.player.x;
          const dz = bot.z - this.player.z;
          const pushX = Math.hypot(dx, dz) > 0.01 ? dx : Math.sin(this.player.rotY);
          const pushZ = Math.hypot(dx, dz) > 0.01 ? dz : Math.cos(this.player.rotY);
          const killed = bot.takeDamage(activeHitbox.damage, pushX, pushZ);
          audio.playHit();
          this.controls.rumble(75, 0.2, 0.4);
          if (killed) {
            this.kills += 1;
            this.showToast('Guardiano del Labirinto eliminato!');
          }
        }
      }

      if (this.gameMode !== 'coop') {
        for (const [pid, remote] of this.network.remotePlayers.entries()) {
          if (!remote.alive || activeHitbox.hitTargets.has(pid)) continue;
          const d = Math.hypot(remote.x - activeHitbox.x, remote.z - activeHitbox.z);
          if (d <= activeHitbox.radius + CONFIG.PLAYER_RADIUS) {
            activeHitbox.hitTargets.add(pid);
            this.network.sendHit(pid, activeHitbox.damage, this.player.x, this.player.z);
            audio.playHit();
            this.controls.rumble(90, 0.25, 0.5);
          }
        }
      }
    }

    // Raccolta dei 5 fogli sul pavimento (condivisi in Co-op!)
    if (this.player.alive) {
      for (const wp of this.pages) {
        wp.update(dt, this.elapsedSec, this.maze, this.player);
        if (wp.collected) continue;
        if (Math.hypot(wp.x - this.player.x, wp.z - this.player.z) < 1.5) {
          this._applySharedPage({
            originalIndex: wp.originalIndex,
            slot: wp.slot,
            symbol: wp.symbol
          }, false);
          audio.playPagePickup();
          this.network.publishPageEvent({
            action: 'PICKUP',
            index: wp.originalIndex,
            slot: wp.slot,
            symbol: wp.symbol
          });
          if (this.gameMode === 'coop') {
            this.network.publishFullRoomSync(this._buildRoomSnapshot());
          }
          this.showToast(`Foglio #${wp.slot} raccolto: ${wp.symbol}`);
        }
      }
    } else {
      for (const wp of this.pages) wp.update(dt, this.elapsedSec, this.maze, this.player);
    }

    // Casse loot: visibili solo con luce + LoS
    for (const ch of this.chests) {
      ch.updateVisibility(this.maze, this.player);
    }

    // Bot verdi lenti: si vedono e attaccano ANCHE mentre il giocatore inserisce il codice del portale!
    for (const bot of this.bots) {
      bot.update(dt, this.maze, this.player, (dmg) => {
        const lastPagesCount = this.player.collectedPages.length;
        const res = this.player.takeDamage(
          dmg,
          this.maze,
          this.gameMode === 'coop'
            ? null
            : (dropped) => {
                this._dropPagesToWorld(dropped, false);
              }
        );
        if (res.blocked) {
          this.controls.rumble(65, 0.35, 0.2);
          this.showToast('Attacco bloccato dallo Scudo!');
        } else {
          this.controls.rumble(140, 0.35, 0.75);
          this._triggerDamageFlash();
          if (res.died) this._onPlayerDied(lastPagesCount);
        }
      });
    }

    // Controllo raggio < 3 per mostrare/nascondere il tasto Interagisci (Viola)
    this.nearInteractable = null;
    if (this.player.alive) {
      const doorDist = Math.hypot(this.player.x - this.door.x, this.player.z - this.door.z);
      if (doorDist < CONFIG.INTERACT_RADIUS) {
        this.nearInteractable = { kind: 'DOOR', target: this.door };
      } else {
        let bestChest = null;
        let bestDist = CONFIG.INTERACT_RADIUS;
        for (const ch of this.chests) {
          if (ch.opened) continue;
          const d = Math.hypot(ch.x - this.player.x, ch.z - this.player.z);
          if (d < bestDist) {
            bestDist = d;
            bestChest = ch;
          }
        }
        if (bestChest) {
          this.nearInteractable = { kind: 'CHEST', target: bestChest };
        }
      }
    }

    if (this.nearInteractable) {
      const label = this.nearInteractable.kind === 'DOOR' ? 'PORTA' : 'APRI';
      this.controls.setInteractVisible(true, label);
    } else {
      this.controls.setInteractVisible(false);
    }

    if (input.interactPressed && this.nearInteractable) {
      this._handleInteract();
    }

    // Cooldown grafico sul pulsante Scatto / Dash
    this.controls.setDashCooldownRatio(this.player.dashCooldown / CONFIG.DASH_COOLDOWN);

    // Sincronizzazione multiplayer e visibilita' condizionale dei rivali
    this.network.pruneStaleLocalPeers();
    this.network.publishPlayerState(dt, this.player, this.spawnSide);
    for (const [pid, vis] of this.remoteVisuals.entries()) {
      const data = this.network.remotePlayers.get(pid);
      vis.sync(dt, data, this.maze, this.player);
    }

    this._updateCamera(dt);
    this._syncHud();
  }

  _syncHud() {
    if (!this.maze) return;
    const pct = Math.max(0, Math.min(100, (this.player.hp / this.player.maxHp) * 100));
    this.el.hpFill.style.width = `${pct}%`;
    this.el.hpText.textContent = `${Math.ceil(this.player.hp)} / ${this.player.maxHp} HP`;
    this.el.levelBadge.textContent = `LIVELLO ${this.level}/${CONFIG.MAX_LEVELS} (${this.maze.N}×${this.maze.N})`;

    const aliveBots = this.bots.filter((b) => b.alive).length;
    const peers = this.network.remotePlayers.size;
    const padTxt = this.controls.gamepad.connected ? ' • 🎮 Pad' : '';
    const modeTxt = this.gameMode === 'coop' ? ` • Co-op:${peers + 1}` : '';
    this.el.statsLine.textContent = `Spada: ${this.player.swordDamage} DMG • Bot: ${aliveBots}${modeTxt}${padTxt}`;

    if (this.doorModalOpen && this.el.doorHint) {
      this.el.doorHint.textContent = `⚠️ ATTENZIONE: i Guardiani ti attaccano mentre scrivi! • ❤️ ${Math.ceil(this.player.hp)}/${this.player.maxHp} HP • Fogli: ${this.player.collectedPages.length}/5`;
    }

    // 5 slot centrati in alto in font monospace
    const bySlot = new Map(this.player.collectedPages.map((p) => [p.slot, p.symbol]));
    const slotEls = this.el.pageSlots.querySelectorAll('.hud-slot');
    slotEls.forEach((slotEl, i) => {
      const slotNum = i + 1;
      const sym = bySlot.get(slotNum);
      slotEl.textContent = sym || String(slotNum);
      slotEl.classList.toggle('collected', Boolean(sym));
    });
  }

  _loop(now) {
    if (!this.lastTime) this.lastTime = now;
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.elapsedSec += dt;

    if (this.maze) {
      this._updateWorldLogic(dt);
      if (this.screenState !== 'LOADING' && this.screenState !== 'MENU') {
        this.renderer.render(this.scene, this.camera);
      }
    }

    requestAnimationFrame((t) => this._loop(t));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.__mazeRoyaleApp = new MazeRoyaleApp();
});
