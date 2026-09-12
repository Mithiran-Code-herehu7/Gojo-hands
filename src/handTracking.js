/**
 * handTracking.js
 * High-performance, decoupled hand tracking engine for low-end hardware.
 * Runs MediaPipe at 18–22 FPS independently from the 60 FPS Three.js rendering loop.
 * Caches landmarks and provides 60 FPS smooth interpolation, gesture caching,
 * and real-time cursed energy handlines and joint dots rendering.
 */

import { Point3DSmoother, distance2D, lerp, clamp } from './utils.js';

export const HAND_LANDMARKS = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20
};

// Hand skeleton connections for 21 landmarks
const SKELETON_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // Index
  [0, 9], [9, 10], [10, 11], [11, 12], // Middle
  [0, 13], [13, 14], [14, 15], [15, 16], // Ring
  [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
  [5, 9], [9, 13], [13, 17] // Knuckles
];

export class HandTracker {
  constructor(videoElement, debugCanvas = null) {
    this.video = videoElement;
    this.debugCanvas = debugCanvas;
    this.debugCtx = debugCanvas ? debugCanvas.getContext('2d') : null;
    this.hands = null;
    this.isTracking = false;
    this.debugMode = false;
    this.techniqueState = 'NEUTRAL';

    // Target tracking frequency (18-22 FPS for low CPU load)
    this.targetFps = 20;
    this.targetInterval = 1000 / 20;
    this.trackingFps = 20;
    this.trackingFrames = 0;
    this.trackingFpsTimer = 0;

    // Concurrency lock
    this.isProcessing = false;
    this.lastProcessTime = 0;

    // Landmark Cache for 60 FPS Interpolation
    this.cachedHands = [];
    this.previousHands = [];
    this.lastDetectionTime = performance.now();
    this.detectionInterval = 50; // ms

    // Preallocated interpolated array (avoids GC)
    this.interpolatedHands = [];

    // Smoothers
    this.smoothers = [
      Array.from({ length: 21 }, () => new Point3DSmoother(0.55)),
      Array.from({ length: 21 }, () => new Point3DSmoother(0.55))
    ];
    this.palmCenterSmoothers = [new Point3DSmoother(0.6), new Point3DSmoother(0.6)];

    this.onResultsCallback = null;
  }

  setTargetTrackingFps(fps) {
    this.targetFps = clamp(fps, 12, 30);
    this.targetInterval = 1000 / this.targetFps;
  }

  async init(onResults) {
    this.onResultsCallback = onResults;

    if (typeof window.Hands === 'undefined') {
      throw new Error('MediaPipe Hands script not loaded from CDN.');
    }

    this.hands = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    // ModelComplexity: 0 is the Lite model, perfect for integrated GPUs
    this.hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 0,
      minDetectionConfidence: 0.62,
      minTrackingConfidence: 0.55
    });

    this.hands.onResults((results) => this._handleResults(results));
    return true;
  }

  start() {
    if (this.isTracking || !this.hands) return;
    this.isTracking = true;

    // Independent non-blocking tracking loop (~20 FPS)
    const trackingLoop = async () => {
      if (!this.isTracking) return;

      const now = performance.now();
      const elapsed = now - this.lastProcessTime;

      if (!this.isProcessing && elapsed >= this.targetInterval && this.video.readyState >= 2) {
        this.isProcessing = true;
        this.lastProcessTime = now;

        // Measure tracking FPS
        this.trackingFrames++;
        if (now - this.trackingFpsTimer >= 1000) {
          this.trackingFps = this.trackingFrames;
          this.trackingFrames = 0;
          this.trackingFpsTimer = now;
        }

        try {
          await this.hands.send({ image: this.video });
        } catch (err) {
          // Gracefully skip dropped frames without crash
        } finally {
          this.isProcessing = false;
        }
      }

      // Keep tracking frequency independent from rendering
      setTimeout(trackingLoop, 12);
    };

    trackingLoop();
  }

  stop() {
    this.isTracking = false;
  }

  setDebugMode(enabled) {
    this.debugMode = enabled;
  }

  setTechniqueState(state) {
    this.techniqueState = state;
  }

  /**
   * Internal MediaPipe Result Callback (Runs at ~20 FPS)
   */
  _handleResults(results) {
    const now = performance.now();
    this.detectionInterval = Math.max(16, now - this.lastDetectionTime);
    this.lastDetectionTime = now;

    const rawHands = results.multiHandLandmarks || [];
    const handednessList = results.multiHandedness || [];
    const count = rawHands.length;

    // Move current hands to previous for interpolation
    this.previousHands = this.cachedHands;
    const newProcessedHands = [];

    for (let h = 0; h < count; h++) {
      const rawLandmarks = rawHands[h];
      const handedness = handednessList[h] ? handednessList[h].label : (h === 0 ? 'Right' : 'Left');
      const smoothedLandmarks = [];

      for (let i = 0; i < 21; i++) {
        const raw = rawLandmarks[i];
        // Mirror X horizontally for natural selfie AR camera
        const mirroredX = 1.0 - raw.x;
        const smoothed = this.smoothers[h][i].update(mirroredX, raw.y, raw.z || 0);
        smoothedLandmarks.push(smoothed);
      }

      // Palm Center: average of wrist (0), index_mcp (5), pinky_mcp (17), middle_mcp (9)
      const rawPalmX = (smoothedLandmarks[0].x + smoothedLandmarks[5].x + smoothedLandmarks[9].x + smoothedLandmarks[17].x) * 0.25;
      const rawPalmY = (smoothedLandmarks[0].y + smoothedLandmarks[5].y + smoothedLandmarks[9].y + smoothedLandmarks[17].y) * 0.25;
      const rawPalmZ = (smoothedLandmarks[0].z + smoothedLandmarks[5].z + smoothedLandmarks[9].z + smoothedLandmarks[17].z) * 0.25;

      const palmCenter = this.palmCenterSmoothers[h].update(rawPalmX, rawPalmY, rawPalmZ);
      const palmScale = distance2D(smoothedLandmarks[0], smoothedLandmarks[9]);

      const fingertips = {
        thumb: smoothedLandmarks[HAND_LANDMARKS.THUMB_TIP],
        index: smoothedLandmarks[HAND_LANDMARKS.INDEX_TIP],
        middle: smoothedLandmarks[HAND_LANDMARKS.MIDDLE_TIP],
        ring: smoothedLandmarks[HAND_LANDMARKS.RING_TIP],
        pinky: smoothedLandmarks[HAND_LANDMARKS.PINKY_TIP]
      };

      const wrist = smoothedLandmarks[HAND_LANDMARKS.WRIST];
      const aimVector = {
        x: fingertips.index.x - wrist.x,
        y: fingertips.index.y - wrist.y,
        z: fingertips.index.z - wrist.z
      };
      const len = Math.sqrt(aimVector.x * aimVector.x + aimVector.y * aimVector.y) || 1;
      aimVector.normalizedX = aimVector.x / len;
      aimVector.normalizedY = aimVector.y / len;

      newProcessedHands.push({
        index: h,
        handedness,
        landmarks: smoothedLandmarks,
        palmCenter,
        fingertips,
        wrist,
        palmScale,
        aimVector,
        timestamp: now
      });
    }

    this.cachedHands = newProcessedHands;

    // Notify gesture recognizer ONLY when new MediaPipe data arrives
    if (this.onResultsCallback) {
      this.onResultsCallback({
        handsCount: count,
        hands: this.cachedHands,
        timestamp: now,
        trackingFps: this.trackingFps
      });
    }
  }

  /**
   * Called every render frame (60 FPS) to get smoothly interpolated hand landmarks
   */
  getInterpolatedHands(now) {
    const count = this.cachedHands.length;
    if (count === 0) return [];

    const elapsed = now - this.lastDetectionTime;
    // Normalized interpolation factor between tracking frames
    const alpha = clamp(elapsed / this.detectionInterval, 0.0, 1.25);

    // Reuse preallocated array
    while (this.interpolatedHands.length < count) {
      this.interpolatedHands.push({
        index: 0,
        handedness: 'Right',
        landmarks: Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 })),
        palmCenter: { x: 0, y: 0, z: 0 },
        fingertips: { thumb: null, index: null, middle: null, ring: null, pinky: null },
        aimVector: { normalizedX: 0, normalizedY: -1 },
        palmScale: 0.15
      });
    }

    for (let h = 0; h < count; h++) {
      const cur = this.cachedHands[h];
      const prev = (this.previousHands && this.previousHands[h]) ? this.previousHands[h] : cur;
      const target = this.interpolatedHands[h];

      target.index = cur.index;
      target.handedness = cur.handedness;
      target.palmScale = cur.palmScale;
      target.aimVector = cur.aimVector;

      // Interpolate Palm Center
      target.palmCenter.x = lerp(prev.palmCenter.x, cur.palmCenter.x, alpha);
      target.palmCenter.y = lerp(prev.palmCenter.y, cur.palmCenter.y, alpha);
      target.palmCenter.z = lerp(prev.palmCenter.z, cur.palmCenter.z, alpha);

      // Interpolate 21 Landmarks
      for (let i = 0; i < 21; i++) {
        const pPt = prev.landmarks[i];
        const cPt = cur.landmarks[i];
        target.landmarks[i].x = lerp(pPt.x, cPt.x, alpha);
        target.landmarks[i].y = lerp(pPt.y, cPt.y, alpha);
        target.landmarks[i].z = lerp(pPt.z, cPt.z, alpha);
      }

      target.fingertips.thumb = target.landmarks[HAND_LANDMARKS.THUMB_TIP];
      target.fingertips.index = target.landmarks[HAND_LANDMARKS.INDEX_TIP];
      target.fingertips.middle = target.landmarks[HAND_LANDMARKS.MIDDLE_TIP];
      target.fingertips.ring = target.landmarks[HAND_LANDMARKS.RING_TIP];
      target.fingertips.pinky = target.landmarks[HAND_LANDMARKS.PINKY_TIP];
    }

    return this.interpolatedHands.slice(0, count);
  }

  /**
   * Renders glowing cursed energy handlines and joint dots (Called at 60 FPS)
   */
  renderHandSkeleton(interpolatedHands, enableGlowBlur = true) {
    if (!this.debugCtx || !this.debugCanvas) return;
    const ctx = this.debugCtx;
    const canvas = this.debugCanvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!interpolatedHands || interpolatedHands.length === 0) return;

    // Color based on active technique
    let lineColor = 'rgba(0, 240, 255, 0.75)';
    let glowColor = '#00f0ff';
    let jointColor = '#ffffff';

    if (this.techniqueState === 'BLUE') {
      lineColor = 'rgba(0, 220, 255, 0.85)';
      glowColor = '#00f0ff';
      jointColor = '#80f5ff';
    } else if (this.techniqueState === 'RED') {
      lineColor = 'rgba(255, 0, 60, 0.85)';
      glowColor = '#ff003c';
      jointColor = '#ffb3c0';
    } else if (this.techniqueState === 'CHARGING_PURPLE' || this.techniqueState === 'HOLLOW_PURPLE_READY') {
      lineColor = 'rgba(180, 50, 255, 0.9)';
      glowColor = '#c840ff';
      jointColor = '#f0c8ff';
    }

    ctx.save();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (enableGlowBlur) {
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 10;
    }

    const w = canvas.width;
    const h = canvas.height;

    for (let hIdx = 0; hIdx < interpolatedHands.length; hIdx++) {
      const hand = interpolatedHands[hIdx];
      const pts = hand.landmarks;

      // Draw skeleton lines
      ctx.beginPath();
      for (let c = 0; c < SKELETON_CONNECTIONS.length; c++) {
        const p1 = pts[SKELETON_CONNECTIONS[c][0]];
        const p2 = pts[SKELETON_CONNECTIONS[c][1]];
        ctx.moveTo(p1.x * w, p1.y * h);
        ctx.lineTo(p2.x * w, p2.y * h);
      }
      ctx.stroke();

      // Draw 21 joint dots
      for (let i = 0; i < 21; i++) {
        const pt = pts[i];
        const px = pt.x * w;
        const py = pt.y * h;
        const isTip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;

        ctx.fillStyle = glowColor;
        ctx.beginPath();
        ctx.arc(px, py, isTip ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = jointColor;
        ctx.beginPath();
        ctx.arc(px, py, isTip ? 3 : 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Palm core node
      const pcX = hand.palmCenter.x * w;
      const pcY = hand.palmCenter.y * h;
      ctx.fillStyle = glowColor;
      ctx.beginPath();
      ctx.arc(pcX, pcY, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(pcX, pcY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
