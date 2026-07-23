import * as BABYLON from '@babylonjs/core';

export class Player {
  private mesh: BABYLON.Mesh;
  private scene: BABYLON.Scene;
  private health: number = 30;
  private maxHealth: number = 30;
  private moveSpeed: number = 10;
  private velocity: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private currentDirection: BABYLON.Vector3 = new BABYLON.Vector3(0, 0, -1);
  private isAttacking: boolean = false;
  private isDodging: boolean = false;
  private lastAttackTime: number = 0;
  private lastDodgeTime: number = 0;
  private attackCooldown: number = 0.6;
  private dodgeCooldown: number = 1;
  private attackHitbox: BABYLON.Mesh;

  constructor(scene: BABYLON.Scene, position: BABYLON.Vector3) {
    this.scene = scene;
    this.mesh = BABYLON.MeshBuilder.CreateCylinder('player', { height: 1, diameter: 0.6 }, scene);
    this.mesh.position = position;

    const mat = new BABYLON.StandardMaterial('playerMat', scene);
    mat.diffuse = new BABYLON.Color3(0.2, 0.8, 1);
    this.mesh.material = mat;

    this.createHitbox();
  }

  private createHitbox(): void {
    this.attackHitbox = BABYLON.MeshBuilder.CreateSphere('attackHitbox', { diameter: 1.5 }, this.scene);
    this.attackHitbox.parent = this.mesh;
    this.attackHitbox.position = new BABYLON.Vector3(0.75, 0, 0);
    this.attackHitbox.isVisible = false;
  }

  move(direction: BABYLON.Vector3): void {
    if (direction.length() > 0) {
      this.currentDirection = direction.normalize();
      this.velocity = this.currentDirection.scale(this.moveSpeed);
    } else {
      this.velocity = BABYLON.Vector3.Zero();
    }
  }

  attack(): void {
    const now = Date.now() / 1000;
    if (now - this.lastAttackTime < this.attackCooldown) return;

    this.lastAttackTime = now;
    this.isAttacking = true;

    setTimeout(() => {
      this.isAttacking = false;
    }, 300);

    console.log('Player attacks!');
  }

  dodge(): void {
    const now = Date.now() / 1000;
    if (now - this.lastDodgeTime < this.dodgeCooldown) return;

    this.lastDodgeTime = now;
    this.isDodging = true;

    const dodgeDistance = 3;
    const dodgeVelocity = this.currentDirection.scale(dodgeDistance);
    this.velocity = dodgeVelocity;

    setTimeout(() => {
      this.isDodging = false;
      this.velocity = BABYLON.Vector3.Zero();
    }, 400);

    console.log('Player dodges!');
  }

  takeDamage(amount: number): void {
    this.health -= amount;
    console.log(`Player takes ${amount} damage! Health: ${this.health}/${this.maxHealth}`);
  }

  update(): void {
    this.mesh.position.addInPlace(this.velocity.scale(0.016));
  }

  getPosition(): BABYLON.Vector3 {
    return this.mesh.position.clone();
  }

  getAttackHitbox(): BABYLON.Mesh {
    return this.attackHitbox;
  }

  isCurrentlyAttacking(): boolean {
    return this.isAttacking;
  }

  getHealth(): number {
    return this.health;
  }
}
