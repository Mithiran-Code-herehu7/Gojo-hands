/**
 * blue.js
 * Cursed Technique Lapse: Blue (術式順転「蒼」)
 * GPU-Accelerated Inward Gravitational Singularity.
 * Offloads particle inward spiral physics to GPU vertex shaders.
 * Zero per-frame memory allocation for smooth 60 FPS on integrated GPUs.
 */

import { GPUShaderParticles } from './particles.js';
import { createGlowTexture, createRingTexture, clamp } from '../utils.js';

// Preallocated temporary math objects (Zero GC)
const _posTarget = new THREE.Vector3(0, 0, -100);
const _posCurrent = new THREE.Vector3(0, 0, -100);

export class BlueEffect {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.glowTex = createGlowTexture(128);
    this.ringTex = createRingTexture(256);

    // GPU-Accelerated Singularity Particles (effectType = 0 for Blue Inward Spiral)
    this.particles = new GPUShaderParticles(700, this.glowTex, 0);
    this.group.add(this.particles.getMesh());

    this._createCoreMeshes();

    this.active = false;
    this.time = 0;
    this.scale = 1.0;
    this.group.visible = false;
  }

  _createCoreMeshes() {
    // 1. Dark Gravitational Event Horizon / Deep Blue Core
    const coreGeo = new THREE.SphereGeometry(0.28, 20, 20);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x001144,
      transparent: true,
      opacity: 0.95
    });
    this.coreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.group.add(this.coreMesh);

    // 2. White-Hot Center Singularity Point
    const innerGeo = new THREE.SphereGeometry(0.12, 16, 16);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending
    });
    this.innerMesh = new THREE.Mesh(innerGeo, innerMat);
    this.group.add(this.innerMesh);

    // 3. Glowing Singularity Aura
    const auraGeo = new THREE.PlaneGeometry(2.4, 2.4);
    const auraMat = new THREE.MeshBasicMaterial({
      map: this.glowTex,
      color: 0x00d2ff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.auraMesh = new THREE.Mesh(auraGeo, auraMat);
    this.group.add(this.auraMesh);

    // 4. Accretion Distortion Ring
    const ringGeo = new THREE.PlaneGeometry(2.6, 2.6);
    const ringMat = new THREE.MeshBasicMaterial({
      map: this.ringTex,
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.accretionRing = new THREE.Mesh(ringGeo, ringMat);
    this.group.add(this.accretionRing);

    // 5. Electric Tendril Lines (4 lines with 5 segments each)
    this.tendrils = [];
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x88ffff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });

    for (let t = 0; t < 4; t++) {
      const pts = [];
      for (let p = 0; p < 5; p++) pts.push(new THREE.Vector3(0, 0, 0));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, lineMat);
      this.tendrils.push(line);
      this.group.add(line);
    }
  }

  setActive(active) {
    this.active = active;
    this.group.visible = active;
  }

  setParticleBudget(count) {
    this.particles.setActiveCount(count);
  }

  setTarget(worldX, worldY, worldZ, scale = 1.0) {
    _posTarget.set(worldX, worldY, worldZ);
    this.scale = clamp(scale, 0.6, 2.2);
  }

  update(dt) {
    if (!this.active) return;
    this.time += dt;

    // Physical inertia lag (Zero GC)
    const lagFactor = 12.0;
    _posCurrent.x += (_posTarget.x - _posCurrent.x) * (lagFactor * dt);
    _posCurrent.y += (_posTarget.y - _posCurrent.y) * (lagFactor * dt);
    _posCurrent.z += (_posTarget.z - _posCurrent.z) * (lagFactor * dt);
    this.group.position.copy(_posCurrent);

    // Breathing / pulsating animation
    const breath = 1.0 + Math.sin(this.time * 5.0) * 0.08;
    const currentScale = this.scale * breath;
    this.group.scale.set(currentScale, currentScale, currentScale);

    this.accretionRing.rotation.z += dt * 3.5;
    this.auraMesh.rotation.z -= dt * 1.5;

    // Update GPU Shader Particles in 1 line
    this.particles.update(this.time, _posCurrent.x, _posCurrent.y, _posCurrent.z, currentScale);

    // Update tendrils
    this._updateTendrils();
  }

  _updateTendrils() {
    for (let idx = 0; idx < this.tendrils.length; idx++) {
      const line = this.tendrils[idx];
      const posAttr = line.geometry.attributes.position;
      const angle = (idx / this.tendrils.length) * Math.PI * 2 + this.time * 2.5;

      for (let p = 0; p < 5; p++) {
        const frac = p / 4.0;
        const r = frac * 0.65;
        const a = angle + frac * 1.2;
        posAttr.setXYZ(p, Math.cos(a) * r, Math.sin(a) * r, 0);
      }
      posAttr.needsUpdate = true;
    }
  }
}
