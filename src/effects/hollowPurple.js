/**
 * hollowPurple.js
 * Secret Technique: Hollow Purple (虚式「茈」)
 * GPU-Accelerated Imaginary Mass Synthesis, Aiming, and Launch.
 * Offloads vortex swirl and launch trail physics to GPU vertex shaders.
 * Zero per-frame memory allocation for smooth 60 FPS on integrated GPUs.
 */

import { GPUShaderParticles } from './particles.js';
import { createGlowTexture, createRingTexture, lerp, clamp } from '../utils.js';

// Preallocated static math objects (Zero GC)
const _pLeft = new THREE.Vector3(0, 0, 0);
const _pRight = new THREE.Vector3(0, 0, 0);
const _pMid = new THREE.Vector3(0, 0, 0);
const _pAim = new THREE.Vector3(0, 0, 0);
const _pProjPos = new THREE.Vector3(0, 0, 0);
const _pProjVel = new THREE.Vector3(0, 0, 0);

export class HollowPurpleEffect {
  constructor(scene, onScreenShakeCallback = null) {
    this.scene = scene;
    this.onScreenShake = onScreenShakeCallback;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.glowTex = createGlowTexture(128);
    this.ringTex = createRingTexture(256);

    // GPU-Accelerated Vortex & Trail Particles
    this.swirlParticles = new GPUShaderParticles(1000, this.glowTex, 2); // 2 = Purple Vortex
    this.trailParticles = new GPUShaderParticles(400, this.glowTex, 3); // 3 = Purple Trail
    this.group.add(this.swirlParticles.getMesh());
    this.group.add(this.trailParticles.getMesh());

    this._createBridgeLightning();
    this._createPurpleMeshes();
    this._createCollisionOrbiters();

    this.state = 'INACTIVE';
    this.time = 0;
    this.chargeProgress = 0;
    this.launchTime = 0;
    this.flashAlpha = 0;

    this.group.visible = false;
  }

  _createBridgeLightning() {
    this.bridgeLines = [];
    const mat = new THREE.LineBasicMaterial({
      color: 0xcc44ff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });

    for (let i = 0; i < 3; i++) {
      const pts = [];
      for (let p = 0; p < 6; p++) pts.push(new THREE.Vector3(0, 0, 0));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, mat);
      this.bridgeLines.push(line);
      this.group.add(line);
    }
  }

  _createCollisionOrbiters() {
    const blueGeo = new THREE.SphereGeometry(0.18, 14, 14);
    const blueMat = new THREE.MeshBasicMaterial({
      color: 0x00d2ff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    this.orbitBlue = new THREE.Mesh(blueGeo, blueMat);
    this.group.add(this.orbitBlue);

    const redGeo = new THREE.SphereGeometry(0.18, 14, 14);
    const redMat = new THREE.MeshBasicMaterial({
      color: 0xff0044,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    this.orbitRed = new THREE.Mesh(redGeo, redMat);
    this.group.add(this.orbitRed);
  }

  _createPurpleMeshes() {
    this.purpleCoreGroup = new THREE.Group();
    this.group.add(this.purpleCoreGroup);

    // 1. White-Hot Singular Center
    const whiteCenterGeo = new THREE.SphereGeometry(0.24, 20, 20);
    const whiteMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending
    });
    this.whiteCenter = new THREE.Mesh(whiteCenterGeo, whiteMat);
    this.purpleCoreGroup.add(this.whiteCenter);

    // 2. Dense Imaginary Mass
    const violetGeo = new THREE.SphereGeometry(0.46, 22, 22);
    const violetMat = new THREE.MeshBasicMaterial({
      color: 0x4b0082,
      transparent: true,
      opacity: 0.95
    });
    this.violetSphere = new THREE.Mesh(violetGeo, violetMat);
    this.purpleCoreGroup.add(this.violetSphere);

    // 3. Volumetric Purple Glow Layer
    const glowGeo = new THREE.PlaneGeometry(3.6, 3.6);
    const glowMat = new THREE.MeshBasicMaterial({
      map: this.glowTex,
      color: 0x9900ff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.glowLayer = new THREE.Mesh(glowGeo, glowMat);
    this.purpleCoreGroup.add(this.glowLayer);

    // 4. Distortion Ring
    const ringGeo = new THREE.PlaneGeometry(4.0, 4.0);
    const ringMat = new THREE.MeshBasicMaterial({
      map: this.ringTex,
      color: 0xc840ff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.purpleRing = new THREE.Mesh(ringGeo, ringMat);
    this.purpleCoreGroup.add(this.purpleRing);

    // 5. Collision Flash Mesh
    const flashGeo = new THREE.PlaneGeometry(10.0, 10.0);
    const flashMat = new THREE.MeshBasicMaterial({
      map: this.glowTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.flashMesh = new THREE.Mesh(flashGeo, flashMat);
    this.group.add(this.flashMesh);
  }

  setParticleBudget(count) {
    this.swirlParticles.setActiveCount(count);
    this.trailParticles.setActiveCount(Math.round(count * 0.4));
  }

  setHandPositions(leftPos, rightPos, palmDist) {
    _pLeft.copy(leftPos);
    _pRight.copy(rightPos);
    _pMid.set(
      (leftPos.x + rightPos.x) * 0.5,
      (leftPos.y + rightPos.y) * 0.5,
      (leftPos.z + rightPos.z) * 0.5
    );
  }

  startCharging() {
    this.state = 'CHARGING';
    this.group.visible = true;
    this.purpleCoreGroup.visible = false;
    this.orbitBlue.visible = true;
    this.orbitRed.visible = true;
    this.time = 0;
  }

  setReady() {
    this.state = 'READY';
    this.group.visible = true;
    this.purpleCoreGroup.visible = true;
    this.orbitBlue.visible = false;
    this.orbitRed.visible = false;
    this.flashAlpha = 1.0;
  }

  launch(startPos, aimDir) {
    this.state = 'LAUNCHING';
    this.group.visible = true;
    this.purpleCoreGroup.visible = true;
    this.orbitBlue.visible = false;
    this.orbitRed.visible = false;

    _pProjPos.copy(startPos);
    _pProjVel.set(aimDir.x * 12.0, aimDir.y * 12.0, -48.0);
    this.launchTime = 0;
    this.flashAlpha = 0.9;

    if (this.onScreenShake) {
      this.onScreenShake(1.0);
    }
  }

  reset() {
    this.state = 'INACTIVE';
    this.group.visible = false;
    this.purpleCoreGroup.visible = false;
    this.orbitBlue.visible = false;
    this.orbitRed.visible = false;
    this.flashAlpha = 0;
  }

  update(dt, progress = 0, currentAimTarget = null) {
    if (this.state === 'INACTIVE') return;
    this.time += dt;

    // Flash decay
    if (this.flashAlpha > 0.001) {
      this.flashAlpha -= dt * 3.0;
      this.flashMesh.position.copy(this.purpleCoreGroup.position);
      this.flashMesh.scale.setScalar(1.0 + (1.0 - this.flashAlpha) * 4.0);
      this.flashMesh.material.opacity = Math.max(0, this.flashAlpha);
    } else {
      this.flashMesh.material.opacity = 0;
    }

    if (this.state === 'CHARGING') {
      this.chargeProgress = progress;
      this._updateBridgeLightning();

      const radius = (1.0 - progress) * 0.8 + 0.05;
      const angle = this.time * (6.0 + progress * 24.0);

      this.orbitBlue.position.set(
        _pMid.x + Math.cos(angle) * radius,
        _pMid.y + Math.sin(angle) * radius,
        _pMid.z
      );

      this.orbitRed.position.set(
        _pMid.x + Math.cos(angle + Math.PI) * radius,
        _pMid.y + Math.sin(angle + Math.PI) * radius,
        _pMid.z
      );
      return;
    }

    this._hideBridgeLightning();

    if (this.state === 'READY') {
      if (currentAimTarget) {
        _pAim.lerp(currentAimTarget, clamp(dt * 14.0, 0.05, 1.0));
      } else {
        _pAim.copy(_pMid);
      }

      this.purpleCoreGroup.position.copy(_pAim);
      this._animatePurpleCore(dt, 1.0);

      // Update GPU particles
      this.swirlParticles.update(this.time, _pAim.x, _pAim.y, _pAim.z, 1.0);
      return;
    }

    if (this.state === 'LAUNCHING') {
      this.launchTime += dt;
      _pProjPos.x += _pProjVel.x * dt;
      _pProjPos.y += _pProjVel.y * dt;
      _pProjPos.z += _pProjVel.z * dt;

      this.purpleCoreGroup.position.copy(_pProjPos);
      const travelScale = 1.0 + this.launchTime * 2.5;
      this._animatePurpleCore(dt, travelScale);

      // Update GPU particles (swirl + trailing exhaust)
      this.swirlParticles.update(this.time, _pProjPos.x, _pProjPos.y, _pProjPos.z, travelScale);
      this.trailParticles.update(this.time, _pProjPos.x, _pProjPos.y, _pProjPos.z, travelScale);

      if (this.launchTime < 0.6 && this.onScreenShake) {
        this.onScreenShake(0.5 * (1.0 - this.launchTime / 0.6));
      }
    }
  }

  _animatePurpleCore(dt, scaleMultiplier = 1.0) {
    const pulse = 1.0 + Math.sin(this.time * 12.0) * 0.12;
    const finalScale = scaleMultiplier * pulse;
    this.purpleCoreGroup.scale.set(finalScale, finalScale, finalScale);
    this.purpleRing.rotation.z += dt * 5.0;
    this.glowLayer.rotation.z -= dt * 1.5;
  }

  _updateBridgeLightning() {
    for (let idx = 0; idx < this.bridgeLines.length; idx++) {
      const line = this.bridgeLines[idx];
      line.visible = true;
      const posAttr = line.geometry.attributes.position;
      const count = 6;

      for (let p = 0; p < count; p++) {
        const frac = p / 5.0;
        const bx = lerp(_pLeft.x, _pRight.x, frac);
        const by = lerp(_pLeft.y, _pRight.y, frac);
        const bz = lerp(_pLeft.z, _pRight.z, frac);
        const j = Math.sin(frac * Math.PI) * 0.2;
        posAttr.setXYZ(p, bx + (Math.random() - 0.5) * j, by + (Math.random() - 0.5) * j, bz);
      }
      posAttr.needsUpdate = true;
    }
  }

  _hideBridgeLightning() {
    for (let i = 0; i < this.bridgeLines.length; i++) {
      this.bridgeLines[i].visible = false;
    }
  }
}
