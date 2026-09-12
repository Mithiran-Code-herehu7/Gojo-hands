/**
 * utils.js
 * Utility math functions, coordinate mappers, smoothing filters,
 * and procedural texture generators for Three.js WebGL effects.
 */

// Math helpers
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(min, max, value) {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

export function distance2D(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function distance3D(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  const dz = (p1.z || 0) - (p2.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Exponential Moving Average (EMA) 3D Point Filter.
 * Provides smooth landmark interpolation without high-frequency jitter.
 */
export class Point3DSmoother {
  constructor(alpha = 0.45) {
    this.alpha = alpha;
    this.x = null;
    this.y = null;
    this.z = null;
    this.initialized = false;
  }

  update(x, y, z = 0, customAlpha = null) {
    const a = customAlpha !== null ? customAlpha : this.alpha;
    if (!this.initialized || this.x === null) {
      this.x = x;
      this.y = y;
      this.z = z;
      this.initialized = true;
      return { x: this.x, y: this.y, z: this.z };
    }

    this.x = lerp(this.x, x, a);
    this.y = lerp(this.y, y, a);
    this.z = lerp(this.z, z, a);

    return { x: this.x, y: this.y, z: this.z };
  }

  reset() {
    this.x = null;
    this.y = null;
    this.z = null;
    this.initialized = false;
  }

  get current() {
    return { x: this.x || 0, y: this.y || 0, z: this.z || 0 };
  }
}

/**
 * Maps normalized mirrored screen coordinates (x in [0,1], y in [0,1])
 * to Three.js camera world coordinates at a given target depth.
 *
 * In mirrored AR camera:
 * Screen X (0 is left, 1 is right) = 1.0 - landmark.x
 * Screen Y (0 is top, 1 is bottom) = landmark.y
 */
export function screenToThreeWorld(normX, normY, targetZ, camera, renderer) {
  // NDC: x in [-1, 1], y in [-1, 1] (y is up in WebGL)
  const ndcX = normX * 2 - 1;
  const ndcY = -(normY * 2 - 1);

  // Convert NDC to camera view space at targetZ
  // In Three.js with perspective camera looking along -Z:
  // Visible height at distance d = 2 * d * tan(fov / 2)
  const fovRad = (camera.fov * Math.PI) / 180;
  const dist = Math.abs(camera.position.z - targetZ);
  const visibleHeight = 2 * dist * Math.tan(fovRad / 2);
  const visibleWidth = visibleHeight * camera.aspect;

  const worldX = (ndcX * visibleWidth) / 2 + camera.position.x;
  const worldY = (ndcY * visibleHeight) / 2 + camera.position.y;

  return { x: worldX, y: worldY, z: targetZ };
}

/**
 * Procedural Texture Generators
 * Creates high-res canvas textures in-memory with zero external asset loading.
 */

// 1. Soft radial Gaussian glow texture
export function createGlowTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const center = size / 2;
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.85)');
  gradient.addColorStop(0.45, 'rgba(255, 255, 255, 0.4)');
  gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.1)');
  gradient.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// 2. Star / Diamond flare texture for intense sparks
export function createSparkTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const center = size / 2;

  // Soft background glow
  const bgGrad = ctx.createRadialGradient(center, center, 0, center, center, center * 0.8);
  bgGrad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  bgGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.3)');
  bgGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, size, size);

  // Sharp 4-point star rays
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(center, 0);
  ctx.lineTo(center, size);
  ctx.moveTo(0, center);
  ctx.lineTo(size, center);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// 3. Shockwave Ring Texture
export function createRingTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const center = size / 2;
  const radius = center * 0.75;
  const thickness = center * 0.2;

  const gradient = ctx.createRadialGradient(center, center, radius - thickness, center, center, radius + thickness);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// 4. Electric lightning branch texture
export function createLightningTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#00f0ff';
  ctx.shadowBlur = 10;

  ctx.beginPath();
  let x = size * 0.2;
  let y = size * 0.1;
  ctx.moveTo(x, y);

  while (y < size * 0.9) {
    x += (Math.random() - 0.5) * 30;
    y += Math.random() * 20 + 10;
    x = clamp(x, 10, size - 10);
    ctx.lineTo(x, y);
  }
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Simple fast 3D pseudo-random noise generator for turbulent energy motion
export function pseudoNoise(x, y, z) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453123;
  return n - Math.floor(n);
}
