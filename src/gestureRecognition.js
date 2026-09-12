/**
 * gestureRecognition.js
 * Multi-hand gesture classifier and state machine for Satoru Gojo's Cursed Techniques.
 * Computes finger extension/flexion, pinch distances, two-hand convergence,
 * forward thrust detection, and debounced state transitions.
 */

import { distance2D, distance3D, clamp } from './utils.js';
import { HAND_LANDMARKS } from './handTracking.js';

// ===================================================================
// TUNABLE CALIBRATION CONSTANTS
// Easily customize these thresholds for your hand size & camera setup
// ===================================================================
export const GESTURE_CONFIG = {
  // Finger extension ratio threshold: (tip-wrist distance) / (pip-wrist distance)
  FINGER_EXTENDED_RATIO: 1.18,
  FINGER_FOLDED_RATIO: 0.98,

  // Thumb extension threshold: distance(thumbTip, pinkyMcp) vs distance(thumbMcp, pinkyMcp)
  THUMB_EXTENDED_RATIO: 1.15,

  // Two-hand Hollow Purple merge trigger distance (normalized screen coords [0, 1])
  PURPLE_MERGE_DISTANCE: 0.28,       // Palms closer than this distance begin collision
  PURPLE_COLLISION_DISTANCE: 0.14,   // Full collision point triggering flash & imaginary mass

  // Forward thrust detection for launching Hollow Purple
  THRUST_SCALE_RATE_THRESHOLD: 0.85, // Rate of palm expansion (dScale/dt) indicating forward thrust
  THRUST_Z_VELOCITY_THRESHOLD: -1.2, // MediaPipe Z velocity toward camera (negative is forward)
  THRUST_MIN_SPEED: 0.7,             // Screen-space velocity magnitude threshold

  // State debounce & hold timings (in milliseconds)
  DEBOUNCE_HOLD_TIME: 160,           // Time a gesture must be held before activating
  PURPLE_CHARGE_DURATION: 1600,      // Orbital charging animation duration in ms
  RELEASE_RESET_DURATION: 2400,      // Time after release before returning to NEUTRAL
  COOLDOWN_AFTER_RELEASE: 1000       // Prevent instant re-triggering
};

export const TECHNIQUE_STATES = {
  NEUTRAL: 'NEUTRAL',
  BLUE: 'BLUE',
  RED: 'RED',
  CHARGING_PURPLE: 'CHARGING_PURPLE',
  HOLLOW_PURPLE_READY: 'HOLLOW_PURPLE_READY',
  RELEASED: 'RELEASED'
};

export class GestureRecognizer {
  constructor() {
    this.currentState = TECHNIQUE_STATES.NEUTRAL;
    this.pendingState = null;
    this.pendingStateTime = 0;
    this.lastStateChangeTime = 0;

    this.purpleStartTime = 0;
    this.releaseStartTime = 0;

    // Previous frames for thrust detection
    this.prevScale = 0;
    this.prevScaleTime = 0;

    // State payload passed to effects and HUD
    this.statusInfo = {
      state: TECHNIQUE_STATES.NEUTRAL,
      confidence: 0,
      dominantHandIndex: 0,
      leftHandGesture: 'NONE',
      rightHandGesture: 'NONE',
      palmDistance: 1.0,
      purpleProgress: 0, // 0 to 1 during charging phase
      aimTarget: { x: 0.5, y: 0.5, z: 0 },
      aimDirection: { x: 0, y: -1 }
    };
  }

  /**
   * Evaluates hand tracking data and updates technique state machine
   */
  update(trackingData) {
    const now = performance.now();
    const { handsCount, hands } = trackingData;

    // Default neutral status
    if (handsCount === 0) {
      if (this.currentState !== TECHNIQUE_STATES.RELEASED) {
        this._transitionTo(TECHNIQUE_STATES.NEUTRAL, now);
      }
      this.statusInfo.state = this.currentState;
      this.statusInfo.confidence = 0;
      this.statusInfo.leftHandGesture = 'NONE';
      this.statusInfo.rightHandGesture = 'NONE';
      return this.statusInfo;
    }

    // Classify each hand individually
    const analyzedHands = hands.map((hand) => this._analyzeHand(hand));

    // Determine left vs right in mirrored screen space
    // Hand with lower palmCenter.x is on screen-left, higher is on screen-right
    let leftHand = null;
    let rightHand = null;

    if (handsCount === 1) {
      leftHand = analyzedHands[0];
    } else {
      if (analyzedHands[0].palmCenter.x < analyzedHands[1].palmCenter.x) {
        leftHand = analyzedHands[0];
        rightHand = analyzedHands[1];
      } else {
        leftHand = analyzedHands[1];
        rightHand = analyzedHands[0];
      }
    }

    this.statusInfo.leftHandGesture = leftHand ? leftHand.gesture : 'NONE';
    this.statusInfo.rightHandGesture = rightHand ? rightHand.gesture : 'NONE';

    // Two-hand calculations
    let palmDistance = 1.0;
    let midpoint = { x: 0.5, y: 0.5, z: 0 };
    if (leftHand && rightHand) {
      palmDistance = distance2D(leftHand.palmCenter, rightHand.palmCenter);
      midpoint = {
        x: (leftHand.palmCenter.x + rightHand.palmCenter.x) / 2,
        y: (leftHand.palmCenter.y + rightHand.palmCenter.y) / 2,
        z: (leftHand.palmCenter.z + rightHand.palmCenter.z) / 2
      };
    }
    this.statusInfo.palmDistance = palmDistance;

    // Handle Active States: CHARGING_PURPLE and HOLLOW_PURPLE_READY & RELEASED
    if (this.currentState === TECHNIQUE_STATES.RELEASED) {
      const elapsed = now - this.releaseStartTime;
      if (elapsed > GESTURE_CONFIG.RELEASE_RESET_DURATION) {
        this._transitionTo(TECHNIQUE_STATES.NEUTRAL, now);
      }
      this.statusInfo.state = this.currentState;
      return this.statusInfo;
    }

    if (this.currentState === TECHNIQUE_STATES.CHARGING_PURPLE) {
      const progress = clamp((now - this.purpleStartTime) / GESTURE_CONFIG.PURPLE_CHARGE_DURATION, 0, 1);
      this.statusInfo.purpleProgress = progress;

      // When charging is complete, transition to HOLLOW_PURPLE_READY
      if (progress >= 1.0) {
        this._transitionTo(TECHNIQUE_STATES.HOLLOW_PURPLE_READY, now);
      }

      this.statusInfo.state = this.currentState;
      this.statusInfo.aimTarget = midpoint;
      return this.statusInfo;
    }

    if (this.currentState === TECHNIQUE_STATES.HOLLOW_PURPLE_READY) {
      // Aiming mode: Aim follows the primary hand (or midpoint if two hands)
      const primary = rightHand || leftHand;
      this.statusInfo.aimTarget = primary ? primary.palmCenter : midpoint;
      this.statusInfo.aimDirection = primary ? primary.aimVector : { x: 0, y: -1 };

      // Check for Forward Thrust / Release gesture
      const isThrust = this._checkThrust(primary, now);
      if (isThrust) {
        this._transitionTo(TECHNIQUE_STATES.RELEASED, now);
        this.releaseStartTime = now;
      }

      this.statusInfo.state = this.currentState;
      return this.statusInfo;
    }

    // Cooldown check after release
    if (now - this.lastStateChangeTime < GESTURE_CONFIG.COOLDOWN_AFTER_RELEASE && this.currentState === TECHNIQUE_STATES.NEUTRAL) {
      this.statusInfo.state = TECHNIQUE_STATES.NEUTRAL;
      return this.statusInfo;
    }

    // Evaluate candidate state based on current hands
    let candidateState = TECHNIQUE_STATES.NEUTRAL;
    let confidence = 0.5;

    if (leftHand && rightHand) {
      // Dual hand mode: check if preparing Hollow Purple (Blue + Red coming together)
      const isBlueAndRed =
        (leftHand.gesture === 'BLUE' && rightHand.gesture === 'RED') ||
        (leftHand.gesture === 'RED' && rightHand.gesture === 'BLUE') ||
        (leftHand.gesture === 'BLUE' && rightHand.gesture === 'BLUE'); // forgiving gesture match

      if (isBlueAndRed || (leftHand.gesture !== 'NONE' && rightHand.gesture !== 'NONE')) {
        if (palmDistance < GESTURE_CONFIG.PURPLE_MERGE_DISTANCE) {
          candidateState = TECHNIQUE_STATES.CHARGING_PURPLE;
          confidence = 0.95;
        } else {
          // Both active but hands are still apart: prioritize Blue or Red individually
          candidateState = leftHand.gesture === 'BLUE' ? TECHNIQUE_STATES.BLUE : TECHNIQUE_STATES.RED;
          confidence = 0.8;
        }
      } else if (leftHand.gesture !== 'NONE') {
        candidateState = leftHand.gesture === 'BLUE' ? TECHNIQUE_STATES.BLUE : TECHNIQUE_STATES.RED;
        confidence = leftHand.confidence;
      } else if (rightHand.gesture !== 'NONE') {
        candidateState = rightHand.gesture === 'BLUE' ? TECHNIQUE_STATES.BLUE : TECHNIQUE_STATES.RED;
        confidence = rightHand.confidence;
      }
    } else if (leftHand) {
      // Single hand detected
      if (leftHand.gesture === 'BLUE') {
        candidateState = TECHNIQUE_STATES.BLUE;
        confidence = leftHand.confidence;
      } else if (leftHand.gesture === 'RED') {
        candidateState = TECHNIQUE_STATES.RED;
        confidence = leftHand.confidence;
      }
    }

    // Debounce & State Hysteresis to prevent flickering
    if (candidateState !== this.currentState) {
      if (this.pendingState !== candidateState) {
        this.pendingState = candidateState;
        this.pendingStateTime = now;
      } else if (now - this.pendingStateTime >= GESTURE_CONFIG.DEBOUNCE_HOLD_TIME) {
        if (candidateState === TECHNIQUE_STATES.CHARGING_PURPLE) {
          this.purpleStartTime = now;
        }
        this._transitionTo(candidateState, now);
      }
    } else {
      this.pendingState = null;
    }

    this.statusInfo.state = this.currentState;
    this.statusInfo.confidence = confidence;
    return this.statusInfo;
  }

  _transitionTo(newState, timestamp) {
    this.currentState = newState;
    this.lastStateChangeTime = timestamp;
    this.pendingState = null;
  }

  /**
   * Checks individual hand finger extension and classifies gesture:
   * - BLUE: Open hand (all 4-5 fingers extended)
   * - RED: Pointing index (index extended, others folded)
   */
  _analyzeHand(hand) {
    const pts = hand.landmarks;
    const wrist = pts[HAND_LANDMARKS.WRIST];

    // Compute extension for each finger
    const fingers = {
      thumb: this._isThumbExtended(pts),
      index: this._isFingerExtended(pts, HAND_LANDMARKS.INDEX_TIP, HAND_LANDMARKS.INDEX_PIP, wrist),
      middle: this._isFingerExtended(pts, HAND_LANDMARKS.MIDDLE_TIP, HAND_LANDMARKS.MIDDLE_PIP, wrist),
      ring: this._isFingerExtended(pts, HAND_LANDMARKS.RING_TIP, HAND_LANDMARKS.RING_PIP, wrist),
      pinky: this._isFingerExtended(pts, HAND_LANDMARKS.PINKY_TIP, HAND_LANDMARKS.PINKY_PIP, wrist)
    };

    const extendedCount = (fingers.index ? 1 : 0) +
                          (fingers.middle ? 1 : 0) +
                          (fingers.ring ? 1 : 0) +
                          (fingers.pinky ? 1 : 0) +
                          (fingers.thumb ? 0.5 : 0);

    let gesture = 'NONE';
    let confidence = 0.5;

    // Gesture 1: BLUE (Open Hand)
    // Index, Middle, Ring, Pinky extended
    if (fingers.index && fingers.middle && fingers.ring && fingers.pinky) {
      gesture = 'BLUE';
      confidence = 0.92;
    }
    // Gesture 2: RED (Pointing Index)
    // Index extended, Middle, Ring, Pinky folded
    else if (fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
      gesture = 'RED';
      confidence = 0.95;
    }
    // Forgiving Red: Index extended, ring & pinky folded, middle partially curled
    else if (fingers.index && !fingers.ring && !fingers.pinky) {
      gesture = 'RED';
      confidence = 0.82;
    }
    // Forgiving Blue: 3+ non-thumb fingers extended
    else if (extendedCount >= 3.0) {
      gesture = 'BLUE';
      confidence = 0.75;
    }

    return {
      ...hand,
      fingers,
      extendedCount,
      gesture,
      confidence
    };
  }

  _isFingerExtended(pts, tipIdx, pipIdx, wrist) {
    const tipDist = distance2D(pts[tipIdx], wrist);
    const pipDist = distance2D(pts[pipIdx], wrist);
    const ratio = pipDist > 0.001 ? tipDist / pipDist : 1;
    return ratio > GESTURE_CONFIG.FINGER_EXTENDED_RATIO;
  }

  _isThumbExtended(pts) {
    const thumbTip = pts[HAND_LANDMARKS.THUMB_TIP];
    const pinkyMcp = pts[HAND_LANDMARKS.PINKY_MCP];
    const thumbMcp = pts[HAND_LANDMARKS.THUMB_MCP];
    const tipDist = distance2D(thumbTip, pinkyMcp);
    const mcpDist = distance2D(thumbMcp, pinkyMcp);
    return mcpDist > 0.001 && tipDist / mcpDist > GESTURE_CONFIG.THUMB_EXTENDED_RATIO;
  }

  /**
   * Forward thrust detection:
   * Checks for a sudden forward movement toward the camera (expanding palm scale or forward z velocity)
   */
  _checkThrust(hand, now) {
    if (!hand) return false;

    const scale = hand.palmScale;
    const dt = this.prevScaleTime ? (now - this.prevScaleTime) / 1000 : 0.033;
    let dScaleDt = 0;

    if (dt > 0.005 && this.prevScale > 0) {
      dScaleDt = (scale - this.prevScale) / dt;
    }

    this.prevScale = scale;
    this.prevScaleTime = now;

    // Detect forward thrust via palm expansion rate OR negative z-velocity OR high speed
    const isScaleThrust = dScaleDt > GESTURE_CONFIG.THRUST_SCALE_RATE_THRESHOLD;
    const isZThrust = hand.velocity && hand.velocity.z < GESTURE_CONFIG.THRUST_Z_VELOCITY_THRESHOLD;
    const isSpeedThrust = hand.velocity && hand.velocity.speed > GESTURE_CONFIG.THRUST_MIN_SPEED;

    return isScaleThrust || isZThrust || isSpeedThrust;
  }
}
