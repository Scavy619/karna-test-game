import * as BABYLON from '@babylonjs/core';
import { Player } from './entities/Player';
import { Enemy } from './entities/Enemy';
import { Scene } from './Scene';

export class Game {
  private engine: BABYLON.Engine;
  private scene: BABYLON.Scene;
  private gameScene: Scene;
  private player: Player;
  private enemies: Enemy[] = [];

  constructor() {
    const canvas = document.getElementById('gameContainer') as HTMLCanvasElement;
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);

    this.gameScene = new Scene(this.scene);
    this.setupCamera();
    this.setupLighting();
  }

  start(): void {
    this.createGame();
    this.setupInput();
    this.gameLoop();
    window.addEventListener('resize', () => this.engine.resize());
  }

  private setupCamera(): void {
    const camera = new BABYLON.UniversalCamera('camera', new BABYLON.Vector3(0, 10, -15));
    camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);
    camera.inertia = 0.7;
    camera.angularSensibility = 1000;
    camera.speed = 0;
  }

  private setupLighting(): void {
    const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(1, 1, 0.5), this.scene);
    light.intensity = 0.9;

    const shadows = new BABYLON.ShadowGenerator(2048, light);
    shadows.useBlurExponentialShadowMap = true;
  }

  private createGame(): void {
    this.player = new Player(this.scene, new BABYLON.Vector3(0, 0.5, 0));

    // Spawn enemies
    this.enemies.push(new Enemy(this.scene, new BABYLON.Vector3(3, 0.5, 3), this.player));
    this.enemies.push(new Enemy(this.scene, new BABYLON.Vector3(-3, 0.5, 3), this.player));
    this.enemies.push(new Enemy(this.scene, new BABYLON.Vector3(0, 0.5, 5), this.player));
  }

  private setupInput(): void {
    const inputMap: { [key: string]: boolean } = {};

    window.addEventListener('keydown', (e) => {
      inputMap[e.key.toLowerCase()] = true;

      if (e.key === ' ') this.player.attack();
      if (e.key === 'e' || e.key === 'E') this.player.dodge();
    });

    window.addEventListener('keyup', (e) => {
      inputMap[e.key.toLowerCase()] = false;
    });

    this.scene.onBeforeRenderObservable.add(() => {
      const moveDir = new BABYLON.Vector3(0, 0, 0);
      if (inputMap['w']) moveDir.z += 1;
      if (inputMap['s']) moveDir.z -= 1;
      if (inputMap['a']) moveDir.x -= 1;
      if (inputMap['d']) moveDir.x += 1;

      if (moveDir.length() > 0) {
        moveDir.normalize();
        this.player.move(moveDir);
      } else {
        this.player.move(new BABYLON.Vector3(0, 0, 0));
      }
    });
  }

  private gameLoop(): void {
    this.engine.runRenderLoop(() => {
      this.scene.render();

      this.player.update();
      this.enemies.forEach(enemy => enemy.update(this.player));
    });
  }
}
