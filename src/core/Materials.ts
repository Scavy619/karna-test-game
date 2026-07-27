import * as BABYLON from '@babylonjs/core';

/**
 * Shared pastel material factory. Materials are cached by name so hundreds
 * of meshes reuse a handful of materials (good for performance).
 * The slight emissive tint is what gives the world its soft "toy" look.
 */
const cache = new Map<string, BABYLON.StandardMaterial>();

export interface MatOpts {
  alpha?: number;
  specular?: number;
  glow?: number;          // 0..1, how much the color self-illuminates
  disableLighting?: boolean;
}

export function pastel(
  scene: BABYLON.Scene,
  name: string,
  color: BABYLON.Color3,
  opts: MatOpts = {}
): BABYLON.StandardMaterial {
  const existing = cache.get(name);
  if (existing && existing.getScene() === scene) return existing;

  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = color;
  const s = opts.specular ?? 0.03;
  m.specularColor = new BABYLON.Color3(s, s, s);
  m.emissiveColor = color.scale(opts.glow ?? 0.1);
  if (opts.alpha !== undefined) m.alpha = opts.alpha;
  if (opts.disableLighting) m.disableLighting = true;
  cache.set(name, m);
  return m;
}
