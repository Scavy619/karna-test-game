import * as BABYLON from '@babylonjs/core';
import { Player } from './Player';

export class Enemy {
  private mesh: BABYLON.Mesh;
  private scene: BABYLON.Scene;
  private player: Player;
  private health: number = 10;
  private maxHealth: number = 10;
  private moveSpeed: number = 5;
  private detectionRange: number = 15;
  private attackRange: number = 1.5;
  private velocity: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private isAggro: boolean = false;
  private isAttacking: boolean = false;
  private lastAttackTime: number = 0;
  private attackCooldown: number = 1;
  private isDead: boolean = false;

  constructor(scene: BABYLON.Scene, position: BABYLON.Vector3, player: Player) {
    this.scene = scene;
    this.player = player;

    this.mesh = BABYLON.MeshBuilder.CreateCylinder('enemy', { height: 1, diameter: 0.6 }, scene);
    this.mesh.position = position;

    const mat = new BABYLON.StandardMaterial('enemyMat', scene);
    mat.diffuse = new BABYLON.Color3(1, 0.3, 0.3);
    this.mesh.material = mat;
  }

  update(player: Player): void {
    if (this.isDead) return;

    const distToPlayer = BABYLON.Vector3.Distance(this.mesh.position, player.getPosition());

    if (distToPlayer < this.detectionRange) {
      this.isAggro = true;
    }

    if (this.isAggro) {
      if (distToPlayer > this.attackRange) {
        this.chase(player);
      } else {
        this.velocity = BABYLON.Vector3.Zero();
        this.tryAttack(player);
      }
    } else {
      this.velocity = BABYLON.Vector3.Zero();
    }

    this.mesh.position.addInPlace(this.velocity.scale(0.016));

    // Check if hit by player
    if (player.isCurrentlyAttacking()) {
      const hitboxDist = BABYLON.Vector3.Distance(this.mesh.position, player.getAttackHitbox().position);
      if (hitboxDist < 1) {
        this.takeDamage(5);
      }
    }
  }

  private chase(player: Player): void {
    const dirToPlayer = player.getPosition().subtract(this.mesh.position).normalize();
    this.velocity = dirToPlayer.scale(this.moveSpeed);
  }

  private tryAttack(player: Player): void {
    const now = Date.now() / 1000;
    if (now - this.lastAttackTime < this.attackCooldown) return;

    this.lastAttackTime = now;
    this.isAttacking = true;
    player.takeDamage(3);

    setTimeout(() => {
      this.isAttacking = false;
    }, 300);
  }

  takeDamage(amount: number): void {
    this.health -= amount;
    console.log(`Enemy takes ${amount} damage! Health: ${this.health}/${this.maxHealth}`);

    if (this.health <= 0) {
      this.die();
    }
  }

  private die(): void {
    this.isDead = true;
    this.mesh.dispose();
    console.log('Enemy defeated!');
  }
}
