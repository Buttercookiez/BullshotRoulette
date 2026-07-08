// Procedural 3D models for the Revolver Roulette renderer.
//
// Everything here is built from Three.js primitive geometry — no external
// model files. The aim is a stylized, dark "PS1/PS2 horror" look: low-poly
// figures and props that read as scary because of lighting, fog and shadow
// rather than mesh detail. These builders are PURE construction helpers: they
// take Three and return Groups/Meshes. They own no game rules and read no
// GameState. The renderer positions, lights and animates whatever they return.

import * as THREE from "three";
import type { ItemType } from "../engine/types";

// ---------------------------------------------------------------------------
// Palette (dark horror — ember, bone, blood, rust)
// ---------------------------------------------------------------------------

export const PAL = {
  void: 0x07060a,
  fog: 0x0a0809,
  floor: 0x141014,
  wall: 0x0f0c10,
  tableWood: 0x2a1d14,
  tableWoodDark: 0x160f0a,
  feltGreen: 0x16241c,
  coat: 0x14110f,
  coatTrim: 0x2a211a,
  flesh: 0xc7c0ad,
  fleshDark: 0x8a8472,
  ember: 0xff5a1a,
  emberDim: 0x8a2f0e,
  bone: 0xd8c9a4,
  blood: 0x8b0000,
  bloodDim: 0x40100c,
  steel: 0x4a4a52,
  steelDark: 0x202026,
  steelHi: 0x6a6a74,
  brass: 0xc09a3e,
  white: 0xe8e2d2,
} as const;

// ---------------------------------------------------------------------------
// Material helpers
// ---------------------------------------------------------------------------

function matte(color: number, rough = 0.95, metal = 0.0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function metalMat(color: number, rough = 0.4): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.9 });
}

function glow(color: number, intensity = 1.5): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.4,
    metalness: 0.0,
  });
}

/** Enable casting/receiving shadows recursively on a built object. */
export function castReceive(obj: THREE.Object3D, cast = true, receive = true): void {
  obj.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = cast;
      m.receiveShadow = receive;
    }
  });
}

// ---------------------------------------------------------------------------
// Procedural grunge textures (old, stained, scratched) — canvas-based
// ---------------------------------------------------------------------------

function hex(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}

/**
 * Paint an aged surface texture: a base colour, fine grime noise, dark
 * scratches, and (optionally) dried blood blotches. Returns null when no DOM
 * is available (tests), so callers fall back to a flat colour.
 */
function makeGrungeTexture(
  base: number,
  opts: { blood?: boolean; scratches?: number; grime?: number; cinderblock?: boolean; tallyMarks?: boolean } = {},
): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  try {
    const N = 512;
    const c = document.createElement("canvas");
    c.width = N;
    c.height = N;
    const ctx = c.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = hex(base);
    ctx.fillRect(0, 0, N, N);

    // Fine grime: thousands of faint dark/light specks.
    const grime = opts.grime ?? 5000;
    for (let i = 0; i < grime; i++) {
      const x = Math.random() * N;
      const y = Math.random() * N;
      const dark = Math.random() < 0.6;
      ctx.fillStyle = dark ? "rgba(0,0,0,0.12)" : "rgba(180,170,150,0.06)";
      ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }

    // Worn patches.
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * N;
      const y = Math.random() * N;
      const r = 20 + Math.random() * 70;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(0,0,0,0.16)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Scratches: thin pale gouges.
    const scratches = opts.scratches ?? 40;
    for (let i = 0; i < scratches; i++) {
      const x = Math.random() * N;
      const y = Math.random() * N;
      const a = Math.random() * Math.PI * 2;
      const len = 10 + Math.random() * 120;
      ctx.strokeStyle = `rgba(200,190,170,${0.05 + Math.random() * 0.12})`;
      ctx.lineWidth = Math.random() < 0.3 ? 1.5 : 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }

    // Dried blood blotches + spatter.
    if (opts.blood) {
      for (let i = 0; i < 7; i++) {
        const x = Math.random() * N;
        const y = Math.random() * N;
        const r = 14 + Math.random() * 46;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(70,8,6,0.85)");
        g.addColorStop(0.6, "rgba(45,6,5,0.6)");
        g.addColorStop(1, "rgba(30,4,4,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        // spatter droplets around it
        for (let j = 0; j < 18; j++) {
          const da = Math.random() * Math.PI * 2;
          const dd = r + Math.random() * r * 1.4;
          const dr = 1 + Math.random() * 3;
          ctx.fillStyle = "rgba(55,7,5,0.7)";
          ctx.beginPath();
          ctx.arc(x + Math.cos(da) * dd, y + Math.sin(da) * dd, dr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Cinderblock mortar lines
    if (opts.cinderblock) {
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 4;
      // Draw horizontal lines
      for (let y = 0; y < N; y += 64) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(N, y);
        ctx.stroke();
      }
      // Draw vertical offset lines
      for (let y = 0; y < N; y += 64) {
        const offset = (y / 64) % 2 === 0 ? 0 : 64;
        for (let x = offset; x < N; x += 128) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + 64);
          ctx.stroke();
        }
      }
    }

    // Tally marks (5 groups)
    if (opts.tallyMarks) {
      ctx.strokeStyle = "rgba(10,10,10,0.8)";
      ctx.lineWidth = 2;
      for (let g = 0; g < 6; g++) {
        const gx = 50 + Math.random() * (N - 100);
        const gy = 50 + Math.random() * (N - 100);
        // Draw 4 vertical lines
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(gx + i * 8 + (Math.random() - 0.5) * 3, gy + (Math.random() - 0.5) * 5);
          ctx.lineTo(gx + i * 8 + (Math.random() - 0.5) * 3, gy + 30 + (Math.random() - 0.5) * 5);
          ctx.stroke();
        }
        // Draw the 5th strike-through line
        ctx.beginPath();
        ctx.moveTo(gx - 5, gy + 5 + Math.random() * 5);
        ctx.lineTo(gx + 35, gy + 25 + Math.random() * 5);
        ctx.stroke();
      }
    }

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Procedural normal / roughness maps — canvas height-field converted to
// normals via a Sobel filter. Cached per-variant so memory stays flat.
// ---------------------------------------------------------------------------

type SurfaceKind = "plaster" | "wood" | "metal" | "fabric" | "leather" | "checker";

const texCache = new Map<string, THREE.Texture | null>();

function cachedTex(key: string, make: () => THREE.Texture | null): THREE.Texture | null {
  if (!texCache.has(key)) texCache.set(key, make());
  return texCache.get(key) ?? null;
}

/** Paint a grayscale height-field for a surface kind. */
function paintHeightField(ctx: CanvasRenderingContext2D, N: number, kind: SurfaceKind): void {
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, N, N);

  if (kind === "wood") {
    // Long horizontal grain streaks with occasional knots.
    for (let i = 0; i < 240; i++) {
      const y = Math.random() * N;
      const w = 40 + Math.random() * (N - 40);
      const x = Math.random() * (N - w);
      const l = 108 + Math.floor(Math.random() * 40);
      ctx.strokeStyle = `rgb(${l},${l},${l})`;
      ctx.lineWidth = 0.5 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + w * 0.3, y + (Math.random() - 0.5) * 8, x + w * 0.7, y + (Math.random() - 0.5) * 8, x + w, y);
      ctx.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * N;
      const y = Math.random() * N;
      for (let r = 2; r < 16; r += 2.5) {
        const l = 96 + Math.floor(Math.random() * 48);
        ctx.strokeStyle = `rgb(${l},${l},${l})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.7, r, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  } else if (kind === "metal") {
    // Brushed streaks + pits.
    for (let i = 0; i < 500; i++) {
      const y = Math.random() * N;
      const l = 118 + Math.floor(Math.random() * 22);
      ctx.strokeStyle = `rgba(${l},${l},${l},0.5)`;
      ctx.lineWidth = 0.5 + Math.random();
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(N, y + (Math.random() - 0.5) * 4);
      ctx.stroke();
    }
    for (let i = 0; i < 260; i++) {
      const l = 70 + Math.floor(Math.random() * 40);
      ctx.fillStyle = `rgb(${l},${l},${l})`;
      ctx.beginPath();
      ctx.arc(Math.random() * N, Math.random() * N, 0.6 + Math.random() * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "checker") {
    // Diamond checkering: 45-degree crossed grooves, like a revolver grip.
    ctx.fillStyle = "#9a9a9a";
    ctx.fillRect(0, 0, N, N);
    ctx.strokeStyle = "rgb(60,60,60)";
    ctx.lineWidth = 3;
    const step = 16;
    for (let d = -N; d < N * 2; d += step) {
      ctx.beginPath();
      ctx.moveTo(d, 0);
      ctx.lineTo(d + N, N);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(d + N, 0);
      ctx.lineTo(d, N);
      ctx.stroke();
    }
  } else if (kind === "fabric" || kind === "leather") {
    const step = kind === "fabric" ? 3 : 7;
    for (let y = 0; y < N; y += step) {
      for (let x = 0; x < N; x += step) {
        const l = 116 + Math.floor(Math.random() * 26);
        ctx.fillStyle = `rgb(${l},${l},${l})`;
        ctx.fillRect(x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2, step - 1, step - 1);
      }
    }
    if (kind === "leather") {
      // Creases.
      for (let i = 0; i < 60; i++) {
        ctx.strokeStyle = "rgba(80,80,80,0.6)";
        ctx.lineWidth = 1;
        const x = Math.random() * N;
        const y = Math.random() * N;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 60);
        ctx.stroke();
      }
    }
  } else {
    // Plaster: blotchy low-frequency lumps + fine noise.
    for (let i = 0; i < 140; i++) {
      const x = Math.random() * N;
      const y = Math.random() * N;
      const r = 8 + Math.random() * 46;
      const l = 108 + Math.floor(Math.random() * 40);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${l},${l},${l},0.55)`);
      g.addColorStop(1, "rgba(128,128,128,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 4000; i++) {
      const l = 100 + Math.floor(Math.random() * 56);
      ctx.fillStyle = `rgba(${l},${l},${l},0.35)`;
      ctx.fillRect(Math.random() * N, Math.random() * N, 1.5, 1.5);
    }
  }
}

/**
 * Generate a tiling normal map for a surface kind (Sobel over a canvas
 * height-field). Returns null without a DOM.
 */
function makeNormalMap(kind: SurfaceKind, strength = 1): THREE.Texture | null {
  return cachedTex(`nrm:${kind}:${strength}`, () => {
    if (typeof document === "undefined") return null;
    try {
      const N = 256;
      const src = document.createElement("canvas");
      src.width = N;
      src.height = N;
      const sctx = src.getContext("2d");
      if (!sctx) return null;
      paintHeightField(sctx, N, kind);
      const data = sctx.getImageData(0, 0, N, N).data;
      const h = (x: number, y: number): number => {
        const xi = ((x % N) + N) % N;
        const yi = ((y % N) + N) % N;
        return (data[(yi * N + xi) * 4] ?? 128) / 255;
      };

      const out = document.createElement("canvas");
      out.width = N;
      out.height = N;
      const octx = out.getContext("2d");
      if (!octx) return null;
      const img = octx.createImageData(N, N);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
          const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
          const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
          const i = (y * N + x) * 4;
          img.data[i] = Math.round(((-dx * inv) * 0.5 + 0.5) * 255);
          img.data[i + 1] = Math.round(((-dy * inv) * 0.5 + 0.5) * 255);
          img.data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
          img.data[i + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(out);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      return tex;
    } catch {
      return null;
    }
  });
}

/** A matching tiling roughness-variation map (subtle worn/polished patches). */
function makeRoughnessMap(kind: SurfaceKind): THREE.Texture | null {
  return cachedTex(`rgh:${kind}`, () => {
    if (typeof document === "undefined") return null;
    try {
      const N = 256;
      const c = document.createElement("canvas");
      c.width = N;
      c.height = N;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#b4b4b4";
      ctx.fillRect(0, 0, N, N);
      for (let i = 0; i < 60; i++) {
        const x = Math.random() * N;
        const y = Math.random() * N;
        const r = 12 + Math.random() * 50;
        const dark = Math.random() < 0.5;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, dark ? "rgba(70,70,70,0.5)" : "rgba(230,230,230,0.4)");
        g.addColorStop(1, "rgba(180,180,180,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      return tex;
    } catch {
      return null;
    }
  });
}

/**
 * Dress a MeshStandardMaterial with cached normal + roughness maps.
 * Mutates and returns the material for chaining.
 */
function dress(
  mat: THREE.MeshStandardMaterial,
  kind: SurfaceKind,
  opts: { repeat?: number; normalScale?: number } = {},
): THREE.MeshStandardMaterial {
  const nrm = makeNormalMap(kind);
  const rgh = makeRoughnessMap(kind);
  const rep = opts.repeat ?? 1;
  if (nrm) {
    mat.normalMap = nrm;
    mat.normalScale = new THREE.Vector2(opts.normalScale ?? 0.6, opts.normalScale ?? 0.6);
    if (rep !== 1) {
      mat.normalMap = nrm.clone();
      mat.normalMap.needsUpdate = true;
      mat.normalMap.repeat.set(rep, rep);
    }
  }
  if (rgh) {
    mat.roughnessMap = rgh;
    if (rep !== 1) {
      mat.roughnessMap = rgh.clone();
      mat.roughnessMap.needsUpdate = true;
      mat.roughnessMap.repeat.set(rep, rep);
    }
  }
  return mat;
}

// ---------------------------------------------------------------------------
// Geometry sugar
// ---------------------------------------------------------------------------

/** LatheGeometry from [radius, y] pairs (bottom → top). */
function lathe(
  profile: ReadonlyArray<readonly [number, number]>,
  mat: THREE.Material,
  segments = 24,
): THREE.Mesh {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
  return new THREE.Mesh(new THREE.LatheGeometry(pts, segments), mat);
}

/**
 * Remap a geometry's UVs to a 0..1 planar projection over its X-Z bounding
 * box — fixes the raw shape-unit UVs ExtrudeGeometry generates, which
 * otherwise tile textures once per world unit.
 */
function normalizePlanarUVs(geo: THREE.BufferGeometry): void {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb) return;
  const sx = bb.max.x - bb.min.x || 1;
  const sz = bb.max.z - bb.min.z || 1;
  const pos = geo.getAttribute("position");
  const uv = geo.getAttribute("uv");
  if (!pos || !uv) return;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) - bb.min.x) / sx, (pos.getZ(i) - bb.min.z) / sz);
  }
  uv.needsUpdate = true;
}

/** Rounded-rectangle Shape helper (centred at origin). */
function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** An irregular splashed-liquid outline (deterministic per seed). */
function puddleShape(radius: number, seed: number): THREE.Shape {
  const s = new THREE.Shape();
  const lobes = 8;
  const rnd = (i: number): number => {
    const v = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const r = radius * (0.72 + rnd(i % lobes) * 0.45);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else {
      const am = a - Math.PI / lobes;
      const rm = radius * (0.85 + rnd(i % lobes + 20) * 0.35);
      s.quadraticCurveTo(Math.cos(am) * rm, Math.sin(am) * rm, x, y);
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Room: an industrial back-room — stained concrete, corrugated panels, exposed
// pipes, a barred vent leaking cold light, wet floor patches. The fog still
// swallows the edges; the room should read as oppressive, not decorated.
// ---------------------------------------------------------------------------

export function buildRoom(): THREE.Group {
  const g = new THREE.Group();

  // Wet concrete floor: dark, stained, with a faint sheen so the bulb reads.
  const floorMat = dress(matte(PAL.floor, 0.6, 0.08), "plaster", { repeat: 4, normalScale: 0.8 });
  const floorTex = makeGrungeTexture(PAL.floor, { blood: true, scratches: 60, grime: 9000 });
  if (floorTex) {
    floorTex.repeat.set(4, 4);
    floorMat.map = floorTex;
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);

  // Standing water: near-mirror irregular puddles that catch the swinging
  // bulb and env map, ringed by a darker soaked halo on the concrete.
  const puddleMat = new THREE.MeshStandardMaterial({
    color: 0x0a0c10,
    roughness: 0.04,
    metalness: 0.85,
    envMapIntensity: 2.2,
    transparent: true,
    opacity: 0.92,
  });
  const haloMat = matte(0x101114, 0.5, 0.06);
  haloMat.transparent = true;
  haloMat.opacity = 0.6;
  for (const [px, pz, pr, seed] of [
    [-6, 4, 2.2, 1],
    [7, -3, 3.0, 2],
    [-3, -8, 1.6, 3],
    [4, 9, 2.6, 4],
    [-9, -2, 1.3, 5],
  ] as const) {
    const puddle = new THREE.Mesh(new THREE.ShapeGeometry(puddleShape(pr, seed), 24), puddleMat);
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(px, 0.015, pz);
    puddle.receiveShadow = true;
    g.add(puddle);
    const halo = new THREE.Mesh(new THREE.ShapeGeometry(puddleShape(pr * 1.25, seed + 9), 20), haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(px, 0.008, pz);
    g.add(halo);
  }
  // A slow ripple ring on the biggest puddle — a drip from the pipes above.
  // Named so the renderer can find and animate it (scale + fade cycle).
  const rippleMat = new THREE.MeshBasicMaterial({
    color: 0x3a4048,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.85, 0.95, 24), rippleMat);
  ripple.name = "puddle-ripple";
  ripple.rotation.x = -Math.PI / 2;
  ripple.position.set(7, 0.02, -3); // centre of the pr=3.0 puddle
  g.add(ripple);

  // Stained concrete walls — plaster normal map gives the cinderblock relief.
  const wallMat = dress(matte(PAL.wall, 0.98), "plaster", { repeat: 3, normalScale: 1.0 });
  const wallTex = makeGrungeTexture(PAL.wall, { scratches: 30, grime: 8000, cinderblock: true, tallyMarks: true });
  if (wallTex) {
    wallTex.repeat.set(3, 2);
    wallMat.map = wallTex;
  }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), wallMat);
  back.position.set(0, 15, -16);
  back.receiveShadow = true;
  g.add(back);

  const left = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), wallMat);
  left.position.set(-22, 15, 0);
  left.rotation.y = Math.PI / 2;
  left.receiveShadow = true;
  g.add(left);

  const right = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), wallMat);
  right.position.set(22, 15, 0);
  right.rotation.y = -Math.PI / 2;
  right.receiveShadow = true;
  g.add(right);

  // Corrugated metal panels lining the lower back wall (alternating shades).
  const panelA = metalMat(0x23262a, 0.7);
  const panelB = metalMat(0x1c1f23, 0.75);
  for (let i = -4; i <= 4; i++) {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 6, 0.12),
      i % 2 === 0 ? panelA : panelB,
    );
    panel.position.set(i * 2.8, 3, -15.8);
    panel.receiveShadow = true;
    g.add(panel);
  }

  // Exposed pipes running high along the back wall, with vertical feeds.
  const pipeMat = metalMat(0x2e3236, 0.6);
  const rustMat = metalMat(0x4a3326, 0.8);
  const backPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 44, 10), pipeMat);
  backPipe.rotation.z = Math.PI / 2;
  backPipe.position.set(0, 9.5, -15.6);
  g.add(backPipe);
  const backPipe2 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 44, 10), rustMat);
  backPipe2.rotation.z = Math.PI / 2;
  backPipe2.position.set(0, 8.8, -15.55);
  g.add(backPipe2);
  for (const vx of [-9, 5.5, 12] as const) {
    const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 19, 10), pipeMat);
    feed.position.set(vx, 9.5, -15.6);
    g.add(feed);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.3, 10), rustMat);
    collar.position.set(vx, 9.5, -15.6);
    g.add(collar);
  }

  // A barred wall vent leaking sickly light, with cheap volumetric shafts.
  const ventFrame = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 0.2), metalMat(0x1a1d20, 0.6));
  ventFrame.position.set(8, 12, -15.85);
  g.add(ventFrame);
  const ventGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.8), glow(0x7a8f7e, 0.3));
  ventGlow.position.set(8, 12, -15.74);
  g.add(ventGlow);
  const barMat = metalMat(0x0e1012, 0.5);
  for (let i = 0; i < 5; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.0, 0.08), barMat);
    bar.position.set(8 - 1.2 + i * 0.6, 12, -15.7);
    g.add(bar);
  }
  const shaftMat = new THREE.MeshBasicMaterial({
    color: 0x84947f,
    transparent: true,
    opacity: 0.03,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < 3; i++) {
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(2.4 - i * 0.5, 10), shaftMat);
    shaft.position.set(8 - i * 0.3, 7.5, -14.6 + i * 0.5);
    shaft.rotation.x = 0.35;
    g.add(shaft);
  }

  // === PRISON ELEMENTS ===

  // 1. Heavy Iron Cell Door on the left wall
  const doorGroup = new THREE.Group();
  doorGroup.position.set(-21.9, 0, -2);
  doorGroup.rotation.y = Math.PI / 2;
  
  const doorFrameMat = metalMat(0x141416, 0.6);
  const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 14, 0.4), doorFrameMat);
  frameL.position.set(-3.6, 7, 0);
  const frameR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 14, 0.4), doorFrameMat);
  frameR.position.set(3.6, 7, 0);
  const frameT = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.4, 0.4), doorFrameMat);
  frameT.position.set(0, 14, 0);
  doorGroup.add(frameL, frameR, frameT);

  // Bars for the door
  for (let i = 0; i < 9; i++) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 14, 8), barMat);
    bar.position.set(-3.2 + i * 0.8, 7, 0);
    doorGroup.add(bar);
  }
  // Crossbars
  for (let i = 0; i < 3; i++) {
    const cross = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.25, 0.3), doorFrameMat);
    cross.position.set(0, 3 + i * 4, 0);
    doorGroup.add(cross);
  }
  castReceive(doorGroup, true, true);
  g.add(doorGroup);

  // 2. Rusted metal cot in the back right corner
  const cotGroup = new THREE.Group();
  cotGroup.position.set(15, 0, -11);
  cotGroup.rotation.y = -0.15;
  
  const cotMat = metalMat(0x2a201c, 0.8);
  const mattressMat = matte(0x121412, 0.95); // dark, gross mattress
  
  const legGeo = new THREE.CylinderGeometry(0.15, 0.15, 2, 8);
  for (const pos of [[-4, -2], [4, -2], [-4, 2], [4, 2]]) {
    const leg = new THREE.Mesh(legGeo, cotMat);
    leg.position.set(pos[0] as number, 1, pos[1] as number);
    cotGroup.add(leg);
  }
  const frameMesh = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.2, 4.4), cotMat);
  frameMesh.position.set(0, 2, 0);
  cotGroup.add(frameMesh);
  
  // Sagging mattress: a squashed rounded slab, with a crumpled blanket fold.
  const mattressGeo = new THREE.ExtrudeGeometry(roundedRectShape(8, 4, 0.5), {
    depth: 0.4,
    bevelEnabled: true,
    bevelThickness: 0.12,
    bevelSize: 0.12,
    bevelSegments: 2,
    curveSegments: 8,
  });
  mattressGeo.rotateX(-Math.PI / 2);
  const mattress = new THREE.Mesh(mattressGeo, dress(mattressMat, "fabric", { normalScale: 0.8 }));
  mattress.position.set(0, 2.62, 0);
  cotGroup.add(mattress);
  const blanket = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 3.0, 4, 10),
    dress(matte(0x1e2420, 0.95), "fabric", { normalScale: 0.9 }),
  );
  blanket.scale.set(1, 0.5, 1);
  blanket.rotation.z = Math.PI / 2;
  blanket.rotation.y = 0.08;
  blanket.position.set(-1.2, 2.85, 0.4);
  cotGroup.add(blanket);
  castReceive(cotGroup, true, true);
  g.add(cotGroup);

  // Ceiling: a stained slab with exposed rusted I-beams so looking up during
  // the bulb swing doesn't reveal an empty void.
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), wallMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, 15.5, 0);
  ceiling.receiveShadow = true;
  g.add(ceiling);
  const beamMat = dress(metalMat(0x241f1a, 0.7), "metal", { normalScale: 0.5 });
  for (const bx of [-14, -5, 4, 13] as const) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 36), beamMat);
    beam.position.set(bx, 15.1, 0);
    g.add(beam);
    const flange = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 36), beamMat);
    flange.position.set(bx, 14.72, 0);
    g.add(flange);
  }

  // 3. Wall chains hanging from the back wall
  const chainMat = metalMat(0x151515, 0.5);
  const ringGeo = new THREE.TorusGeometry(0.3, 0.06, 8, 16);
  const linkGeo = new THREE.TorusGeometry(0.12, 0.04, 8, 12);
  
  for (const xPos of [-14, -6, 2, 12]) {
    const wallRing = new THREE.Mesh(ringGeo, chainMat);
    wallRing.position.set(xPos, 8, -15.8);
    wallRing.rotation.x = Math.PI / 2;
    g.add(wallRing);
    
    // Hang a few links
    const numLinks = 4 + Math.floor(Math.random() * 8);
    for(let i=0; i<numLinks; i++) {
      const link = new THREE.Mesh(linkGeo, chainMat);
      link.position.set(xPos, 7.8 - i * 0.18, -15.7 + (Math.random()*0.02));
      link.rotation.y = i % 2 === 0 ? 0 : Math.PI / 2;
      link.rotation.x = Math.PI / 2;
      link.rotation.z = (Math.random() - 0.5) * 0.3;
      g.add(link);
    }
  }

  // 4. Industrial Toilet / Sink combo
  const toiletGroup = new THREE.Group();
  toiletGroup.position.set(-18, 0, -12);
  toiletGroup.rotation.y = Math.PI / 2;
  
  const steelRustMat = dress(metalMat(0x3a3a40, 0.45), "metal", { normalScale: 0.5 }); // dull, rusted stainless steel
  const porcelainMat = dress(matte(0x80807a, 0.75), "plaster", { normalScale: 0.4 }); // gross discolored porcelain

  // Sink base / stand — a rounded steel column instead of a raw box.
  const baseGeoT = new THREE.ExtrudeGeometry(roundedRectShape(2.4, 2, 0.2), {
    depth: 3.9,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 2,
    curveSegments: 8,
  });
  baseGeoT.rotateX(-Math.PI / 2);
  const toiletBase = new THREE.Mesh(baseGeoT, steelRustMat);
  toiletBase.position.y = 3.95;
  toiletGroup.add(toiletBase);

  // Toilet bowl: lathed with a rolled rim and dark hollow.
  const bowl = lathe(
    [
      [0.35, 0.0],
      [0.5, 0.25],
      [0.68, 0.7],
      [0.8, 1.05],
      [0.84, 1.18], // rolled rim out
      [0.72, 1.2], // rim top rolling inward
      [0.55, 1.1],
    ],
    porcelainMat,
    18,
  );
  bowl.position.set(0, 0.6, 1.4);
  toiletGroup.add(bowl);
  const bowlHole = new THREE.Mesh(new THREE.CircleGeometry(0.5, 14), matte(0x0a0a0c, 0.6));
  bowlHole.rotation.x = -Math.PI / 2;
  bowlHole.position.set(0, 1.72, 1.4);
  toiletGroup.add(bowlHole);

  // Sink basin on top: lathed dish.
  const basin = lathe(
    [
      [0.3, 0.0],
      [0.72, 0.1],
      [0.9, 0.32],
      [0.94, 0.4],
      [0.8, 0.42],
      [0.55, 0.2],
    ],
    steelRustMat,
    16,
  );
  basin.position.set(0, 4.0, 0.4);
  toiletGroup.add(basin);

  // Faucet
  const faucet = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8), steelRustMat);
  faucet.position.set(0, 4.5, -0.2);
  faucet.rotation.x = 0.4;
  toiletGroup.add(faucet);

  castReceive(toiletGroup, true, true);
  g.add(toiletGroup);

  // 5. Floor Drain
  const drainGroup = new THREE.Group();
  drainGroup.position.set(0, 0.02, -8);
  
  const drainMat = metalMat(0x1a1a1c, 0.8);
  const drainBase = new THREE.Mesh(new THREE.CircleGeometry(0.8, 16), drainMat);
  drainBase.rotation.x = -Math.PI / 2;
  drainGroup.add(drainBase);
  
  // Dark blood pooled around the drain — wet-glossy, irregular, with thin
  // runnels reaching toward the grate.
  const drainPuddleMat = new THREE.MeshStandardMaterial({
    color: 0x2a0808, // dark blood
    roughness: 0.06,
    metalness: 0.5,
    envMapIntensity: 1.6,
    transparent: true,
    opacity: 0.9,
  });
  const drainPuddle = new THREE.Mesh(
    new THREE.ShapeGeometry(puddleShape(1.6, 13), 24),
    drainPuddleMat,
  );
  drainPuddle.rotation.x = -Math.PI / 2;
  drainPuddle.position.y = 0.01;
  drainGroup.add(drainPuddle);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6;
    const runnel = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1.1 + (i % 2) * 0.5), drainPuddleMat);
    runnel.rotation.x = -Math.PI / 2;
    runnel.rotation.z = a;
    runnel.position.set(Math.cos(a) * 1.9, 0.009, Math.sin(a) * 1.9);
    drainGroup.add(runnel);
  }

  castReceive(drainGroup, true, true);
  g.add(drainGroup);

  return g;
}

// ---------------------------------------------------------------------------
// Table: a heavy, stained wooden slab with a felt inlay on four thick legs
// ---------------------------------------------------------------------------

export const TABLE = {
  width: 10,
  depth: 6,
  thickness: 0.5,
  topY: 3.0,
} as const;

/** Y of the table's working surface (where props sit). */
export const SURFACE_Y = TABLE.topY + TABLE.thickness / 2;

export function buildTable(): THREE.Group {
  const g = new THREE.Group();
  // Industrial slab: scratched gunmetal top on welded steel legs.
  const steelTop = dress(metalMat(0x2c2f34, 0.6), "metal", { normalScale: 0.5 });
  const steelLeg = dress(metalMat(0x1e2126, 0.65), "metal", { normalScale: 0.4 });

  // Worn, gouged metal (procedural grunge textures).
  const topTex = makeGrungeTexture(0x2c2f34, { scratches: 130, grime: 9000 });
  if (topTex) steelTop.map = topTex;

  // Bevelled slab top (rounded corners + chamfered edge) instead of a box.
  const topGeo = new THREE.ExtrudeGeometry(
    roundedRectShape(TABLE.width, TABLE.depth, 0.25),
    {
      depth: TABLE.thickness - 0.08,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 2,
      curveSegments: 8,
    },
  );
  topGeo.rotateX(-Math.PI / 2);
  normalizePlanarUVs(topGeo);
  const top = new THREE.Mesh(topGeo, steelTop);
  // After rotateX the extrusion (depth + bevel) extends UP from the mesh
  // origin: geometry spans y in [-0.04, depth + 0.04]. Anchor it so the top
  // face lands exactly at SURFACE_Y and nothing on the felt gets swallowed.
  top.position.y = SURFACE_Y - (TABLE.thickness - 0.08 + 0.04);
  g.add(top);

  // A darker brushed-metal playing surface inset into the top — blood-stained
  // and burned where past games ended badly.
  const feltMat = dress(metalMat(0x1c1e22, 0.75), "metal", { normalScale: 0.35 });
  const feltTex = makeGrungeTexture(0x1c1e22, { blood: true, scratches: 90, grime: 8000 });
  if (feltTex) feltMat.map = feltTex;
  const felt = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE.width * 0.82, 0.06, TABLE.depth * 0.74),
    feltMat,
  );
  felt.position.set(0, SURFACE_Y + 0.01, 0);
  felt.receiveShadow = true;
  g.add(felt);

  // A welded steel rim framing the inset surface (replaces the brass rail).
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE.width * 0.85, 0.04, TABLE.depth * 0.77),
    metalMat(0x3d4148, 0.4),
  );
  trim.position.set(0, SURFACE_Y, 0);
  g.add(trim);

  // Worn painted markings on the metal (zone lines + a centre circle) —
  // faded industrial floor-paint white rather than chalk.
  const chalk = new THREE.MeshStandardMaterial({
    color: 0xb7b3a4,
    emissive: 0x1f1e1a,
    emissiveIntensity: 0.25,
    roughness: 0.9,
  });
  const lineY = SURFACE_Y + 0.04;
  const feltW = TABLE.width * 0.8;
  const feltD = TABLE.depth * 0.7;
  const mkLine = (w: number, d: number, x: number, z: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), chalk);
    m.position.set(x, lineY, z);
    g.add(m);
  };
  // Outer boundary.
  mkLine(feltW, 0.05, 0, feltD / 2);
  mkLine(feltW, 0.05, 0, -feltD / 2);
  mkLine(0.05, feltD, feltW / 2, 0);
  mkLine(0.05, feltD, -feltW / 2, 0);
  // The two dividing lines splitting each player's half from the centre.
  mkLine(feltW, 0.05, 0, feltD * 0.16);
  mkLine(feltW, 0.05, 0, -feltD * 0.16);
  // A faint centre circle where the gun rests.
  const circle = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.03, 6, 48), chalk);
  circle.rotation.x = Math.PI / 2;
  circle.position.set(0, lineY, 0);
  g.add(circle);

  const legGeo = new THREE.BoxGeometry(0.6, TABLE.topY, 0.6);
  const lx = TABLE.width / 2 - 0.7;
  const lz = TABLE.depth / 2 - 0.7;
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const leg = new THREE.Mesh(legGeo, steelLeg);
    leg.position.set(sx * lx, TABLE.topY / 2, sz * lz);
    g.add(leg);
  }

  // Steel stretcher bars bracing the legs low to the ground.
  const braceMat = metalMat(0x24272c, 0.6);
  for (const bz2 of [lz, -lz] as const) {
    const brace = new THREE.Mesh(new THREE.BoxGeometry(lx * 2, 0.18, 0.18), braceMat);
    brace.position.set(0, 0.5, bz2);
    g.add(brace);
  }

  // Iron bolt studs at the four corners of the top (like the reference table).
  const boltMat = metalMat(0x2a2a2e, 0.55);
  const bx = TABLE.width / 2 - 0.45;
  const bz = TABLE.depth / 2 - 0.45;
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.1, 6), boltMat);
    bolt.position.set(sx * bx, TABLE.topY + TABLE.thickness / 2 + 0.03, sz * bz);
    g.add(bolt);
  }

  castReceive(g, true, true);
  return g;
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

export interface FigureHandles {
  group: THREE.Group;
  /** The whole upper body — leans on aim/recoil. */
  torso: THREE.Group;
  /** Glowing eye material (intensity flickers / flares on shots). */
  eyeMat: THREE.MeshStandardMaterial;
  /** Glowing grin material (flares with the eyes). */
  mouthMat: THREE.MeshStandardMaterial;
  /** Right arm group — raises when aiming. */
  arm: THREE.Group;
  /** Resting rotation of the arm (radians, X) so the renderer can return to it. */
  armRestX: number;
  /** The OTHER (resting) arm — used for idle gestures like the neck scratch. */
  restArm?: THREE.Group;
}

/** A creepy glowing crescent grin built from a partial torus arc. */
function buildGrin(color: number, intensity: number, width: number): THREE.Mesh {
  const geo = new THREE.TorusGeometry(width, width * 0.16, 6, 16, Math.PI);
  const mesh = new THREE.Mesh(geo, glow(color, intensity));
  // Flip so the arc opens upward into a smile.
  mesh.rotation.z = Math.PI;
  return mesh;
}

/**
 * The Dealer: a bodiless horror — one giant skull-sphere of mottled flesh-bone
 * with hollow black sockets and a grin of long interlocking fangs wrapping the
 * lower face, carried on two emaciated clawed arms that grow straight out of
 * the skull and rest on the table. (Modelled after the ENEMY reference sheet.)
 */
export function buildDealer(): FigureHandles {
  const group = new THREE.Group();
  const torso = new THREE.Group();

  // Mottled flesh-over-bone hide: dark bruised brown, leathery. Kept very
  // dark so the warm bulb light can't turn it salmon.
  const hide = dress(
    new THREE.MeshStandardMaterial({ color: 0x3a2b21, roughness: 0.88, metalness: 0.03 }),
    "leather",
    { normalScale: 1.1 },
  );
  const hideDark = dress(matte(0x281c14, 0.94), "leather", { normalScale: 1.0 });

  // --- The skull: a huge near-sphere, slightly taller than wide, its face
  // flattened where the features sink in. Centre y=4.2, radius ~2.35.
  const R = 2.35;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 22), hide);
  skull.scale.set(1.0, 1.06, 0.98);
  skull.position.y = 4.2;
  torso.add(skull);
  // Bruised mottling: irregular darker patches sunk INTO the surface so they
  // read as staining rather than dots stuck on top.
  for (const [ma, mb, mr, msq] of [
    [0.4, 1.1, 0.7, 0.6],
    [-0.9, 0.9, 0.95, 0.5],
    [2.4, 0.7, 0.8, 0.7],
    [-2.2, 0.4, 0.65, 0.45],
    [3.0, -0.2, 0.85, 0.6],
    [1.6, -0.5, 0.6, 0.5],
    [-1.4, -0.3, 0.7, 0.65],
  ] as const) {
    // ma = azimuth, mb = elevation (radians), mr = patch radius, msq = squash
    const patch = new THREE.Mesh(new THREE.SphereGeometry(mr, 10, 8), hideDark);
    patch.scale.set(1.4, msq, 0.12); // wide, flat smears hugging the surface
    const px = Math.sin(ma) * Math.cos(mb) * (R - 0.12);
    const py = Math.sin(mb) * (R - 0.12) * 1.06 + 4.2;
    const pz = Math.cos(ma) * Math.cos(mb) * (R - 0.12) * 0.98;
    patch.position.set(px, py, pz);
    patch.lookAt(0, 4.2, 0);
    patch.rotation.z += ma * 0.6; // vary the smear direction
    torso.add(patch);
  }

  // --- Hollow eye sockets: deep black pits, the left fractionally larger —
  // rimmed with a swollen ridge of flesh.
  const socketMat = matte(0x030303, 0.95);
  const eyeMat = glow(0xd8ffe4, 0.4);
  for (const sx of [-1, 1] as const) {
    const big = sx === -1;
    const socket = new THREE.Mesh(new THREE.SphereGeometry(big ? 0.6 : 0.54, 14, 12), socketMat);
    socket.scale.set(1, 1.12, 0.5);
    socket.position.set(sx * 0.92, 5.6, 1.72);
    torso.add(socket);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(big ? 0.62 : 0.56, 0.09, 8, 18), hideDark);
    rim.position.set(sx * 0.92, 5.6, 1.68);
    rim.rotation.x = -0.35;
    rim.scale.set(1, 1.1, 1);
    torso.add(rim);
    // A pinprick glint lost deep in each pit (the renderer flares these).
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeMat);
    glint.position.set(sx * 0.9, 5.57, 1.76);
    torso.add(glint);
  }

  // --- Nose: a small collapsed hollow between the sockets.
  const noseHole = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), socketMat);
  noseHole.scale.set(0.8, 1.1, 0.4);
  noseHole.position.set(0, 5.05, 2.2);
  torso.add(noseHole);

  // --- The maw: a vast dark cavity across the mid-face — raised high enough
  // to clear the table edge, glowing faintly from within (mouthMat — the
  // renderer flares it on shots).
  const mouthMat = glow(0x1c0503, 0.25);
  mouthMat.roughness = 0.95; // dead matte — a void, not a glossy bulge
  const maw = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 14), mouthMat);
  maw.scale.set(2.15, 0.9, 0.62);
  maw.position.set(0, 4.15, 1.28); // recessed INTO the skull so fangs stand proud
  torso.add(maw);
  // Swollen lip ridges above and below the maw.
  for (const [ly, lr] of [
    [4.9, 2.0],
    [3.4, 1.95],
  ] as const) {
    const lip = new THREE.Mesh(new THREE.TorusGeometry(lr, 0.14, 8, 24, Math.PI * 1.1), hideDark);
    lip.position.set(0, ly, 0.6);
    lip.rotation.x = Math.PI / 2;
    lip.rotation.z = -Math.PI * 0.05;
    torso.add(lip);
  }

  // --- Fangs: two interlocking rows of long, thin, uneven spikes following
  // the curve of the face — the signature of the reference sheet.
  const toothMat = dress(matte(0xc9bda4, 0.85), "plaster", { normalScale: 0.4 });
  const toothStained = matte(0x9a8768, 0.85);
  // Upper row: 13 long fangs pointing down.
  for (let i = 0; i < 13; i++) {
    const a = -1.05 + (i / 12) * 2.1; // arc around the face (azimuth)
    const jag = (i * 7919) % 5; // deterministic unevenness
    const len = 0.75 + jag * 0.09 + (i % 2) * 0.12;
    const tooth = new THREE.Mesh(
      new THREE.ConeGeometry(0.085, len, 6),
      jag > 2 ? toothStained : toothMat,
    );
    tooth.rotation.x = Math.PI; // point down
    tooth.position.set(Math.sin(a) * 2.0, 4.75 - len / 2, Math.cos(a) * 1.62 + 0.62);
    tooth.rotation.z = ((i % 3) - 1) * 0.08;
    tooth.rotation.y = a;
    torso.add(tooth);
  }
  // Lower row: 11 shorter fangs pointing up, offset to interlock.
  for (let i = 0; i < 11; i++) {
    const a = -0.95 + (i / 10) * 1.9 + 0.08;
    const jag = (i * 104729) % 4;
    const len = 0.55 + jag * 0.08;
    const tooth = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, len, 6),
      jag > 1 ? toothStained : toothMat,
    );
    tooth.position.set(Math.sin(a) * 1.95, 3.5 + len / 2, Math.cos(a) * 1.58 + 0.62);
    tooth.rotation.z = ((i % 3) - 1) * -0.07;
    tooth.rotation.y = a;
    torso.add(tooth);
  }

  // --- Dried blood staining running from the sockets and maw corners.
  const gore = matte(0x3d120c, 0.7);
  for (const [gx, gy, gl, grz] of [
    [-0.95, 5.0, 0.7, 0.1],
    [0.98, 5.05, 0.55, -0.15],
    [-1.85, 4.1, 0.5, 0.5],
    [1.8, 4.05, 0.55, -0.5],
  ] as const) {
    const streak = new THREE.Mesh(new THREE.BoxGeometry(0.1, gl, 0.04), gore);
    streak.position.set(gx, gy, 1.95);
    streak.rotation.z = grz;
    streak.rotation.x = -0.15;
    torso.add(streak);
  }

  // Sickly cold underlight thrown up into the maw and sockets.
  const faceLight = new THREE.PointLight(0xbfe8c8, 2.2, 4.5, 2);
  faceLight.position.set(0, 4.0, 2.7);
  torso.add(faceLight);

  // --- Arms: emaciated limbs growing straight out of the skull's sides,
  // reaching forward so the claws rest on the table. Same rest rotations
  // (x=-1.15, z=±0.2) so all renderer arm animations keep working.
  const restArm = buildMonsterArm(hide, 1.45, true, hideDark);
  restArm.position.set(2.3, 4.4, 0.9);
  restArm.rotation.x = -1.15;
  restArm.rotation.z = -0.42; // splayed wide like the reference stance
  torso.add(restArm);

  const arm = buildMonsterArm(hide, 1.45, false, hideDark);
  arm.position.set(-2.3, 4.4, 0.9);
  const armRestX = -1.15;
  arm.rotation.x = armRestX;
  arm.rotation.z = 0.42;
  torso.add(arm);

  group.add(torso);
  // The skull sits fractionally off-plumb — wrong in a way you can't name.
  torso.rotation.z = 0.02;
  castReceive(group, true, false);
  return { group, torso, eyeMat, mouthMat, arm, armRestX, restArm };
}

/** The Player: a hunched hooded figure, dimmer eyes and a faint grin. */
export function buildPlayer(): FigureHandles {
  const group = new THREE.Group();
  const torso = new THREE.Group();
  const coat = dress(matte(0x2a241d, 0.95), "fabric", { normalScale: 0.55 });
  const hoodMat = dress(matte(0x1b1712, 0.97), "fabric", { normalScale: 0.6 });
  const flesh = matte(0x5a4f43, 0.85);

  // Lathed coat skirt with a slight flare and ragged hem.
  const lower = lathe(
    [
      [1.5, 0.0],
      [1.32, 0.5],
      [1.1, 1.6],
      [0.95, 2.4],
      [0.9, 3.0],
    ],
    coat,
    14,
  );
  group.add(lower);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.5;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.45 + (i % 2) * 0.2, 0.05), coat);
    strip.position.set(Math.cos(a) * 1.4, 0.2, Math.sin(a) * 1.4);
    strip.rotation.y = -a + Math.PI / 2;
    group.add(strip);
  }

  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.8, 1.0, 4, 12), coat);
  chest.scale.set(1, 1, 0.8);
  chest.position.y = 3.3;
  torso.add(chest);

  const shoulders = new THREE.Mesh(new THREE.SphereGeometry(1.05, 14, 12), hoodMat);
  shoulders.scale.set(1.2, 0.65, 1.0);
  shoulders.position.y = 3.95;
  torso.add(shoulders);

  // Hood: a lathed cowl that drapes onto the shoulders and peaks slightly.
  const hood = lathe(
    [
      [0.95, -0.55], // draped base spreading onto the shoulders
      [0.78, -0.3],
      [0.7, 0.0],
      [0.66, 0.35],
      [0.5, 0.62],
      [0.18, 0.78], // slouched peak
      [0.0, 0.74],
    ],
    hoodMat,
    16,
  );
  hood.position.y = 4.55;
  torso.add(hood);
  const brim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.54, 0.72, 0.6, 14, 1, true),
    hoodMat,
  );
  brim.position.set(0, 4.32, 0.18);
  brim.rotation.x = 0.15;
  torso.add(brim);

  const face = new THREE.Mesh(new THREE.SphereGeometry(0.44, 16, 16), flesh);
  face.scale.set(0.92, 1.08, 0.72);
  face.position.set(0, 4.52, 0.3);
  torso.add(face);

  const socketMat = matte(0x120e0b, 0.9);
  const socketGeo = new THREE.SphereGeometry(0.12, 10, 10);
  const skL = new THREE.Mesh(socketGeo, socketMat);
  skL.position.set(-0.16, 4.62, 0.54);
  const skR = new THREE.Mesh(socketGeo, socketMat);
  skR.position.set(0.16, 4.62, 0.54);
  torso.add(skL, skR);

  const eyeMat = glow(PAL.ember, 2.4);
  const eyeGeo = new THREE.SphereGeometry(0.1, 10, 10);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.16, 4.62, 0.58);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(0.16, 4.62, 0.58);
  torso.add(eyeL, eyeR);

  const mouthMat = glow(0xd4561c, 1.6);
  const grin = buildGrin(0xd4561c, 1.6, 0.24);
  grin.material = mouthMat;
  grin.position.set(0, 4.36, 0.6);
  grin.scale.set(1, 0.65, 1);
  torso.add(grin);

  const faceLight = new THREE.PointLight(0xff6a28, 1.8, 2.8, 2);
  faceLight.position.set(0, 4.55, 1.0);
  torso.add(faceLight);

  const armL = buildArm(coat, flesh, 0.85);
  armL.position.set(-0.92, 3.5, 0.3);
  armL.rotation.x = -1.2;
  armL.rotation.z = 0.2;
  torso.add(armL);

  const arm = buildArm(coat, flesh, 0.85);
  arm.position.set(0.92, 3.5, 0.3);
  const armRestX = -1.2;
  arm.rotation.x = armRestX;
  arm.rotation.z = -0.2;
  torso.add(arm);

  group.add(torso);
  castReceive(group, true, false);
  return { group, torso, eyeMat, mouthMat, arm, armRestX };
}

/** 
 * Build First-Person Player Hands that rest on the table 
 */
export function buildPlayerHands(): THREE.Group {
  const group = new THREE.Group();
  const flesh = matte(0xa8a29a, 0.75); // pale, bloodless flesh
  const fleshDark = matte(0x8a847c, 0.8); // knuckle shading
  const sleeve = matte(0x101012, 0.92); // ragged black sleeves
  const cuffMat = matte(0x1c1c20, 0.85);

  const buildHand = (isLeft: boolean): THREE.Group => {
    const handGroup = new THREE.Group();

    // Forearm sleeve, with a rolled cuff at the wrist.
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 1.8, 12), sleeve);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(0, 0.2, 0.9);
    handGroup.add(arm);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.33, 0.16, 12), cuffMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, 0.2, 0.12);
    handGroup.add(cuff);

    // Palm: a rounded, bony wedge (capsule squashed flat) with tendon ridges.
    const hand = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.34, 4, 10), flesh);
    hand.scale.set(1.05, 0.38, 1.15);
    hand.rotation.x = Math.PI / 2;
    hand.position.set(0, 0.04, -0.22);
    handGroup.add(hand);
    // Tendons fanning from the wrist to each knuckle.
    for (let i = 0; i < 4; i++) {
      const fx = -0.2 + i * 0.13;
      const tendon = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.3, 2, 6), fleshDark);
      tendon.rotation.x = Math.PI / 2 - 0.06;
      tendon.rotation.z = fx * 0.5;
      tendon.position.set(fx * 0.8, 0.1, -0.25);
      handGroup.add(tendon);
    }

    // Four three-segment fingers with knuckle bumps, curled and tense.
    for (let i = 0; i < 4; i++) {
      const fx = -0.2 + i * 0.13;
      const splay = (i - 1.5) * 0.06;
      const lenScale = i === 1 || i === 2 ? 1.08 : 0.94; // middle fingers longer
      const proximal = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.052, 0.2 * lenScale, 2, 8),
        flesh,
      );
      proximal.rotation.x = Math.PI / 2 - 0.12;
      proximal.rotation.z = splay * 0.4;
      proximal.position.set(fx, -0.02, -0.55);
      handGroup.add(proximal);
      const middle = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.046, 0.14 * lenScale, 2, 8),
        flesh,
      );
      middle.rotation.x = Math.PI / 2 - 0.42;
      middle.position.set(fx + splay * 0.25, -0.09, -0.73);
      handGroup.add(middle);
      const distal = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.04, 0.09 * lenScale, 2, 8),
        flesh,
      );
      distal.rotation.x = Math.PI / 2 - 0.8;
      distal.position.set(fx + splay * 0.35, -0.17, -0.85);
      handGroup.add(distal);
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.056, 8, 6), fleshDark);
      knuckle.position.set(fx, 0.05, -0.45);
      handGroup.add(knuckle);
    }

    // Thumb: two segments tucked along the inner edge.
    const thumbSide = isLeft ? 1 : -1;
    const thumbBase = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.18, 2, 8), flesh);
    thumbBase.rotation.set(Math.PI / 2 - 0.2, 0, thumbSide * 0.9);
    thumbBase.position.set(thumbSide * 0.3, 0.0, -0.28);
    handGroup.add(thumbBase);
    const thumbTip = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.12, 2, 8), flesh);
    thumbTip.rotation.set(Math.PI / 2 - 0.5, 0, thumbSide * 0.6);
    thumbTip.position.set(thumbSide * 0.42, -0.05, -0.44);
    handGroup.add(thumbTip);

    handGroup.position.set(isLeft ? -2.5 : 2.5, 3.4, 6.5);
    handGroup.rotation.y = isLeft ? 0.2 : -0.2;
    return handGroup;
  };

  group.add(buildHand(true));
  group.add(buildHand(false));
  castReceive(group, true, true);
  return group;
}

/**
 * A two-segment arm with an articulated skeletal hand, pivoting at the
 * shoulder. Same reach/pose as before so renderer arm rotations line up.
 */
function buildArm(
  coat: THREE.MeshStandardMaterial,
  flesh: THREE.MeshStandardMaterial,
  scale = 1,
): THREE.Group {
  const arm = new THREE.Group();
  const s = scale;
  // Shoulder cap under the sleeve.
  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.2 * s, 10, 8), coat);
  arm.add(shoulder);
  const upper = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.16 * s, 1.15 * s, 3, 10),
    coat,
  );
  upper.position.y = -0.7 * s;
  arm.add(upper);
  // Elbow joint.
  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.155 * s, 10, 8), coat);
  elbow.position.set(0, -1.38 * s, 0.06 * s);
  arm.add(elbow);
  const fore = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.125 * s, 0.95 * s, 3, 10),
    coat,
  );
  fore.position.set(0, -1.6 * s, 0.35 * s);
  fore.rotation.x = -0.5;
  arm.add(fore);
  // Frayed sleeve cuff at the wrist.
  const cuff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15 * s, 0.17 * s, 0.16 * s, 10, 1, true),
    coat,
  );
  cuff.position.set(0, -2.0 * s, 0.62 * s);
  cuff.rotation.x = -0.5;
  arm.add(cuff);
  // Bony wrist + palm.
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * s, 0.08 * s, 0.16 * s, 8), flesh);
  wrist.position.set(0, -2.08 * s, 0.66 * s);
  wrist.rotation.x = -0.5;
  arm.add(wrist);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.15 * s, 10, 8), flesh);
  hand.scale.set(1, 0.55, 1.3);
  hand.position.set(0, -2.15 * s, 0.7 * s);
  arm.add(hand);
  // Long thin fingers draping forward off the palm.
  for (let i = 0; i < 4; i++) {
    const fx = (-0.09 + i * 0.06) * s;
    const finger = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.022 * s, 0.24 * s, 2, 6),
      flesh,
    );
    finger.position.set(fx, -2.28 * s, 0.86 * s);
    finger.rotation.x = -1.15 - (i % 2) * 0.12;
    arm.add(finger);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.025 * s, 0.16 * s, 2, 6), flesh);
  thumb.position.set(0.15 * s, -2.18 * s, 0.72 * s);
  thumb.rotation.set(-0.8, 0, -0.7);
  arm.add(thumb);
  return arm;
}

/**
 * The dealer's monstrous arm: an elongated sleeved limb ending in a leathery
 * grey-green claw-hand — four triple-jointed fingers roughly twice human
 * length, each tipped with a curved black talon, plus a splayed thumb-claw.
 * Same pivot and overall reach direction as buildArm so every existing
 * renderer arm animation (pickup, point, item use) keeps working.
 */
function buildMonsterArm(
  coat: THREE.MeshStandardMaterial,
  scale = 1,
  mirror = false,
  hideOverride?: THREE.MeshStandardMaterial,
): THREE.Group {
  const arm = new THREE.Group();
  const s = scale;
  const m = mirror ? -1 : 1;
  // Leathery monster skin (drowned-grey default, or the caller's flesh).
  const hide = hideOverride ?? dress(matte(0x4a5246, 0.85), "leather", { normalScale: 0.9 });
  const talon = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0.3, roughness: 0.35 });

  // Shoulder cap under the sleeve.
  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.2 * s, 10, 8), coat);
  arm.add(shoulder);
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.16 * s, 1.15 * s, 3, 10), coat);
  upper.position.y = -0.7 * s;
  arm.add(upper);
  // Knobbly elbow with a bone spur punching through the sleeve.
  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.17 * s, 10, 8), coat);
  elbow.position.set(0, -1.38 * s, 0.06 * s);
  arm.add(elbow);
  const spur = new THREE.Mesh(new THREE.ConeGeometry(0.045 * s, 0.22 * s, 6), hide);
  spur.position.set(0, -1.44 * s, -0.1 * s);
  spur.rotation.x = Math.PI + 0.4;
  arm.add(spur);
  // Forearm: LONGER than human — the sleeve ends short and bare hide shows.
  const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.12 * s, 1.25 * s, 3, 10), coat);
  fore.position.set(0, -1.68 * s, 0.42 * s);
  fore.rotation.x = -0.5;
  arm.add(fore);
  const bareFore = new THREE.Mesh(new THREE.CapsuleGeometry(0.085 * s, 0.5 * s, 3, 8), hide);
  bareFore.position.set(0, -2.18 * s, 0.68 * s);
  bareFore.rotation.x = -0.5;
  arm.add(bareFore);
  // Frayed sleeve cuff, riding high on the too-long forearm.
  const cuff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14 * s, 0.17 * s, 0.16 * s, 10, 1, true),
    coat,
  );
  cuff.position.set(0, -1.98 * s, 0.58 * s);
  cuff.rotation.x = -0.5;
  arm.add(cuff);

  // Gnarled wrist knuckle-mass + narrow palm.
  const wrist = new THREE.Mesh(new THREE.SphereGeometry(0.1 * s, 8, 8), hide);
  wrist.position.set(0, -2.42 * s, 0.8 * s);
  arm.add(wrist);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.14 * s, 10, 8), hide);
  hand.scale.set(1, 0.45, 1.5);
  hand.position.set(0, -2.5 * s, 0.9 * s);
  arm.add(hand);

  // Four triple-jointed fingers, ~2x human length, arched so the tips REST
  // on the felt with the talons digging in.
  for (let i = 0; i < 4; i++) {
    const fx = (-0.11 + i * 0.073) * s * m;
    const stagger = (i % 2) * 0.08;
    // Segment 1: root, angled down-and-forward off the palm.
    const seg1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.028 * s, 0.3 * s, 2, 6), hide);
    seg1.position.set(fx, -2.6 * s, 1.06 * s);
    seg1.rotation.x = -1.0 - stagger;
    arm.add(seg1);
    const kn1 = new THREE.Mesh(new THREE.SphereGeometry(0.036 * s, 6, 6), hide);
    kn1.position.set(fx, -2.72 * s, 1.18 * s);
    arm.add(kn1);
    // Segment 2: arching further out, flatter.
    const seg2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.024 * s, 0.26 * s, 2, 6), hide);
    seg2.position.set(fx, -2.82 * s, 1.32 * s);
    seg2.rotation.x = -1.35 - stagger;
    arm.add(seg2);
    const kn2 = new THREE.Mesh(new THREE.SphereGeometry(0.03 * s, 6, 6), hide);
    kn2.position.set(fx, -2.88 * s, 1.44 * s);
    arm.add(kn2);
    // Segment 3: nearly horizontal, pressing into the table.
    const seg3 = new THREE.Mesh(new THREE.CapsuleGeometry(0.02 * s, 0.2 * s, 2, 6), hide);
    seg3.position.set(fx, -2.92 * s, 1.56 * s);
    seg3.rotation.x = -1.5 - stagger * 0.5;
    arm.add(seg3);
    // Curved black talon at the tip.
    const claw = new THREE.Mesh(new THREE.ConeGeometry(0.022 * s, 0.18 * s, 6), talon);
    claw.position.set(fx, -2.96 * s, 1.68 * s);
    claw.rotation.x = -2.1;
    arm.add(claw);
  }
  // Thumb-claw splayed to the inner side.
  const thumbSeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.03 * s, 0.26 * s, 2, 6), hide);
  thumbSeg.position.set(0.17 * s * m, -2.56 * s, 0.98 * s);
  thumbSeg.rotation.set(-1.0, 0, m * -0.85);
  arm.add(thumbSeg);
  const thumbClaw = new THREE.Mesh(new THREE.ConeGeometry(0.024 * s, 0.16 * s, 6), talon);
  thumbClaw.position.set(0.27 * s * m, -2.68 * s, 1.08 * s);
  thumbClaw.rotation.set(-1.9, 0, m * -0.6);
  arm.add(thumbClaw);
  return arm;
}

// ---------------------------------------------------------------------------
// The Revolver: a proper top-down six-shooter that lies on the table
// ---------------------------------------------------------------------------

export interface RevolverHandles {
  group: THREE.Group;
  /** Spins about its axis. */
  drum: THREE.Group;
  /** Muzzle flash light + sprite. */
  flash: THREE.PointLight;
  flashMesh: THREE.Mesh;
  /** Hammer spur — eases back while aiming, snaps forward on fire. */
  hammer?: THREE.Mesh;
}

/**
 * Map an ExtrudeGeometry drawn in "gun profile space" into gun-table space.
 * Profile space: shape-x = world Z (gun length, muzzle at -x), shape-y =
 * world X (gun-up), extrusion depth = world Y (thickness lying on the felt).
 */
function gunProfileToTable(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 0, 1), // shape X -> world Z
    new THREE.Vector3(1, 0, 0), // shape Y -> world X (gun-up)
    new THREE.Vector3(0, 1, 0), // extrude Z -> world Y
  );
  geo.applyMatrix4(m);
  return geo;
}

export function buildRevolver(): RevolverHandles {
  // A Colt-SAA-style revolver modelled lying on its SIDE on the table, so the
  // top-down camera sees its side profile (like the reference photo). The
  // profile is drawn in the X-Z plane (length along Z, "up of the gun" along
  // +X) and is thin along Y, so it rests flat on the felt with no clipping.
  const group = new THREE.Group();
  // Worn blued steel: a near-black body whose edges catch the light where
  // decades of handling have rubbed the bluing away.
  const silver = dress(
    new THREE.MeshStandardMaterial({ color: 0x2e3138, metalness: 0.9, roughness: 0.35 }),
    "metal",
    { normalScale: 0.35 },
  );
  const silverHi = dress(
    new THREE.MeshStandardMaterial({ color: 0x4c515c, metalness: 0.85, roughness: 0.25 }),
    "metal",
    { normalScale: 0.3 },
  );
  const wood = dress(
    new THREE.MeshStandardMaterial({ color: 0x3a2317, metalness: 0.05, roughness: 0.7 }),
    "checker",
    { normalScale: 1.1, repeat: 2 },
  );
  const brass = metalMat(PAL.brass, 0.4);
  const boreDark = matte(0x060607, 0.6);

  const T = 0.36; // thickness in Y (how thick the gun is as it lies on its side)
  const yc = T / 2;

  // --- Frame: a real side-profile silhouette with a cylinder window -----
  const frameShape = new THREE.Shape();
  frameShape.moveTo(-0.75, 0.08);
  frameShape.lineTo(-0.75, 0.3);
  frameShape.quadraticCurveTo(-0.55, 0.4, -0.32, 0.43);
  frameShape.quadraticCurveTo(0.15, 0.5, 0.55, 0.45); // top strap arc
  frameShape.quadraticCurveTo(0.8, 0.36, 0.82, 0.12); // recoil shield
  frameShape.quadraticCurveTo(0.84, -0.12, 0.68, -0.26);
  frameShape.quadraticCurveTo(0.4, -0.36, 0.05, -0.33);
  frameShape.quadraticCurveTo(-0.35, -0.26, -0.55, -0.08);
  frameShape.quadraticCurveTo(-0.68, -0.0, -0.75, 0.08);
  const win = new THREE.Path();
  win.moveTo(-0.24, -0.18);
  win.lineTo(0.6, -0.18);
  win.lineTo(0.6, 0.34);
  win.lineTo(-0.24, 0.34);
  win.closePath();
  frameShape.holes.push(win);
  const frameGeo = new THREE.ExtrudeGeometry(frameShape, {
    depth: T - 0.04,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
    curveSegments: 14,
  });
  gunProfileToTable(frameGeo);
  frameGeo.translate(0, 0.02, 0);
  const frame = new THREE.Mesh(frameGeo, silver);
  group.add(frame);

  // --- Barrel: tapered octagonal tube with a dark bore and front sight --
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.17, 1.5, 8), silver);
  barrel.rotation.x = Math.PI / 2;
  barrel.rotation.y = Math.PI / 8; // flat facet on top so it reads octagonal
  barrel.position.set(0.12, yc, -1.42);
  group.add(barrel);
  // Barrel lug blending the barrel into the frame.
  const lug = new THREE.Mesh(new THREE.BoxGeometry(0.34, T * 0.9, 0.5), silver);
  lug.position.set(0.0, yc, -0.85);
  group.add(lug);
  // Ejector-rod housing under the barrel.
  const ejector = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.15, 10), silverHi);
  ejector.rotation.x = Math.PI / 2;
  ejector.position.set(-0.14, yc, -1.3);
  group.add(ejector);
  const ejectorTip = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), silverHi);
  ejectorTip.position.set(-0.14, yc, -1.9);
  group.add(ejectorTip);
  // Muzzle ring + dark bore.
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.12, 16), silverHi);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0.12, yc, -2.16);
  group.add(muzzle);
  const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 12), boreDark);
  bore.rotation.x = Math.PI / 2;
  bore.position.set(0.12, yc, -2.225);
  group.add(bore);
  // Blade front sight standing off the barrel's top edge (gun-up = +X).
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.16), silverHi);
  sight.position.set(0.3, yc, -2.05);
  group.add(sight);

  // --- Drum (Cylinder): fluted, with bored chambers and cartridge rims --
  const drum = new THREE.Group();
  drum.position.set(0, yc, 0.18);
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.95, 28), silverHi);
  cyl.rotation.x = Math.PI / 2; // axis along the barrel — shows the side bulge
  drum.add(cyl);
  // Bevelled front edge of the cylinder.
  const cylBevel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.06, 28), silverHi);
  cylBevel.rotation.x = Math.PI / 2;
  cylBevel.position.z = -0.5;
  drum.add(cylBevel);
  const rimBrass = metalMat(0xa8863a, 0.35);
  const primerMat = metalMat(0x8d8d94, 0.3);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const half = Math.PI / 6;
    // Flute groove between chambers (darker recessed channel).
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.6, 10), silver);
    f.rotation.x = Math.PI / 2;
    f.position.set(Math.cos(a + half) * 0.375, Math.sin(a + half) * 0.375, 0.05);
    drum.add(f);
    // Bored chamber mouth on the front face (dark, real-looking).
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.05, 12), boreDark);
    c.rotation.x = Math.PI / 2;
    c.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, -0.505);
    drum.add(c);
    // Cartridge rim + primer visible on the rear face.
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.03, 12), rimBrass);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.49);
    drum.add(rim);
    const primer = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.032, 8), primerMat);
    primer.rotation.x = Math.PI / 2;
    primer.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.492);
    drum.add(primer);
    // Locking notch at the cylinder's mid line.
    const notch = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.1), silver);
    notch.position.set(Math.cos(a) * 0.355, Math.sin(a) * 0.355, 0.25);
    notch.rotation.z = a + Math.PI / 2;
    drum.add(notch);
  }
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 10), silverHi);
  pin.rotation.x = Math.PI / 2;
  drum.add(pin);
  // Turn-line: the faint drag ring worn around the cylinder's mid-line by
  // the bolt stop — the mark of a gun that has been cocked ten thousand times.
  const turnLine = new THREE.Mesh(
    new THREE.TorusGeometry(0.362, 0.006, 4, 36),
    matte(0x17181c, 0.5),
  );
  turnLine.position.z = 0.25;
  drum.add(turnLine);
  group.add(drum);

  // Loading gate: a small disc on the recoil-shield side of the frame.
  const gate = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 12), silverHi);
  gate.rotation.z = Math.PI / 2;
  gate.position.set(0.1, T + 0.005, 0.65);
  group.add(gate);
  const gateScrew = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.04, 8), brass);
  gateScrew.rotation.z = Math.PI / 2;
  gateScrew.position.set(0.1, T + 0.01, 0.65);
  group.add(gateScrew);

  // Sight groove: a thin dark channel along the top strap (gun-up = +X side).
  const groove = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.7), boreDark);
  groove.position.set(0.52, yc, 0.12);
  group.add(groove);

  // --- Hammer: profiled spur (kept as ONE mesh at the same rest pose) ---
  const hamShape = new THREE.Shape();
  hamShape.moveTo(-0.1, -0.1);
  hamShape.lineTo(-0.1, 0.06);
  hamShape.quadraticCurveTo(-0.04, 0.12, 0.06, 0.12);
  hamShape.lineTo(0.13, 0.16); // thumb spur rises back
  hamShape.quadraticCurveTo(0.18, 0.17, 0.17, 0.1);
  hamShape.lineTo(0.08, 0.02);
  hamShape.lineTo(0.06, -0.1);
  hamShape.closePath();
  const hamGeo = new THREE.ExtrudeGeometry(hamShape, {
    depth: T * 0.7,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 1,
    curveSegments: 8,
  });
  gunProfileToTable(hamGeo);
  hamGeo.translate(0, -T * 0.35, 0); // centre thickness on the mesh origin
  const hammer = new THREE.Mesh(hamGeo, silverHi);
  hammer.position.set(0.42, yc, 0.55);
  // A worn brass thumb-pad on the spur where the bluing rubbed through.
  const spurPad = new THREE.Mesh(new THREE.BoxGeometry(0.06, T * 0.5, 0.05), brass);
  spurPad.position.set(0.15, 0, 0.14);
  hammer.add(spurPad);
  group.add(hammer);

  // --- Trigger guard + trigger (ring lies in the X-Z plane) ------------
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.05, 10, 24), silver);
  guard.rotation.x = Math.PI / 2;
  guard.position.set(-0.28, yc, 0.5);
  group.add(guard);
  const trigger = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.2, 8), brass);
  trigger.rotation.z = 0.35;
  trigger.rotation.x = 0.2;
  trigger.position.set(-0.24, yc, 0.48);
  group.add(trigger);

  // --- Plow-handle wood grip: curved profile, angled down-and-back ------
  const gripShape = new THREE.Shape();
  gripShape.moveTo(-0.2, 0.16);
  gripShape.quadraticCurveTo(0.35, 0.2, 0.5, 0.02); // backstrap curve
  gripShape.quadraticCurveTo(0.62, -0.2, 0.5, -0.3); // butt swell
  gripShape.quadraticCurveTo(0.3, -0.42, 0.0, -0.36);
  gripShape.quadraticCurveTo(-0.24, -0.3, -0.26, -0.05);
  gripShape.quadraticCurveTo(-0.27, 0.12, -0.2, 0.16);
  const gripGeo = new THREE.ExtrudeGeometry(gripShape, {
    depth: T - 0.06,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.04,
    bevelSegments: 3,
    curveSegments: 12,
  });
  gunProfileToTable(gripGeo);
  gripGeo.translate(0, 0.03, 0);
  const grip = new THREE.Mesh(gripGeo, wood);
  grip.position.set(-0.62, 0, 1.0);
  grip.rotation.y = 0.55;
  group.add(grip);
  // Steel backstrap cap on the butt.
  const buttcap = new THREE.Mesh(new THREE.BoxGeometry(0.42, T * 0.9, 0.1), silverHi);
  buttcap.position.set(-0.98, yc, 1.34);
  buttcap.rotation.y = 0.7;
  group.add(buttcap);
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, T + 0.02, 10), brass);
  screw.position.set(-0.55, yc, 0.95);
  group.add(screw);

  // Muzzle flash (hidden until fired).
  const flash = new THREE.PointLight(PAL.ember, 0, 9, 2);
  flash.position.set(0.3, yc, -3.4);
  group.add(flash);
  const flashMesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 10), glow(0xffd27f, 3));
  flashMesh.position.set(0.3, yc, -3.4);
  flashMesh.visible = false;
  group.add(flashMesh);

  castReceive(group, true, false);
  group.scale.setScalar(0.62);
  return { group, drum, flash, flashMesh, hammer };
}

// ---------------------------------------------------------------------------
// HP marker: a small candle whose flame gutters out as a life is lost
// (compact, so it doesn't crowd the table)
// ---------------------------------------------------------------------------

export interface HpMarker {
  group: THREE.Group;
  /** The flame mesh — hidden when the life is spent. */
  flame: THREE.Mesh;
  /** Flame material whose emissive flickers. */
  glowMat: THREE.MeshStandardMaterial;
  /** The melting wax column — shrinks when the life is spent. */
  wax: THREE.Mesh;
  light: THREE.PointLight;
}

export function buildHpMarker(): HpMarker {
  const group = new THREE.Group();
  const waxMat = dress(matte(PAL.bone, 0.55), "plaster", { normalScale: 0.5 });

  // A small tarnished lathed dish the candle stands in.
  const dish = lathe(
    [
      [0.0, 0.0],
      [0.16, 0.0],
      [0.24, 0.02],
      [0.26, 0.06],
      [0.22, 0.08],
      [0.14, 0.05],
      [0.0, 0.05],
    ],
    dress(metalMat(0x4a3f28, 0.7), "metal", { normalScale: 0.3 }),
    18,
  );
  group.add(dish);

  // Wax column — lathed with a sagging melted lip and pooled base. The mesh
  // keeps its rest pose (centre y=0.3, unit scale) so renderer melt-scaling
  // (wax.scale.y / wax.position.y) works unchanged.
  const waxGeo = new THREE.LatheGeometry(
    [
      [0.16, -0.25], // pooled base spread
      [0.14, -0.2],
      [0.12, -0.05],
      [0.115, 0.1],
      [0.125, 0.18], // sagging lip bulge
      [0.13, 0.22],
      [0.1, 0.25], // rim folds inward
      [0.05, 0.22], // melted crater
      [0.0, 0.23],
    ].map((p) => new THREE.Vector2(Math.max(p[0] as number, 0.0001), p[1] as number)),
    16,
  );
  const wax = new THREE.Mesh(waxGeo, waxMat);
  wax.position.y = 0.3;
  group.add(wax);
  for (const [dy, dr, da] of [
    [0.44, 0.028, 0.4],
    [0.32, 0.024, 2.2],
    [0.2, 0.034, 4.4],
    [0.38, 0.02, 3.3],
  ] as const) {
    const drip = new THREE.Mesh(new THREE.SphereGeometry(dr, 8, 8), waxMat);
    drip.scale.set(1, 2.2, 1);
    drip.position.set(Math.cos(da) * 0.125, dy, Math.sin(da) * 0.125);
    group.add(drip);
  }

  // Wick.
  const wick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 0.08, 4),
    matte(0x1a140e, 0.9),
  );
  wick.position.y = 0.57;
  group.add(wick);

  // Teardrop flame (emissive).
  const glowMat = glow(0xffb24a, 2.6);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 10), glowMat);
  flame.position.y = 0.72;
  group.add(flame);
  // A faint blue base to the flame — parented to the flame mesh so hiding or
  // guttering the flame hides the blue too (fixes the floating blue dot on
  // snuffed candles).
  const flameBase = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    glow(0x6fa8ff, 1.2),
  );
  flameBase.position.y = -0.1; // local to flame (0.72 - 0.1 = 0.62 world)
  flame.add(flameBase);

  const light = new THREE.PointLight(0xffa030, 0.5, 2.2, 2);
  light.position.set(0, 0.75, 0);
  group.add(light);

  castReceive(wax, true, false);
  castReceive(dish, true, false);
  return { group, flame, glowMat, wax, light };
}

// ---------------------------------------------------------------------------
// Item tokens: a distinct little 3D model per item, on a small base tile
// ---------------------------------------------------------------------------

/** A physical item slot: an open box on the table that may hold one item. */
export interface ItemSlot {
  group: THREE.Group;
  /** Where the held item's model is parented (cleared/refilled by the renderer). */
  contents: THREE.Group;
  /** The slot frame material (dim when empty, brass-lit when filled). */
  rimMat: THREE.MeshStandardMaterial;
}

/**
 * Build one painted item "zone" on the felt: a flat chalk-outlined rectangle
 * (like Buckshot's table) that an item lies inside. Six of these sit in front
 * of each participant.
 */
export function buildItemSlot(): ItemSlot {
  const group = new THREE.Group();
  const S = 0.7; // zone footprint
  const len = 0.16; // corner-tick length
  const bar = 0.035;
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x9a8f78,
    emissive: 0x14110c,
    emissiveIntensity: 0.3,
    roughness: 0.85,
    transparent: true,
    opacity: 0.55,
  });

  // Minimalist: four faint corner ticks (no fill, no full border).
  const h = S / 2;
  const mk = (w: number, d: number, x: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), rimMat);
    m.position.set(x, 0.025, z);
    return m;
  };
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      group.add(mk(len, bar, sx * (h - len / 2), sz * h)); // horizontal tick
      group.add(mk(bar, len, sx * h, sz * (h - len / 2))); // vertical tick
    }
  }

  const contents = new THREE.Group();
  contents.position.y = 0.06;
  contents.scale.setScalar(1.25);
  group.add(contents);

  return { group, contents, rimMat };
}

/** The distinctive little object for each item type, centred at the origin. */
export function buildItemContents(item: ItemType): THREE.Group {
  const g = new THREE.Group();
  const dark = metalMat(PAL.steelDark, 0.5);

  switch (item) {
    case "MAGNIFYING_GLASS": {
      // Lies flat: dark metal rim + glass lens, with a black octagonal handle
      // extending out to one side (matching the reference photo).
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.17, 0.04, 8, 12),
        metalMat(0x3a3a3e, 0.5),
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.set(-0.05, 0.06, -0.05);
      g.add(rim);
      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 0.03, 16),
        new THREE.MeshStandardMaterial({
          color: 0xaeb6bc,
          metalness: 0.2,
          roughness: 0.05,
          transparent: true,
          opacity: 0.45,
        }),
      );
      lens.position.set(-0.05, 0.06, -0.05);
      g.add(lens);
      // Black octagonal handle.
      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.055, 0.42, 8),
        matte(0x111114, 0.55),
      );
      handle.rotation.set(0, 0, Math.PI / 2);
      handle.rotation.y = -0.7;
      handle.position.set(0.22, 0.06, 0.16);
      g.add(handle);
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.06, 8),
        metalMat(0x4a4a50, 0.45),
      );
      collar.rotation.set(0, 0, Math.PI / 2);
      collar.rotation.y = -0.7;
      collar.position.set(0.07, 0.06, 0.04);
      g.add(collar);
      break;
    }
    case "SPEED_LOADER": {
      // A flat star-shaped moon clip: a steel disc with a centre hole and six
      // scalloped cut-outs around the rim (matching the reference).
      const steelClip = metalMat(0x8a8a90, 0.45);
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.26, 0.05, 6),
        steelClip,
      );
      ring.position.y = 0.06;
      g.add(ring);
      // Centre hole (dark) + six rim scallops carved by dark cylinders.
      const hole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 0.08, 16),
        matte(0x0a0a0c, 0.8),
      );
      hole.position.y = 0.08;
      g.add(hole);
      const scallopMat = matte(0x0a0a0c, 0.8);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const s = new THREE.Mesh(
          new THREE.CylinderGeometry(0.075, 0.075, 0.09, 12),
          scallopMat,
        );
        s.position.set(Math.cos(a) * 0.26, 0.08, Math.sin(a) * 0.26);
        g.add(s);
      }
      break;
    }
    case "MEDKIT": {
      // An energy-drink can (the in-fiction "medkit"): a single lathed body
      // with real can geometry — necked base, straight wall, tapered shoulder.
      const can = lathe(
        [
          [0.11, 0.0], // recessed base
          [0.14, 0.015],
          [0.15, 0.05], // base chime
          [0.15, 0.34], // straight wall
          [0.12, 0.42], // shoulder taper
          [0.115, 0.44], // top seam
        ],
        new THREE.MeshStandardMaterial({ color: 0x1b50c0, metalness: 0.5, roughness: 0.35 }),
        22,
      );
      g.add(can);
      // Silver top lid with seam ring and pull-tab.
      const lid = new THREE.Mesh(
        new THREE.CylinderGeometry(0.115, 0.115, 0.015, 20),
        metalMat(0xb8bcc4, 0.3),
      );
      lid.position.y = 0.445;
      g.add(lid);
      const seam = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.008, 6, 20), metalMat(0xb8bcc4, 0.3));
      seam.rotation.x = Math.PI / 2;
      seam.position.y = 0.45;
      g.add(seam);
      const tab = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 12), metalMat(0x989ca4, 0.35));
      tab.rotation.x = Math.PI / 2;
      tab.position.set(0.03, 0.46, 0);
      g.add(tab);
      // White lightning bolt on the side (two angled slivers).
      const boltMat = glow(0xeef2ff, 0.5);
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.02), boltMat);
      b1.position.set(0.02, 0.24, 0.15);
      b1.rotation.z = 0.5;
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.02), boltMat);
      b2.position.set(-0.02, 0.16, 0.15);
      b2.rotation.z = 0.5;
      g.add(b1, b2);
      break;
    }
    case "HANDCUFFS": {
      // Two dark-steel cuff rings joined by a short chain (lying flat).
      const cuffMat = metalMat(0x4a4a4e, 0.45);
      const ring = (): THREE.Mesh =>
        new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 10, 22), cuffMat);
      const a = ring();
      a.rotation.x = Math.PI / 2;
      a.position.set(-0.2, 0.05, 0);
      const b = ring();
      b.rotation.x = Math.PI / 2;
      b.position.set(0.2, 0.05, 0);
      g.add(a, b);
      // Chain links between them.
      const linkGeo = new THREE.TorusGeometry(0.035, 0.014, 8, 14);
      for (let i = 0; i < 3; i++) {
        const link = new THREE.Mesh(linkGeo, dark);
        link.rotation.x = i % 2 === 0 ? Math.PI / 2 : 0;
        link.position.set(-0.07 + i * 0.07, 0.05, 0);
        g.add(link);
      }
      break;
    }
    case "INVERTER": {
      // A dark metal box with a recessed face plate, corner screws and a
      // glowing amber toggle switch (matching the reference).
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.28, 0.3),
        matte(0x1a1a1e, 0.6),
      );
      box.position.y = 0.16;
      g.add(box);
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.2, 0.02),
        matte(0x101013, 0.7),
      );
      plate.position.set(0, 0.18, 0.16);
      g.add(plate);
      // Corner screws.
      const screwMat = metalMat(0x6a6a70, 0.4);
      for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
        const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 6), screwMat);
        sc.rotation.x = Math.PI / 2;
        sc.position.set(sx * 0.1, 0.18 + sy * 0.07, 0.17);
        g.add(sc);
      }
      // Glowing amber ring + hex nut + toggle lever.
      const glowRing = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.018, 8, 20), glow(0xffa028, 2.4));
      glowRing.position.set(0, 0.18, 0.17);
      g.add(glowRing);
      const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 6), metalMat(0x55555c, 0.4));
      nut.rotation.x = Math.PI / 2;
      nut.position.set(0, 0.18, 0.18);
      g.add(nut);
      const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.16, 8), metalMat(0x70707a, 0.35));
      lever.position.set(-0.06, 0.16, 0.24);
      lever.rotation.z = 0.7;
      g.add(lever);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), metalMat(0x80808a, 0.3));
      tip.position.set(-0.12, 0.13, 0.27);
      g.add(tip);
      break;
    }
    case "HOLLOW_POINT": {
      // A small glass vial of dark serum with a worn metal cap — you coat the
      // next round in it for double damage (matching the reference).
      const glassMat = new THREE.MeshStandardMaterial({
        color: 0xcfd6d2,
        metalness: 0.1,
        roughness: 0.05,
        transparent: true,
        opacity: 0.28,
      });
      // One lathed glass profile: rounded base, straight wall, curved
      // shoulder narrowing into the neck.
      const body = lathe(
        [
          [0.06, 0.02],
          [0.095, 0.05],
          [0.1, 0.12],
          [0.1, 0.3], // straight wall
          [0.085, 0.36], // shoulder curve
          [0.06, 0.39],
          [0.055, 0.44], // neck
        ],
        glassMat,
        18,
      );
      g.add(body);
      // Dark serum filling most of the vial.
      const serum = new THREE.Mesh(
        new THREE.CylinderGeometry(0.082, 0.078, 0.24, 16),
        new THREE.MeshStandardMaterial({ color: 0x1a0606, roughness: 0.35 }),
      );
      serum.position.y = 0.17;
      g.add(serum);
      // Worn crimped metal cap with a ribbed skirt.
      const cap = lathe(
        [
          [0.055, 0.43],
          [0.075, 0.44],
          [0.078, 0.5],
          [0.06, 0.52],
          [0.0, 0.525],
        ],
        metalMat(0x6a665e, 0.6),
        14,
      );
      g.add(cap);
      break;
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Blood burst: a reusable pool of particles for a live-round hit
// ---------------------------------------------------------------------------

export interface BloodBurst {
  group: THREE.Group;
  particles: BloodParticle[];
}

export interface BloodParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
}

/**
 * Build a reusable blood-burst emitter: a pool of small dark-red particles,
 * hidden until the renderer triggers a burst by seeding velocities. The renderer
 * advances them under gravity and fades them out.
 */
export function buildBloodBurst(count = 150): BloodBurst {
  const group = new THREE.Group();
  group.visible = false;
  const particles: BloodParticle[] = [];
  // Three droplet sizes: a fine mist, mid spatter, and a few heavy gobs —
  // teardrop-stretched so they read as flying liquid, not confetti.
  const geoSmall = new THREE.SphereGeometry(0.05, 6, 6);
  const geoMid = new THREE.SphereGeometry(0.09, 6, 6);
  const geoBig = new THREE.SphereGeometry(0.14, 8, 6);
  for (let i = 0; i < count; i++) {
    const roll = i % 10;
    const geo = roll < 5 ? geoSmall : roll < 9 ? geoMid : geoBig;
    const mat = new THREE.MeshStandardMaterial({
      // Vary from bright arterial red to near-black venous.
      color: roll % 3 === 0 ? 0x8f0f0f : roll % 3 === 1 ? PAL.blood : 0x3d0505,
      emissive: 0x300000,
      emissiveIntensity: 0.35,
      roughness: 0.25, // wet sheen
      metalness: 0.05,
      transparent: true,
      opacity: 1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // Random teardrop stretch — the renderer's ballistic update keeps it.
    mesh.scale.set(1, 1.3 + Math.random() * 0.9, 1);
    mesh.visible = false;
    group.add(mesh);
    particles.push({ mesh, vel: new THREE.Vector3() });
  }
  return { group, particles };
}

// ---------------------------------------------------------------------------
// Shell token: a standing cartridge (red = live, grey = blank)
// ---------------------------------------------------------------------------

export function buildShell(live: boolean): THREE.Group {
  const g = new THREE.Group();
  const brass = dress(metalMat(PAL.brass, 0.3), "metal", { normalScale: 0.25 });

  // One continuous lathed case profile: base rim -> extraction groove ->
  // straight walls with a slight body taper toward the mouth.
  const casing = lathe(
    [
      [0.11, 0.0], // base centre-out
      [0.15, 0.0], // rim edge
      [0.15, 0.045], // rim top
      [0.125, 0.055], // into extraction groove
      [0.122, 0.075],
      [0.135, 0.09], // out of groove — case wall begins
      [0.132, 0.3],
      [0.128, 0.46], // case mouth
    ],
    brass,
    20,
  );
  g.add(casing);
  // Base head-stamp disc + primer.
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 16), brass);
  head.position.y = 0.006;
  g.add(head);

  if (live) {
    // A copper round-nose bullet seated in the case (the LIVE round) —
    // ogive drawn as a lathe curve, with a seating crimp ring.
    const copper = dress(metalMat(0xb87333, 0.3), "metal", { normalScale: 0.2 });
    const nose = lathe(
      [
        [0.128, 0.46],
        [0.126, 0.52],
        [0.115, 0.6],
        [0.09, 0.67],
        [0.055, 0.72],
        [0.0, 0.745],
      ],
      copper,
      18,
    );
    g.add(nose);
    const crimp = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.008, 6, 18), copper);
    crimp.rotation.x = Math.PI / 2;
    crimp.position.y = 0.47;
    g.add(crimp);
  } else {
    // A blank: dull blue-grey lacquered casing with a star-crimped hollow
    // mouth, so the silhouette reads instantly against warm brass.
    const lacquer = lathe(
      [
        [0.136, 0.09],
        [0.134, 0.3],
        [0.13, 0.42],
        [0.1, 0.5], // crimp taper
        [0.045, 0.545],
      ],
      matte(0x3d4a55, 0.85),
      20,
    );
    g.add(lacquer);
    const mouth = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 0.03, 10),
      matte(0x0c0c09, 0.7),
    );
    mouth.position.y = 0.545;
    g.add(mouth);
    // Star-crimp folds.
    const foldMat = matte(0x2e3942, 0.85);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const fold = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.02), foldMat);
      fold.position.set(Math.cos(a) * 0.07, 0.49, Math.sin(a) * 0.07);
      fold.rotation.y = -a;
      fold.rotation.x = 0.5;
      g.add(fold);
    }
  }

  castReceive(g, true, false);
  return g;
}

// ---------------------------------------------------------------------------
// Street lamp: a tall gooseneck post with a downward lamp head (2nd light)
// ---------------------------------------------------------------------------

export interface MiniLamp {
  group: THREE.Group;
  /** Warm light at the lamp head; flickers / blinks in the renderer. */
  light: THREE.PointLight;
  /** Emissive lamp-lens material. */
  glowMat: THREE.MeshStandardMaterial;
  /** The glowing lens mesh under the head. */
  flame: THREE.Mesh;
  /** World-space offset of the lamp head within the group (for the fly swarm). */
  headOffset: THREE.Vector3;
}

export function buildMiniLamp(): MiniLamp {
  const group = new THREE.Group();
  // Rusted industrial iron — the teal paint flaked off years ago.
  const metal = new THREE.MeshStandardMaterial({
    color: 0x3a3128,
    roughness: 0.6,
    metalness: 0.65,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x241f19,
    roughness: 0.65,
    metalness: 0.65,
  });

  const POST_H = 6.4;

  // Teardrop base (wide bulb at the bottom).
  const baseBulb = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 14), metal);
  baseBulb.scale.set(1, 1.3, 1);
  baseBulb.position.y = 0.6;
  group.add(baseBulb);
  const baseCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 0.3, 14), dark);
  baseCollar.position.y = 1.25;
  group.add(baseCollar);

  // Main post.
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, POST_H, 14), metal);
  post.position.y = 1.4 + POST_H / 2;
  group.add(post);
  // Upper collar where the gooseneck begins.
  const topCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 14), dark);
  topCollar.position.y = 1.4 + POST_H - 0.6;
  group.add(topCollar);

  // Gooseneck: a 180° tube arc bending up and over toward -X.
  const armR = 1.25;
  const armY = 1.4 + POST_H;
  const arc = new THREE.Mesh(
    new THREE.TorusGeometry(armR, 0.15, 10, 24, Math.PI),
    metal,
  );
  // Place the torus so its arc rises from the post top and comes down at -2R.
  arc.position.set(-armR, armY, 0);
  arc.rotation.z = 0; // arc spans the top half by default
  group.add(arc);

  // Lamp head: a downward-facing dome/cone at the end of the gooseneck.
  const headX = -armR * 2;
  const headY = armY - 0.1;
  const headOffset = new THREE.Vector3(headX, headY - 0.45, 0);

  const headTop = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), metal);
  headTop.position.set(headX, headY, 0);
  group.add(headTop);
  const headCone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.5, 16), dark);
  headCone.position.set(headX, headY - 0.2, 0);
  group.add(headCone);

  // Glowing lens underneath the head — a dying sodium amber.
  const glowMat = glow(0xe8cf8f, 2.3);
  const flame = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.16, 16), glowMat);
  flame.position.set(headX, headY - 0.5, 0);
  group.add(flame);

  // A weaker, sicklier hanging light.
  const light = new THREE.PointLight(0xdfc08a, 10, 20, 2);
  light.position.set(headX, headY - 0.6, 0);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = -0.0006;
  group.add(light);

  castReceive(baseBulb, true, true);
  castReceive(post, true, false);
  castReceive(arc, true, false);
  castReceive(headTop, true, false);
  castReceive(headCone, true, false);
  return { group, light, glowMat, flame, headOffset };
}

// ---------------------------------------------------------------------------
// Graveflies: slow drifting glowing motes for atmosphere
// ---------------------------------------------------------------------------

export interface Gravefly {
  mesh: THREE.Mesh;
  /** Orbit/drift parameters baked per fly. */
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  rz: number;
  ry: number;
  speed: number;
  phase: number;
}

export interface Graveflies {
  group: THREE.Group;
  flies: Gravefly[];
}

export function buildGraveflies(count = 18): Graveflies {
  const group = new THREE.Group();
  const flies: Gravefly[] = [];
  const geo = new THREE.SphereGeometry(0.05, 6, 6);
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffd27f,
      emissive: 0xffaa44,
      emissiveIntensity: 2.2,
      transparent: true,
      opacity: 0.85,
    });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
    // A tight swarm clustered around the group origin (placed under the lamp).
    flies.push({
      cx: (Math.random() - 0.5) * 1.4,
      cy: (Math.random() - 0.5) * 1.6,
      cz: (Math.random() - 0.5) * 1.4,
      rx: 0.3 + Math.random() * 0.9,
      rz: 0.3 + Math.random() * 0.9,
      ry: 0.2 + Math.random() * 0.6,
      speed: 0.6 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
      mesh,
    });
  }
  return { group, flies };
}

export interface Briefcase {
  group: THREE.Group;
  lid: THREE.Group;
}

export function buildBriefcase(): Briefcase {
  const group = new THREE.Group();
  
  const caseMat = dress(
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8, metalness: 0.2 }),
    "leather",
    { normalScale: 0.7 },
  );

  // Base: a rounded-corner leather shell instead of a raw box.
  const baseGeo = new THREE.ExtrudeGeometry(roundedRectShape(1.5, 1.5, 0.12), {
    depth: 0.52,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 2,
    curveSegments: 8,
  });
  baseGeo.rotateX(-Math.PI / 2);
  const baseBox = new THREE.Mesh(baseGeo, caseMat);
  baseBox.position.y = 0.56;
  group.add(baseBox);
  // Reinforced corner caps.
  const capMat = metalMat(0x6a5a2e, 0.45);
  for (const [cx, cz] of [[-0.68, -0.68], [0.68, -0.68], [-0.68, 0.68], [0.68, 0.68]] as const) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), capMat);
    cap.scale.set(1, 0.7, 1);
    cap.position.set(cx, 0.1, cz);
    group.add(cap);
  }
  // Side handle.
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 8, 16, Math.PI), caseMat);
  handle.position.set(0, 0.62, 0.79);
  group.add(handle);

  // Brass latches on the front edge + a dark red felt interior well that
  // shows when the lid swings open.
  const latchMat = new THREE.MeshStandardMaterial({
    color: 0xb08d3a,
    metalness: 0.8,
    roughness: 0.35,
  });
  for (const lxOff of [-0.45, 0.45] as const) {
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.06), latchMat);
    latch.position.set(lxOff, 0.5, 0.76);
    group.add(latch);
  }
  const feltWell = new THREE.Mesh(
    new THREE.BoxGeometry(1.34, 0.06, 1.34),
    new THREE.MeshStandardMaterial({ color: 0x4a0e0e, roughness: 0.95 }),
  );
  feltWell.position.y = 0.62;
  group.add(feltWell);
  
  // Lid (Hinged at the back: z = -0.75)
  const lid = new THREE.Group();
  lid.position.set(0, 0.6, -0.75); // Hinge position
  
  const lidBox = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 1.5), caseMat);
  lidBox.position.set(0, 0.15, 0.75); // Offset so hinge is at back
  lid.add(lidBox);
  
  group.add(lid);
  
  castReceive(group, true, true);
  return { group, lid };
}

export function buildRoundBoard(): THREE.Group {
  const group = new THREE.Group();
  
  // 1. The rusted iron plate (base)
  const boardMat = new THREE.MeshStandardMaterial({ 
    color: 0x2a2d31,
    roughness: 0.55, 
    metalness: 0.7
  });
  const board = new THREE.Mesh(new THREE.BoxGeometry(5.0, 1.6, 0.3), boardMat);
  group.add(board);
  
  // 2. The text canvas plane (placed slightly in front of the board)
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#2a2d31';
    ctx.fillRect(0, 0, 1024, 256);
  }
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  
  const textMat = new THREE.MeshStandardMaterial({ 
    map: texture,
    emissiveMap: texture,
    emissive: 0xffffff,
    emissiveIntensity: 0.4,
    transparent: true
  });
  // Aspect ratio is 4:1, so 4.8 x 1.2 fits nicely inside the 5.0 x 1.6 board.
  const textPlane = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.2), textMat);
  textPlane.position.set(0, 0, 0.17); // Slightly in front of the board (+Z) to avoid Z-fighting
  textPlane.userData = { canvas, ctx, texture };
  group.add(textPlane);
  
  // Second text plane on the back
  const textPlane2 = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.2), textMat);
  textPlane2.position.set(0, 0, -0.17); // Slightly behind the board (-Z)
  textPlane2.rotation.y = Math.PI; // Face the enemy
  group.add(textPlane2);
  
  // Chains
  const chainMat = new THREE.MeshStandardMaterial({ 
    color: 0x888888, 
    roughness: 0.6, 
    metalness: 0.8 
  });
  const buildChainLinks = () => {
    const cg = new THREE.Group();
    const torusGeo = new THREE.TorusGeometry(0.12, 0.04, 8, 16);
    // 30 links to make it long enough (10 units tall roughly)
    for (let i = 0; i < 60; i++) {
      const link = new THREE.Mesh(torusGeo, chainMat);
      link.position.set(0, i * 0.18, 0); // 0.18 spacing for interlocking
      link.rotation.y = i % 2 === 0 ? 0 : Math.PI / 2; // Alternate rotation
      link.rotation.x = Math.PI / 2; // Stand vertically
      cg.add(link);
    }
    return cg;
  };
  
  const c1 = buildChainLinks();
  c1.position.set(-2.0, 0.5, 0);
  group.add(c1);
  
  const c2 = buildChainLinks();
  c2.position.set(2.0, 0.5, 0);
  group.add(c2);
  
  castReceive(group, true, true);
  return group;
}

export function updateRoundBoardText(group: THREE.Group, text: string, desc: string): void {
  // textPlane is the second child (index 1)
  const textPlane = group.children[1] as THREE.Mesh;
  if (!textPlane || !textPlane.userData || !textPlane.userData.ctx) return;
  
  const canvas = textPlane.userData.canvas as HTMLCanvasElement;
  const ctx = textPlane.userData.ctx as CanvasRenderingContext2D;
  const texture = textPlane.userData.texture as THREE.CanvasTexture;
  
  // Clear with the iron colour so the text plane blends into the plate
  ctx.fillStyle = '#2a2d31';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Brushed-metal streaks for detail
  ctx.fillStyle = '#1a1d20';
  for (let i = 0; i < 20; i++) {
    ctx.fillRect(0, Math.random() * canvas.height, canvas.width, Math.random() * 5 + 1);
  }

  // Draw scratches/damage (deep gouges)
  ctx.strokeStyle = '#1a0a05'; // Dark, deep color
  ctx.lineCap = 'round';
  for (let i = 0; i < 15; i++) {
    ctx.lineWidth = Math.random() * 4 + 1;
    ctx.beginPath();
    let startX = Math.random() * canvas.width;
    let startY = Math.random() * canvas.height;
    ctx.moveTo(startX, startY);
    // Scratches are usually somewhat straight but jagged
    ctx.lineTo(startX + (Math.random() - 0.5) * 200, startY + (Math.random() - 0.5) * 100);
    ctx.stroke();
  }

  // Draw blood splatters
  for (let i = 0; i < 40; i++) {
    // Random position, heavily weighted towards edges
    let bx = Math.random() > 0.5 ? Math.random() * 300 : canvas.width - Math.random() * 300;
    let by = Math.random() > 0.5 ? Math.random() * 100 : canvas.height - Math.random() * 100;
    
    // Sometimes put blood right in the middle
    if (Math.random() > 0.8) {
      bx = Math.random() * canvas.width;
      by = Math.random() * canvas.height;
    }

    ctx.fillStyle = `rgba(100, 0, 0, ${Math.random() * 0.7 + 0.3})`; // Dark dried blood
    ctx.beginPath();
    ctx.arc(bx, by, Math.random() * 15 + 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Add small satellite splatters around the main one
    for (let j = 0; j < 3; j++) {
      ctx.beginPath();
      ctx.arc(bx + (Math.random() - 0.5) * 40, by + (Math.random() - 0.5) * 40, Math.random() * 5 + 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  // Draw main text
  ctx.fillStyle = '#d9cdb4'; // Chalk color
  ctx.font = 'bold 90px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Add slight shadow
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;
  
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 - 20);

  // Draw sub text (desc)
  ctx.fillStyle = '#9a3b33'; // Reddish chalk
  ctx.font = 'bold 36px "Courier New", monospace';
  ctx.fillText(desc, canvas.width / 2, canvas.height / 2 + 50);
  
  texture.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Betting chip: a round poker-chip-style disc with a revolver engraving
// ---------------------------------------------------------------------------

export interface BetChip {
  group: THREE.Group;
  value: number;
}

export function buildBetChip(value: number): BetChip {
  const group = new THREE.Group();

  // A heavy, aged brass coin with a reeded (ridged) edge and a raised
  // revolver relief pressed into a recessed inner face.
  const brass = new THREE.MeshStandardMaterial({
    color: 0xb08d3a,
    metalness: 0.75,
    roughness: 0.35,
  });
  const brassLight = new THREE.MeshStandardMaterial({
    color: 0xc9a04a,
    metalness: 0.7,
    roughness: 0.3,
  });
  const brassDark = new THREE.MeshStandardMaterial({
    color: 0x7a5a1e,
    metalness: 0.65,
    roughness: 0.45,
  });

  const coinH = 0.08; // thick coin
  const R = 0.28; // coin radius
  const count = value >= 10000 ? 8 : value >= 1000 ? 4 : 1;

  // Shared geometry across the stack — one disc + one reeded edge ring.
  dress(brass, "metal", { normalScale: 0.3 });
  const discGeo = new THREE.CylinderGeometry(R, R, coinH, 40);
  // Reeded edge as a single ridged ring: a scaled torus with high radial
  // segment count reads as milling under the normal map (vs 28 box meshes).
  const edgeGeo = new THREE.TorusGeometry(R - 0.005, coinH * 0.42, 6, 48);
  for (let i = 0; i < count; i++) {
    const y = i * coinH;
    const disc = new THREE.Mesh(discGeo, brass);
    disc.position.y = y + coinH / 2;
    group.add(disc);
    const edge = new THREE.Mesh(edgeGeo, brassDark);
    edge.rotation.x = Math.PI / 2;
    edge.scale.z = 0.9;
    edge.position.y = y + coinH / 2;
    group.add(edge);
    // Raised rim border on the top face.
    const rimTop = new THREE.Mesh(new THREE.TorusGeometry(R - 0.03, 0.018, 6, 32), brassLight);
    rimTop.rotation.x = Math.PI / 2;
    rimTop.position.y = y + coinH;
    group.add(rimTop);
  }

  // Top face: a recessed inner circle with the revolver relief.
  const topY = count * coinH;
  const recess = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.78, R * 0.78, 0.015, 28), brassDark);
  recess.position.y = topY + 0.005;
  group.add(recess);
  // Inner rim ring.
  const innerRim = new THREE.Mesh(new THREE.TorusGeometry(R * 0.78, 0.014, 6, 28), brassLight);
  innerRim.rotation.x = Math.PI / 2;
  innerRim.position.y = topY + 0.015;
  group.add(innerRim);

  // Revolver relief (raised on the recessed face).
  const relief = brassLight;
  const rY = topY + 0.018;
  // Frame/body block.
  const frame = new THREE.Mesh(new THREE.BoxGeometry(R * 0.35, 0.015, R * 0.22), relief);
  frame.position.set(0, rY, 0);
  group.add(frame);
  // Barrel (long, extending right).
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, R * 0.55, 10), relief);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(R * 0.32, rY, -0.01);
  group.add(barrel);
  // Cylinder drum (round, prominent).
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.18, R * 0.18, 0.02, 14), relief);
  drum.position.set(-R * 0.02, rY + 0.005, 0);
  group.add(drum);
  // Grip (angled down-right from frame).
  const gripBlock = new THREE.Mesh(new THREE.BoxGeometry(R * 0.18, 0.015, R * 0.35), relief);
  gripBlock.position.set(-R * 0.12, rY, R * 0.22);
  gripBlock.rotation.y = 0.2;
  group.add(gripBlock);
  // Trigger guard arc.
  const guard = new THREE.Mesh(new THREE.TorusGeometry(R * 0.1, 0.014, 6, 12, Math.PI), relief);
  guard.rotation.x = Math.PI / 2;
  guard.position.set(R * 0.02, rY, R * 0.1);
  group.add(guard);
  // Hammer spur (small nub at back-top).
  const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.03), relief);
  hammer.position.set(-R * 0.18, rY + 0.01, -R * 0.08);
  group.add(hammer);

  castReceive(group, true, false);
  return { group, value };
}
