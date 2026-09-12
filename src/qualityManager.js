/**
 * qualityManager.js
 * Adaptive Dynamic Quality Engine for low-end laptops and integrated GPUs.
 * Monitors real-time rendering FPS and adjusts particle budgets, tracking frequency,
 * pixel ratios, and visual complexity using hysteresis timers.
 */

export const QUALITY_TIERS = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  VERY_LOW: 'VERY_LOW'
};

export class QualityManager {
  constructor(renderer = null) {
    this.renderer = renderer;
    this.currentTier = QUALITY_TIERS.HIGH;

    // Detect integrated GPU or low-end hardware at startup
    this._detectInitialTier();

    // Rolling FPS tracking
    this.fpsHistory = [];
    this.historyWindowMs = 1500;
    this.lastTierChangeTime = performance.now();
    this.minTimeBetweenTierChanges = 3500; // 3.5s cooldown before upgrading to prevent flapping

    // Quality parameters based on tier
    this.params = this._getParamsForTier(this.currentTier);
    this.onTierChange = null;
  }

  _detectInitialTier() {
    // Default assumption for general laptops
    let tier = QUALITY_TIERS.HIGH;

    try {
      const gl = this.renderer ? this.renderer.getContext() : null;
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          const gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
          const gpuLower = gpuRenderer.toLowerCase();

          // Check for integrated Intel / AMD / Mobile graphics
          if (
            gpuLower.includes('intel') ||
            gpuLower.includes('uhd') ||
            gpuLower.includes('hd graphics') ||
            gpuLower.includes('iris') ||
            gpuLower.includes('mesa') ||
            gpuLower.includes('llvmpipe') ||
            gpuLower.includes('apple m1') === false && gpuLower.includes('apple') === false && (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
          ) {
            // Start directly at MEDIUM or LOW to prevent initial stutter
            tier = QUALITY_TIERS.MEDIUM;
            console.log(`[QualityManager] Integrated GPU detected (${gpuRenderer}). Initializing at MEDIUM tier.`);
          }
        }
      }
    } catch (e) {
      console.warn('[QualityManager] GPU detection skipped:', e);
    }

    this.currentTier = tier;
  }

  _getParamsForTier(tier) {
    switch (tier) {
      case QUALITY_TIERS.HIGH:
        return {
          tier: QUALITY_TIERS.HIGH,
          particleMultiplier: 1.0,
          blueParticles: 600,
          redParticles: 600,
          purpleParticles: 1200,
          trackingFps: 22,
          pixelRatio: 1.25,
          enableGlowBlur: true,
          lightningSegments: 7
        };
      case QUALITY_TIERS.MEDIUM:
        return {
          tier: QUALITY_TIERS.MEDIUM,
          particleMultiplier: 0.7,
          blueParticles: 420,
          redParticles: 420,
          purpleParticles: 840,
          trackingFps: 20,
          pixelRatio: 1.0,
          enableGlowBlur: true,
          lightningSegments: 5
        };
      case QUALITY_TIERS.LOW:
        return {
          tier: QUALITY_TIERS.LOW,
          particleMultiplier: 0.5,
          blueParticles: 280,
          redParticles: 280,
          purpleParticles: 560,
          trackingFps: 16,
          pixelRatio: 1.0,
          enableGlowBlur: false,
          lightningSegments: 4
        };
      case QUALITY_TIERS.VERY_LOW:
      default:
        return {
          tier: QUALITY_TIERS.VERY_LOW,
          particleMultiplier: 0.35,
          blueParticles: 180,
          redParticles: 180,
          purpleParticles: 360,
          trackingFps: 14,
          pixelRatio: 1.0,
          enableGlowBlur: false,
          lightningSegments: 3
        };
    }
  }

  update(currentFps) {
    const now = performance.now();
    this.fpsHistory.push({ time: now, fps: currentFps });

    // Prune history older than historyWindowMs
    const cutoff = now - this.historyWindowMs;
    while (this.fpsHistory.length > 0 && this.fpsHistory[0].time < cutoff) {
      this.fpsHistory.shift();
    }

    if (this.fpsHistory.length < 5) return this.params;

    // Calculate average rolling FPS
    let sum = 0;
    for (let i = 0; i < this.fpsHistory.length; i++) {
      sum += this.fpsHistory[i].fps;
    }
    const avgFps = sum / this.fpsHistory.length;

    // Check tier transitions
    const timeSinceChange = now - this.lastTierChangeTime;
    let targetTier = this.currentTier;

    // Downgrade fast if FPS is struggling
    if (avgFps < 25) {
      targetTier = QUALITY_TIERS.VERY_LOW;
    } else if (avgFps < 35) {
      if (this.currentTier === QUALITY_TIERS.HIGH || this.currentTier === QUALITY_TIERS.MEDIUM) {
        targetTier = QUALITY_TIERS.LOW;
      }
    } else if (avgFps < 48) {
      if (this.currentTier === QUALITY_TIERS.HIGH) {
        targetTier = QUALITY_TIERS.MEDIUM;
      }
    }
    // Upgrade conservatively if FPS is consistently high for >= 3.5s
    else if (avgFps >= 54 && timeSinceChange >= this.minTimeBetweenTierChanges) {
      if (this.currentTier === QUALITY_TIERS.VERY_LOW) {
        targetTier = QUALITY_TIERS.LOW;
      } else if (this.currentTier === QUALITY_TIERS.LOW) {
        targetTier = QUALITY_TIERS.MEDIUM;
      } else if (this.currentTier === QUALITY_TIERS.MEDIUM) {
        targetTier = QUALITY_TIERS.HIGH;
      }
    }

    if (targetTier !== this.currentTier) {
      this.currentTier = targetTier;
      this.params = this._getParamsForTier(targetTier);
      this.lastTierChangeTime = now;

      // Apply pixel ratio to renderer
      if (this.renderer) {
        this.renderer.setPixelRatio(this.params.pixelRatio);
      }

      console.log(`[QualityManager] Switched to ${this.currentTier} quality tier (Avg FPS: ${avgFps.toFixed(1)})`);

      if (this.onTierChange) {
        this.onTierChange(this.params);
      }
    }

    return this.params;
  }
}
