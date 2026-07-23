import * as BABYLON from '@babylonjs/core';

export class Scene {
  private scene: BABYLON.Scene;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.setupEnvironment();
  }

  private setupEnvironment(): void {
    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 50, height: 50 }, this.scene);
    const groundMat = new BABYLON.StandardMaterial('groundMat', this.scene);
    groundMat.diffuse = new BABYLON.Color3(0.2, 0.7, 0.2);
    groundMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    ground.material = groundMat;
    ground.receiveShadows = true;

    this.createWalls();
  }

  private createWalls(): void {
    const wallHeight = 1;
    const wallThickness = 0.5;
    const groundSize = 50;

    const walls = [
      { pos: new BABYLON.Vector3(0, wallHeight / 2, groundSize / 2), scale: new BABYLON.Vector3(groundSize, wallHeight, wallThickness) },
      { pos: new BABYLON.Vector3(0, wallHeight / 2, -groundSize / 2), scale: new BABYLON.Vector3(groundSize, wallHeight, wallThickness) },
      { pos: new BABYLON.Vector3(groundSize / 2, wallHeight / 2, 0), scale: new BABYLON.Vector3(wallThickness, wallHeight, groundSize) },
      { pos: new BABYLON.Vector3(-groundSize / 2, wallHeight / 2, 0), scale: new BABYLON.Vector3(wallThickness, wallHeight, groundSize) },
    ];

    walls.forEach(wall => {
      const box = BABYLON.MeshBuilder.CreateBox('wall', { size: 1 }, this.scene);
      box.position = wall.pos;
      box.scaling = wall.scale;

      const mat = new BABYLON.StandardMaterial('wallMat', this.scene);
      mat.diffuse = new BABYLON.Color3(0.5, 0.5, 0.5);
      box.material = mat;
    });
  }
}
