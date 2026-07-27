import * as BABYLON from '@babylonjs/core';

/**
 * One pooled particle system serves every burst effect in the game:
 * wood chips, gold sparkles, sword-hit sparks, death poofs, confetti.
 * Call FX.burst(position, color) — cheap enough to fire on every hit.
 */
class EffectsEngine {
  private ps: BABYLON.ParticleSystem | null = null;
  private emitterPos = new BABYLON.Vector3(0, 0, 0);

  init(scene: BABYLON.Scene): void {
    const tex = new BABYLON.DynamicTexture('fxTex', { width: 32, height: 32 }, scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    tex.update();
    tex.hasAlpha = true;

    const ps = new BABYLON.ParticleSystem('fx', 500, scene);
    ps.particleTexture = tex;
    ps.emitter = this.emitterPos;
    ps.minEmitBox = new BABYLON.Vector3(-0.2, 0, -0.2);
    ps.maxEmitBox = new BABYLON.Vector3(0.2, 0.3, 0.2);
    ps.minSize = 0.15;
    ps.maxSize = 0.4;
    ps.minLifeTime = 0.25;
    ps.maxLifeTime = 0.6;
    ps.emitRate = 0; // manual bursts only
    ps.direction1 = new BABYLON.Vector3(-1, 0.5, -1);
    ps.direction2 = new BABYLON.Vector3(1, 1.6, 1);
    ps.minEmitPower = 2;
    ps.maxEmitPower = 5;
    ps.gravity = new BABYLON.Vector3(0, -7, 0);
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
    this.ps = ps;
  }

  burst(pos: BABYLON.Vector3, color: BABYLON.Color4, count = 10): void {
    if (!this.ps) return;
    this.emitterPos.copyFrom(pos);
    this.ps.color1 = color;
    this.ps.color2 = color.scale(0.8);
    this.ps.colorDead = new BABYLON.Color4(color.r, color.g, color.b, 0);
    this.ps.manualEmitCount = count;
  }

  // Convenience palettes
  wood(pos: BABYLON.Vector3): void { this.burst(pos, new BABYLON.Color4(0.6, 0.42, 0.25, 1), 7); }
  stone(pos: BABYLON.Vector3): void { this.burst(pos, new BABYLON.Color4(0.65, 0.65, 0.7, 1), 7); }
  gold(pos: BABYLON.Vector3): void { this.burst(pos, new BABYLON.Color4(1, 0.85, 0.3, 1), 9); }
  food(pos: BABYLON.Vector3): void { this.burst(pos, new BABYLON.Color4(0.9, 0.85, 0.4, 1), 7); }
  splash(pos: BABYLON.Vector3): void { this.burst(pos, new BABYLON.Color4(0.5, 0.75, 0.95, 1), 8); }
  spark(pos: BABYLON.Vector3): void { this.burst(pos, new BABYLON.Color4(1, 0.7, 0.3, 1), 8); }
  poof(pos: BABYLON.Vector3): void { this.burst(pos, new BABYLON.Color4(0.95, 0.95, 0.95, 1), 12); }
  death(pos: BABYLON.Vector3): void { this.burst(pos, new BABYLON.Color4(0.45, 0.35, 0.55, 1), 14); }
  confetti(pos: BABYLON.Vector3): void { this.burst(pos, new BABYLON.Color4(1, 0.9, 0.5, 1), 22); }
}

export const FX = new EffectsEngine();
