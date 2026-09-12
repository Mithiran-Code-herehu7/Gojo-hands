/**
 * camera.js
 * Manages webcam access, video stream initialization, aspect-ratio handling,
 * responsive canvas synchronization, and permission error handling.
 */

export class CameraManager {
  constructor(videoElement, onReadyCallback, onErrorCallback) {
    this.video = videoElement;
    this.onReady = onReadyCallback;
    this.onError = onErrorCallback;
    this.stream = null;
    this.isReady = false;
    this.videoWidth = 1280;
    this.videoHeight = 720;
    this.aspectRatio = 16 / 9;

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  /**
   * Requests camera access with front-facing camera priority
   */
  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = new Error('Webcam access is not supported by your browser.');
      if (this.onError) this.onError(err);
      return false;
    }

    const constraints = {
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 640, max: 960 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 30, max: 60 }
      }
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;

      await new Promise((resolve) => {
        this.video.onloadedmetadata = () => {
          this.video.play().then(resolve);
        };
      });

      this.videoWidth = this.video.videoWidth || 1280;
      this.videoHeight = this.video.videoHeight || 720;
      this.aspectRatio = this.videoWidth / this.videoHeight;
      this.isReady = true;

      this._onResize();

      if (this.onReady) {
        this.onReady({
          width: this.videoWidth,
          height: this.videoHeight,
          aspectRatio: this.aspectRatio
        });
      }

      return true;
    } catch (err) {
      console.error('Camera initialization failed:', err);
      let userFriendlyMessage = 'Camera access was denied or unavailable.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        userFriendlyMessage = 'Camera permission was denied. Please allow camera access in your browser site settings and reload.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        userFriendlyMessage = 'No camera device found on this system.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        userFriendlyMessage = 'Camera is already in use by another application or tab.';
      }

      if (this.onError) {
        this.onError(new Error(userFriendlyMessage));
      }
      return false;
    }
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.isReady = false;
  }

  _onResize() {
    // Notify listeners when viewport changes
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const windowAspect = windowWidth / windowHeight;

    let renderWidth, renderHeight;
    if (windowAspect > this.aspectRatio) {
      renderWidth = windowWidth;
      renderHeight = windowWidth / this.aspectRatio;
    } else {
      renderHeight = windowHeight;
      renderWidth = windowHeight * this.aspectRatio;
    }

    // Trigger custom resize event if needed
    window.dispatchEvent(
      new CustomEvent('camera-resize', {
        detail: {
          windowWidth,
          windowHeight,
          renderWidth,
          renderHeight,
          aspectRatio: this.aspectRatio
        }
      })
    );
  }
}
