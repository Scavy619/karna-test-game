import * as BABYLON from '@babylonjs/core';
import { Input } from '../core/Input';

const MAP_LIMIT = 110;
const MIN_ZOOM = 22;
const MAX_ZOOM = 100;

/**
 * Top-down strategy camera: WASD/arrows pan, Q/E rotate, wheel zoom.
 * All built-in camera inputs are removed — movement is fully code-driven
 * so the mouse stays free for selecting and commanding.
 */
export class RTSCamera {
  readonly camera: BABYLON.ArcRotateCamera;

  constructor(scene: BABYLON.Scene, startTarget: BABYLON.Vector3) {
    this.camera = new BABYLON.ArcRotateCamera(
      'rtsCamera',
      -Math.PI / 2,
      0.72,          // tilt: cute angled top-down, Station-to-Station style
      55,
      startTarget.clone(),
      scene
    );
    this.camera.inputs.clear(); // no default mouse/keyboard control
    this.camera.lowerBetaLimit = this.camera.upperBetaLimit = 0.72;
    scene.activeCamera = this.camera;
  }

  update(dt: number, input: Input): void {
    const cam = this.camera;

    // Pan relative to view direction
    const forward = cam.target.subtract(cam.position);
    forward.y = 0;
    forward.normalize();
    const right = BABYLON.Vector3.Cross(BABYLON.Vector3.Up(), forward);
    const panSpeed = cam.radius * 0.85 * dt;
    cam.target.addInPlace(forward.scale(input.panZ * panSpeed));
    cam.target.addInPlace(right.scale(input.panX * panSpeed));
    cam.target.x = Math.max(-MAP_LIMIT, Math.min(MAP_LIMIT, cam.target.x));
    cam.target.z = Math.max(-MAP_LIMIT, Math.min(MAP_LIMIT, cam.target.z));

    // Rotate + zoom
    cam.alpha += input.rotateDir * dt * 1.6;
    cam.radius += input.consumeWheel() * 0.04;
    cam.radius = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.radius));
  }
}
