/**
 * main.js
 * Core application orchestrator for Gojo Cursed Techniques AR.
 * Features:
 * - Decoupled 20 FPS MediaPipe hand tracking with 60 FPS Three.js interpolation
 * - GPU-Accelerated Shader Particles with zero per-frame memory allocations
 * - Adaptive Quality Engine dynamically balancing FPS on integrated GPUs
 * - Permanent 60 FPS cursed energy handlines & joint dots
 * - Low-overhead performance HUD updating at 3 Hz
 */

import { CameraManager } from './camera.js';
import { HandTracker, HAND_LANDMARKS } from './handTracking.js';
import { GestureRecognizer, TECHNIQUE_STATES } from './gestureRecognition.js';
import { BlueEffect } from './effects/blue.js';
import { RedEffect } from './effects/red.js';
import { HollowPurpleEffect } from './effects/hollowPurple.js';
import { QualityManager } from './qualityManager.js';
import { soundEngine } from './audio.js';
import { screenToThreeWorld, clamp } from './utils.js';

// Preallocated static coordinate containers (Zero GC in animation loop)
const _leftWorld = { x: 0, y: 0, z: 0 };
const _rightWorld = { x: 0, y: 0, z: 0 };
const _aimWorld = { x: 0, y: 0, z: 0 };

class App {
  constructor() {
    // DOM Elements
    this.container = document.getElementById('app-container');
    this.videoElement = document.getElementById('webcam-video');
    this.webglCanvas = document.getElementById('webgl-canvas');
    this.debugCanvas = document.getElementById('debug-canvas');

    // UI Elements
    this.startScreen = document.getElementById('start-screen');
    this.startBtn = document.getElementById('start-btn');
    this.hud = document.getElementById('hud');
    this.techniqueBadge = document.getElementById('technique-badge');
    this.techniqueText = document.getElementById('technique-text');
    this.techniqueKanji = document.getElementById('technique-kanji');
    this.hintText = document.getElementById('hint-text');
    this.muteBtn = document.getElementById('mute-btn');
    this.debugBtn = document.getElementById('debug-btn');
    this.fpsCounter = document.getElementById('fps-counter');
    this.debugPanel = document.getElementById('debug-panel');
    this.errorModal = document.getElementById('error-modal');
    this.errorMessage = document.getElementById('error-message');
    this.errorClose = document.getElementById('error-close');

    // Three.js Core
    this.scene = null;
    this.camera = null;
    this.renderer = null;

    // Subsystems
    this.qualityManager = null;
    this.cameraManager = null;
    this.handTracker = null;
    this.gestureRecognizer = new GestureRecognizer();

    // VFX
    this.blueEffect = null;
    this.redEffect = null;
    this.hollowPurpleEffect = null;

    // State
    this.isRunning = false;
    this.debugMode = false;
    this.previousState = TECHNIQUE_STATES.NEUTRAL;
    this.latestGestureState = {
      state: TECHNIQUE_STATES.NEUTRAL,
      confidence: 0,
      purpleProgress: 0,
      aimTarget: { x: 0.5, y: 0.5, z: 0 },
      aimDirection: { x: 0, y: -1 }
    };

    // Performance & Timing
    this.clock = new THREE.Clock();
    this.frameCount = 0;
    this.fpsTimer = 0;
    this.currentFps = 60;
    this.hudUpdateTimer = 0;

    this._initEvents();
  }

  _initEvents() {
    this.startBtn.addEventListener('click', () => this.startExperience());
    this.muteBtn.addEventListener('click', () => this.toggleMute());
    this.debugBtn.addEventListener('click', () => this.toggleDebug());
    if (this.errorClose) {
      this.errorClose.addEventListener('click', () => {
        this.errorModal.classList.add('hidden');
      });
    }

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') {
        this.toggleDebug();
      } else if (e.key === 'm' || e.key === 'M') {
        this.toggleMute();
      } else if (e.key === 'f' || e.key === 'F') {
        this.toggleFullscreen();
      }
    });

    window.addEventListener('resize', () => this._onResize());
  }

  async startExperience() {
    this.startBtn.disabled = true;
    this.startBtn.textContent = 'INITIALIZING CURSED ENERGY...';

    try {
      soundEngine.init();

      // Setup Three.js WebGL Scene with adaptive quality settings
      this._initThree();

      // Initialize Camera at optimal 640x480 resolution for low CPU load
      this.cameraManager = new CameraManager(
        this.videoElement,
        (meta) => this._onCameraReady(meta),
        (err) => this._onCameraError(err)
      );

      const cameraStarted = await this.cameraManager.start();
      if (!cameraStarted) {
        this.startBtn.disabled = false;
        this.startBtn.textContent = 'START EXPERIENCE';
        return;
      }

      // Initialize Decoupled Hand Tracker (~20 FPS)
      this.handTracker = new HandTracker(this.videoElement, this.debugCanvas);
      this.handTracker.setTargetTrackingFps(this.qualityManager.params.trackingFps);
      await this.handTracker.init((trackingData) => this._onHandResults(trackingData));
      this.handTracker.start();

      // Configure Quality Change Handler
      this.qualityManager.onTierChange = (params) => {
        if (this.handTracker) {
          this.handTracker.setTargetTrackingFps(params.trackingFps);
        }
        if (this.blueEffect) this.blueEffect.setParticleBudget(params.blueParticles);
        if (this.redEffect) this.redEffect.setParticleBudget(params.redParticles);
        if (this.hollowPurpleEffect) this.hollowPurpleEffect.setParticleBudget(params.purpleParticles);
      };

      // Set initial particle budgets
      this.blueEffect.setParticleBudget(this.qualityManager.params.blueParticles);
      this.redEffect.setParticleBudget(this.qualityManager.params.redParticles);
      this.hollowPurpleEffect.setParticleBudget(this.qualityManager.params.purpleParticles);

      // Hide Start Screen & Show AR HUD
      this.startScreen.classList.add('fade-out');
      setTimeout(() => {
        this.startScreen.style.display = 'none';
        this.hud.classList.remove('hidden');
      }, 500);

      this.isRunning = true;
      this._animate();
    } catch (err) {
      console.error('Failed to start experience:', err);
      this._showError(err.message || 'An unexpected error occurred during startup.');
      this.startBtn.disabled = false;
      this.startBtn.textContent = 'START EXPERIENCE';
    }
  }

  _initThree() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
    this.camera.position.set(0, 0, 5);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.webglCanvas,
      alpha: true,
      antialias: false, // Disabled for integrated GPU speedup
      powerPreference: 'high-performance'
    });

    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    // Initialize Adaptive Quality Manager with GPU Detection
    this.qualityManager = new QualityManager(this.renderer);
    this.renderer.setPixelRatio(this.qualityManager.params.pixelRatio);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);

    // Initialize GPU-Accelerated VFX
    this.blueEffect = new BlueEffect(this.scene);
    this.redEffect = new RedEffect(this.scene);
    this.hollowPurpleEffect = new HollowPurpleEffect(this.scene, (intensity) => this.triggerScreenShake(intensity));

    this._onResize();
  }

  _onCameraReady(meta) {
    this._onResize();
  }

  _onCameraError(err) {
    this._showError(err.message);
  }

  _showError(msg) {
    if (this.errorMessage) this.errorMessage.textContent = msg;
    if (this.errorModal) this.errorModal.classList.remove('hidden');
  }

  _onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    if (this.camera && this.renderer) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    }

    if (this.debugCanvas) {
      this.debugCanvas.width = width;
      this.debugCanvas.height = height;
    }
  }

  toggleMute() {
    const muted = soundEngine.toggleMute();
    this.muteBtn.innerHTML = muted
      ? `<span class="icon">🔇</span> MUTED`
      : `<span class="icon">🔊</span> AUDIO ON`;
    this.muteBtn.classList.toggle('active', muted);
  }

  toggleDebug() {
    this.debugMode = !this.debugMode;
    this.debugBtn.classList.toggle('active', this.debugMode);
    if (this.debugPanel) {
      this.debugPanel.classList.toggle('hidden', !this.debugMode);
    }
    if (this.handTracker) {
      this.handTracker.setDebugMode(this.debugMode);
    }
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  triggerScreenShake(intensity = 1.0) {
    this.container.classList.remove('screen-shake');
    void this.container.offsetWidth;
    this.container.classList.add('screen-shake');
    setTimeout(() => {
      this.container.classList.remove('screen-shake');
    }, 550);
  }

  /**
   * Called ONLY when MediaPipe yields new landmark data (~20 FPS)
   * Gesture classification is executed here rather than 60 times/sec.
   */
  _onHandResults(trackingData) {
    this.latestGestureState = this.gestureRecognizer.update(trackingData);
    this._handleStateTransitions(this.latestGestureState, trackingData);

    if (this.debugMode) {
      this._updateDebugPanel(this.latestGestureState, trackingData);
    }
  }

  _handleStateTransitions(gestureState, trackingData) {
    const { state } = gestureState;

    if (this.handTracker) {
      this.handTracker.setTechniqueState(state);
    }

    // Handle Audio & Technique transitions
    switch (state) {
      case TECHNIQUE_STATES.NEUTRAL:
        this.blueEffect.setActive(false);
        this.redEffect.setActive(false);
        this.hollowPurpleEffect.reset();
        soundEngine.stopBlueHum();
        soundEngine.stopRedCrackle();
        soundEngine.stopPurpleCharge();
        break;

      case TECHNIQUE_STATES.BLUE:
        this.redEffect.setActive(false);
        this.hollowPurpleEffect.reset();
        this.blueEffect.setActive(true);
        soundEngine.stopRedCrackle();
        soundEngine.stopPurpleCharge();
        soundEngine.startBlueHum();
        break;

      case TECHNIQUE_STATES.RED:
        this.blueEffect.setActive(false);
        this.hollowPurpleEffect.reset();
        this.redEffect.setActive(true);
        soundEngine.stopBlueHum();
        soundEngine.stopPurpleCharge();
        soundEngine.startRedCrackle();
        if (this.previousState !== TECHNIQUE_STATES.RED) {
          soundEngine.playRedPulse();
        }
        break;

      case TECHNIQUE_STATES.CHARGING_PURPLE:
        this.blueEffect.setActive(false);
        this.redEffect.setActive(false);
        soundEngine.stopBlueHum();
        soundEngine.stopRedCrackle();

        if (this.previousState !== TECHNIQUE_STATES.CHARGING_PURPLE) {
          this.hollowPurpleEffect.startCharging();
          soundEngine.startPurpleCharge();
        }
        break;

      case TECHNIQUE_STATES.HOLLOW_PURPLE_READY:
        this.blueEffect.setActive(false);
        this.redEffect.setActive(false);
        soundEngine.stopBlueHum();
        soundEngine.stopRedCrackle();
        soundEngine.stopPurpleCharge();

        if (this.previousState !== TECHNIQUE_STATES.HOLLOW_PURPLE_READY) {
          this.hollowPurpleEffect.setReady();
        }
        break;

      case TECHNIQUE_STATES.RELEASED:
        if (this.previousState !== TECHNIQUE_STATES.RELEASED) {
          const aimScreen = gestureState.aimTarget || { x: 0.5, y: 0.5 };
          const world = screenToThreeWorld(aimScreen.x, aimScreen.y, 0, this.camera, this.renderer);
          this.hollowPurpleEffect.launch(
            new THREE.Vector3(world.x, world.y, world.z),
            gestureState.aimDirection || { x: 0, y: -1 }
          );
          soundEngine.playPurpleLaunch();
        }
        break;
    }

    this._updateHUD(state, gestureState.purpleProgress);
    this.previousState = state;
  }

  _updateHUD(state, purpleProgress) {
    if (!this.techniqueBadge) return;
    this.techniqueBadge.className = 'technique-badge';

    switch (state) {
      case TECHNIQUE_STATES.NEUTRAL:
        this.techniqueBadge.classList.add('badge-neutral');
        this.techniqueKanji.textContent = '無下限';
        this.techniqueText.textContent = 'NEUTRAL';
        this.hintText.textContent = 'Open palm for Blue, or point index for Red';
        break;

      case TECHNIQUE_STATES.BLUE:
        this.techniqueBadge.classList.add('badge-blue');
        this.techniqueKanji.textContent = '術式順転「蒼」';
        this.techniqueText.textContent = 'LAPSE: BLUE';
        this.hintText.textContent = 'Gravitational singularity active. Move hand to drag space!';
        break;

      case TECHNIQUE_STATES.RED:
        this.techniqueBadge.classList.add('badge-red');
        this.techniqueKanji.textContent = '術式反転「赫」';
        this.techniqueText.textContent = 'REVERSAL: RED';
        this.hintText.textContent = 'Divergent repulsion active. Point finger to direct!';
        break;

      case TECHNIQUE_STATES.CHARGING_PURPLE:
        this.techniqueBadge.classList.add('badge-charging');
        this.techniqueKanji.textContent = '虚式「茈」融合中';
        const pct = Math.round(purpleProgress * 100);
        this.techniqueText.textContent = `COLLIDING... ${pct}%`;
        this.hintText.textContent = 'Blue and Red are colliding! Hold hands close...';
        break;

      case TECHNIQUE_STATES.HOLLOW_PURPLE_READY:
        this.techniqueBadge.classList.add('badge-purple');
        this.techniqueKanji.textContent = '虚式「茈」完成';
        this.techniqueText.textContent = 'PURPLE READY (AIM)';
        this.hintText.textContent = 'IMAGINARY MASS CREATED! Move to aim, THRUST FORWARD TO LAUNCH!';
        break;

      case TECHNIQUE_STATES.RELEASED:
        this.techniqueBadge.classList.add('badge-released');
        this.techniqueKanji.textContent = '虚式「茈」発射';
        this.techniqueText.textContent = 'HOLLOW PURPLE LAUNCHED!';
        this.hintText.textContent = 'Destructive imaginary mass unleashed!';
        break;
    }
  }

  _updateDebugPanel(gestureState, trackingData) {
    if (!this.debugPanel) return;
    const { leftHandGesture, rightHandGesture, palmDistance, confidence } = gestureState;
    const hands = trackingData.hands;

    let html = `
      <div class="dbg-title">AR DIAGNOSTICS [KEY: D]</div>
      <div class="dbg-row"><span>Render FPS:</span> <b>${this.currentFps}</b></div>
      <div class="dbg-row"><span>Tracking FPS:</span> <b>${trackingData.trackingFps || 20}</b></div>
      <div class="dbg-row"><span>Quality Tier:</span> <b style="color:#00f0ff">${this.qualityManager ? this.qualityManager.currentTier : 'HIGH'}</b></div>
      <div class="dbg-row"><span>State:</span> <b style="color:#00f0ff">${gestureState.state}</b></div>
      <div class="dbg-row"><span>Hands Tracked:</span> <b>${hands.length}</b></div>
      <div class="dbg-row"><span>Palm Distance:</span> <b>${palmDistance.toFixed(3)}</b></div>
    `;

    hands.forEach((h, idx) => {
      const f = h.fingers || {};
      html += `
        <div class="dbg-hand">
          <b>Hand ${idx + 1} (${h.handedness || 'Tracked'}):</b>
          <div>Scale: ${(h.palmScale || 0).toFixed(3)}</div>
        </div>
      `;
    });

    this.debugPanel.innerHTML = html;
  }

  /**
   * Main 60 FPS Three.js Animation Render Loop
   * NEVER waits for MediaPipe. Uses smoothly interpolated hand landmarks.
   */
  _animate() {
    requestAnimationFrame(() => this._animate());

    const now = performance.now();
    const dt = Math.min(this.clock.getDelta(), 0.08);

    // 1. Calculate Rendering FPS
    this.frameCount++;
    this.fpsTimer += dt;
    this.hudUpdateTimer += dt;

    if (this.fpsTimer >= 0.5) {
      this.currentFps = Math.round(this.frameCount / this.fpsTimer);
      this.frameCount = 0;
      this.fpsTimer = 0;
    }

    // 2. Update Adaptive Quality Engine & Performance HUD at 3 Hz (Every ~330ms)
    if (this.hudUpdateTimer >= 0.33) {
      this.hudUpdateTimer = 0;
      const qual = this.qualityManager ? this.qualityManager.update(this.currentFps) : null;

      if (this.fpsCounter && qual) {
        let activeParts = 0;
        const state = this.latestGestureState.state;
        if (state === TECHNIQUE_STATES.BLUE) activeParts = qual.blueParticles;
        else if (state === TECHNIQUE_STATES.RED) activeParts = qual.redParticles;
        else if (state.includes('PURPLE')) activeParts = qual.purpleParticles;

        const trackFps = this.handTracker ? this.handTracker.trackingFps : 20;
        this.fpsCounter.textContent = `FPS: ${this.currentFps} | TRACK: ${trackFps} | QUAL: ${qual.tier} | PARTS: ${activeParts}`;
      }
    }

    // 3. Interpolate Hand Positions at 60 FPS
    let interpolatedHands = [];
    if (this.handTracker) {
      interpolatedHands = this.handTracker.getInterpolatedHands(now);

      // Render Cursed Energy Handlines and Joint Dots at 60 FPS
      const enableBlur = this.qualityManager ? this.qualityManager.params.enableGlowBlur : true;
      this.handTracker.renderHandSkeleton(interpolatedHands, enableBlur);
    }

    // 4. Update Spatially-Attached Visual Effects at 60 FPS
    if (interpolatedHands.length > 0) {
      let leftHand = null;
      let rightHand = null;
      if (interpolatedHands.length === 1) {
        leftHand = interpolatedHands[0];
      } else {
        if (interpolatedHands[0].palmCenter.x < interpolatedHands[1].palmCenter.x) {
          leftHand = interpolatedHands[0];
          rightHand = interpolatedHands[1];
        } else {
          leftHand = interpolatedHands[1];
          rightHand = interpolatedHands[0];
        }
      }

      const targetZ = 0;
      if (leftHand) {
        const p = leftHand.palmCenter;
        const w = screenToThreeWorld(p.x, p.y, targetZ, this.camera, this.renderer);
        _leftWorld.x = w.x; _leftWorld.y = w.y; _leftWorld.z = w.z;
      }
      if (rightHand) {
        const p = rightHand.palmCenter;
        const w = screenToThreeWorld(p.x, p.y, targetZ, this.camera, this.renderer);
        _rightWorld.x = w.x; _rightWorld.y = w.y; _rightWorld.z = w.z;
      }

      const state = this.latestGestureState.state;
      if (state === TECHNIQUE_STATES.BLUE) {
        const primary = leftHand || rightHand;
        const w = (primary === leftHand) ? _leftWorld : _rightWorld;
        const scale = (primary.palmScale || 0.15) * 8.0;
        this.blueEffect.setTarget(w.x, w.y, w.z, scale);
      } else if (state === TECHNIQUE_STATES.RED) {
        const primary = rightHand || leftHand;
        const tip = primary.fingertips.index || primary.palmCenter;
        const w = screenToThreeWorld(tip.x, tip.y, targetZ, this.camera, this.renderer);
        const scale = (primary.palmScale || 0.15) * 8.0;
        this.redEffect.setTarget(w.x, w.y, w.z, scale);
      } else if (state === TECHNIQUE_STATES.CHARGING_PURPLE) {
        this.hollowPurpleEffect.setHandPositions(
          new THREE.Vector3(_leftWorld.x, _leftWorld.y, _leftWorld.z),
          new THREE.Vector3(_rightWorld.x, _rightWorld.y, _rightWorld.z),
          this.latestGestureState.palmDistance
        );
      } else if (state === TECHNIQUE_STATES.HOLLOW_PURPLE_READY) {
        const aim = this.latestGestureState.aimTarget || { x: 0.5, y: 0.5 };
        const w = screenToThreeWorld(aim.x, aim.y, targetZ, this.camera, this.renderer);
        _aimWorld.x = w.x; _aimWorld.y = w.y; _aimWorld.z = w.z;
      }
    }

    // 5. Update GPU Effects
    if (this.blueEffect) this.blueEffect.update(dt);
    if (this.redEffect) this.redEffect.update(dt);
    if (this.hollowPurpleEffect) {
      const prog = this.latestGestureState.purpleProgress;
      this.hollowPurpleEffect.update(dt, prog, _aimWorld);
    }

    // 6. Render WebGL Frame
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.gojoApp = new App();
});
