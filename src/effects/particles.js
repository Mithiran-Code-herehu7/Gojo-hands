/**
 * particles.js
 * GPU-Accelerated Shader Particle Engine for Gojo Cursed Techniques.
 * Offloads 100% of particle trajectories, orbits, spirals, and blasts to GLSL vertex shaders.
 * Eliminates CPU array iterations and buffer re-uploads for rock-solid 60 FPS on integrated GPUs.
 */

const vertexShader = `
  attribute vec3 aSeed;
  attribute float aBirthTime;
  attribute float aLife;
  attribute float aSize;
  attribute vec3 aColor;

  uniform float uTime;
  uniform vec3 uCenter;
  uniform float uScale;
  uniform int uEffectType;
  uniform float uActiveCount;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // Hide particles beyond active tier budget
    if (float(gl_VertexID) >= uActiveCount) {
      gl_Position = vec4(0.0, 0.0, -9999.0, 1.0);
      return;
    }

    float t = uTime + aBirthTime;
    float progress = fract(t / aLife); // 0.0 to 1.0 looping lifecycle

    vec3 localPos = vec3(0.0);

    if (uEffectType == 0) {
      // 0 = BLUE: Inward Gravitational Singularity Accretion Spiral
      float r = (1.0 - progress) * aSeed.x; // radius collapses into singularity
      float theta = aSeed.y + progress * 8.5; // inward spiral
      localPos.x = r * cos(theta);
      localPos.y = r * sin(theta);
      localPos.z = aSeed.z * (1.0 - progress * 0.7);
    } 
    else if (uEffectType == 1) {
      // 1 = RED: Divergent Repulsive Shockwave Blast
      float blast = pow(progress, 0.38) * aSeed.x * 2.2;
      localPos = normalize(aSeed) * blast;
    } 
    else if (uEffectType == 2) {
      // 2 = PURPLE: Dual Gravitational Swirling Imaginary Mass
      float r = (0.4 + 0.6 * sin(progress * 3.14159)) * aSeed.x;
      float theta = aSeed.y + progress * 9.5;
      localPos.x = r * cos(theta);
      localPos.y = r * sin(theta);
      localPos.z = aSeed.z * cos(progress * 6.28);
    } 
    else if (uEffectType == 3) {
      // 3 = PURPLE TRAIL: High-speed projectile exhaust
      localPos = aSeed * (progress * 1.8);
      localPos.z += progress * 6.0;
    }

    vec3 worldPos = uCenter + localPos * uScale;
    vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Smooth sinusoidal lifecycle fade
    float lifecycle = sin(progress * 3.14159);
    // Depth attenuation
    float depthScale = clamp(320.0 / -mvPosition.z, 0.3, 3.5);
    gl_PointSize = aSize * lifecycle * depthScale * uScale;

    vColor = aColor;
    vAlpha = lifecycle;
  }
`;

const fragmentShader = `
  uniform sampler2D uTexture;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 tex = texture2D(uTexture, gl_PointCoord);
    if (tex.a < 0.02) discard;
    gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
  }
`;

export class GPUShaderParticles {
  constructor(maxParticles = 800, texture = null, effectType = 0) {
    this.maxParticles = maxParticles;
    this.texture = texture;
    this.effectType = effectType; // 0=Blue, 1=Red, 2=Purple, 3=PurpleTrail
    this.activeCount = maxParticles;

    // Preallocate Buffer Attributes once
    const seeds = new Float32Array(maxParticles * 3);
    const birthTimes = new Float32Array(maxParticles);
    const lives = new Float32Array(maxParticles);
    const sizes = new Float32Array(maxParticles);
    const colors = new Float32Array(maxParticles * 3);

    for (let i = 0; i < maxParticles; i++) {
      const i3 = i * 3;

      // Spherical random distribution
      const radius = 0.5 + Math.random() * 1.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI * 0.7;

      seeds[i3] = radius;
      seeds[i3 + 1] = theta;
      seeds[i3 + 2] = Math.sin(phi) * 0.5;

      birthTimes[i] = Math.random() * 2.0;
      lives[i] = 0.5 + Math.random() * 0.6; // 0.5s to 1.1s lifecycle
      sizes[i] = 24.0 + Math.random() * 20.0;

      // Initial color defaults
      if (effectType === 0) {
        // Electric Blue / White
        const isW = Math.random() > 0.7;
        colors[i3] = isW ? 0.9 : 0.0;
        colors[i3 + 1] = isW ? 0.95 : 0.85;
        colors[i3 + 2] = 1.0;
      } else if (effectType === 1) {
        // Crimson Red / Orange / White
        const rnd = Math.random();
        colors[i3] = 1.0;
        colors[i3 + 1] = rnd > 0.75 ? 0.85 : (rnd > 0.4 ? 0.3 : 0.0);
        colors[i3 + 2] = rnd > 0.75 ? 0.8 : 0.1;
      } else {
        // Purple / Magenta / White
        const isW = Math.random() > 0.7;
        colors[i3] = isW ? 1.0 : 0.85;
        colors[i3 + 1] = isW ? 0.95 : 0.08;
        colors[i3 + 2] = 1.0;
      }
    }

    this.geometry = new THREE.BufferGeometry();
    // Static dummy positions (actual positions computed in vertex shader)
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxParticles * 3), 3));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    this.geometry.setAttribute('aBirthTime', new THREE.BufferAttribute(birthTimes, 1));
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0.0 },
        uCenter: { value: new THREE.Vector3(0, 0, 0) },
        uScale: { value: 1.0 },
        uEffectType: { value: this.effectType },
        uActiveCount: { value: this.activeCount },
        uTexture: { value: this.texture }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  getMesh() {
    return this.points;
  }

  setActiveCount(count) {
    this.activeCount = Math.min(this.maxParticles, Math.max(0, count));
    this.material.uniforms.uActiveCount.value = this.activeCount;
  }

  update(time, centerX, centerY, centerZ, scale = 1.0) {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uCenter.value.set(centerX, centerY, centerZ);
    this.material.uniforms.uScale.value = scale;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
