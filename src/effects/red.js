/**
 * red.js
 * Cursed Technique Reversal: Red (術式反転「赫」)
 * GPU-Accelerated Divergent Repulsive Singularity.
 * Offloads explosive outward particle blast physics to GPU vertex shaders.
 * Zero per-frame memory allocation for smooth 60 FPS on integrated GPUs.
 */

import { GPUShaderParticles } from './particles.js';
import { createGlowTexture, createRingTexture, clamp } from '../utils.js';

// Preallocated temporary math objects (Zero GC)
const _redTarget = new THREE.Vector3(0, 0, -100);
const _redCurrent = new THREE.Vector3(0, 0, -100);

export class RedEffect {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.glowTex = createGlowTexture(128);
    this.ringTex = createRingTexture(256);

    // GPU-Accelerated Repulsive Particles (effectType = 1 for Red Divergent Blast)
    this.particles = new GPUShaderParticles(700, this.glowTex, 1);
    this.group.add(this.particles.getMesh());

    this._createCoreMeshes();

    this.active = false;
    this.time = 0;
    this.scale = 1.0;
    this.shockwaveProgress = 1.0;
    this.group.visible = false;
  }

  _createCoreMeshes() {
    // 1. Blinding White-Hot Center Sphere
    const innerGeo = new THREE.SphereGeometry(0.14, 16, 16);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending
    });
    this.innerMesh = new THREE.Mesh(innerGeo, innerMat);
    this.group.add(this.innerMesh);

    // 2. Fiery Crimson Sphere Core
    const coreGeo = new THREE.SphereGeometry(0.24, 20, 20);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xff0033,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    this.coreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.group.add(this.coreMesh);

    // 3. Scarlet Glow Aura
    const glowGeo = new THREE.PlaneGeometry(2.5, 2.5);
    const glowMat = new THREE.MeshBasicMaterial({
      map: this.glowTex,
      color: 0xff1122,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.glowMesh = new THREE.Mesh(glowGeo, glowMat);
    this.group.add(this.glowMesh);

    // 4. Rotating Concentric Energy Rings
    const ringGeo = new THREE.PlaneGeometry(2.8, 2.8);
    const ringMat1 = new THREE.MeshBasicMaterial({
      map: this.ringTex,
      color: 0xff0044,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.ring1 = new THREE.Mesh(ringGeo, ringMat1);
    this.ring1.rotation.x = Math.PI / 4;
    this.group.add(this.ring1);

    // 5. Expanding Repulsive Shockwave Mesh
    const shockGeo = new THREE.PlaneGeometry(3.2, 3.2);
    const shockMat = new THREE.MeshBasicMaterial({
      map: this.ringTex,
      color: 0xff0033,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.shockwaveMesh = new THREE.Mesh(shockGeo, shockMat);
    this.group.add(this.shockwaveMesh);

    // 6. Crimson Lightning Arcs (4 lines with 5 segments each)
    this.lightningTendrils = [];
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xff7799,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });

    for (let t = 0; t < 4; t++) {
      const pts = [];
      for (let p = 0; p < 5; p++) pts.push(new THREE.Vector3(0, 0, 0));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, lineMat);
      this.lightningTendrils.push(line);
      this.group.add(line);
    }
  }

  setActive(active) {
    const wasInactive = !this.active && active;
    this.active = active;
    this.group.visible = active;
    if (wasInactive) {
      this.triggerShockwave();
    }
  }

  setParticleBudget(count) {
    this.particles.setActiveCount(count);
  }

  triggerShockwave() {
    this.shockwaveProgress = 0.0;
  }

  setTarget(worldX, worldY, worldZ, scale = 1.0) {
    _redTarget.set(worldX, worldY, worldZ);
    this.scale = clamp(scale, 0.6, 2.2);
  }

  update(dt) {
    if (!this.active) return;
    this.time += dt;

    // Fast follow index finger (Zero GC)
    _redCurrent.x += (_redTarget.x - _redCurrent.x) * (18.0 * dt);
    _redCurrent.y += (_redTarget.y - _redCurrent.y) * (18.0 * dt);
    _redCurrent.z += (_redTarget.z - _redCurrent.z) * (18.0 * dt);
    this.group.position.copy(_redCurrent);

    const pulse = 1.0 + Math.sin(this.time * 9.0) * 0.1;
    const currentScale = this.scale * pulse;
    this.group.scale.set(currentScale, currentScale, currentScale);

    this.ring1.rotation.z += dt * 4.5;
    this.ring1.rotation.x += dt * 2.0;

    // Shockwave expansion
    if (this.shockwaveProgress < 1.0) {
      this.shockwaveProgress += dt * 3.0;
      const s = this.shockwaveProgress * 3.0;
      this.shockwaveMesh.scale.set(s, s, s);
      this.shockwaveMesh.material.opacity = Math.max(0, (1.0 - this.shockwaveProgress) * 0.9);
    } else {
      this.shockwaveMesh.material.opacity = 0;
    }

    // Update GPU Shader Particles in 1 line
    this.particles.update(this.time, _redCurrent.x, _redCurrent.y, _redCurrent.z, currentScale);

    this._updateLightning();
  }

  _updateLightning() {
    for (let idx = 0; idx < this.lightningTendrils.length; idx++) {
      const line = this.lightningTendrils[idx];
      const posAttr = line.geometry.attributes.position;
      const baseAngle = (idx / this.lightningTendrils.length) * Math.PI * 2 + this.time * 6.0;

      for (let p = 0; p < 5; p++) {
        const frac = p / 4.0;
        const d = frac * 0.85;
        posAttr.setXYZ(p, Math.cos(baseAngle) * d, Math.sin(baseAngle) * d, 0);
      }
      posAttr.needsUpdate = true;
    }
  }
}
