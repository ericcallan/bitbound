import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { eraMaterial, PATTERN } from './eraMaterial';
import { eras as E, type EraSwapRegistry } from './eraSwap';
import { M } from './decor';
import type { Game } from '../sim/Game';
import { ASSEMBLE_TIME } from '../puzzle/BrokenPassage';
import { STAIR, stairStep } from '../level/meadows';
import { clamp, easeInOutCubic, easeOutBack, lerp, rng, smoothstep } from '../math';

const glow = (color: string, intensity = 2) =>
  eraMaterial({ color: new THREE.Color(color).multiplyScalar(0.35).getStyle(), emissive: color, emissiveIntensity: intensity, roughness: 0.3 });

/** Everything that moves or reacts: bits, glitchlings, artifacts, puzzle pieces, bridge, beacon. */
export class EntityViews {
  group = new THREE.Group();
  private bits: { obj: THREE.Group; id: string; base: THREE.Vector3 }[] = [];
  private enemies: { obj: THREE.Group; body: THREE.Group; slices: THREE.Mesh[] }[] = [];
  private shard = new THREE.Group();
  private shardRings: THREE.Mesh[] = [];
  private device = new THREE.Group();
  private deviceRing!: THREE.Mesh;
  private deviceCore!: THREE.Mesh;
  private deviceMat = glow('#2fd6c3', 2.5);
  private cube = new THREE.Group();
  private cubeEdgeMat = glow('#2fd6c3', 2.2);
  private plate = new THREE.Group();
  private plateTop!: THREE.Mesh;
  private plateRingMat = glow('#2fd6c3', 0.6);
  private glyph = new THREE.Group();
  private glyphMat = glow('#b388ff', 1.2);
  private conduitSegs: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; at: number }[] = [];
  private planks: { mesh: THREE.Group; fallen: THREE.Vector3; fallenRot: THREE.Euler; place: THREE.Vector3; delay: number; landed: boolean }[] = [];
  private rails = new THREE.Group();
  private checkpoints: { id: string; obj: THREE.Group; crystalMat: THREE.MeshStandardMaterial; crystal: THREE.Mesh }[] = [];
  private beaconColumn!: THREE.Mesh;
  private beaconRings: THREE.Mesh[] = [];
  private beam!: THREE.Mesh;
  private movers: THREE.Group[] = [];
  private lamp = new THREE.Group();
  private lampCoreMat = glow('#ffd36b', 1.2);
  private lampBeam!: THREE.Mesh;
  private socketMat = glow('#ffd36b', 0.5);
  private lampGlyph = new THREE.Group();
  /** A twinkle above the lamp so it can be spotted (it sits behind the alcove wall in 2D). */
  private lampGlint!: THREE.Sprite;
  /** Where the lantern goes: a soft column of light until it's docked. */
  private socketColumn!: THREE.Mesh;
  private stairPaint: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; missing: boolean; i: number }[] = [];
  private gate = new THREE.Group();
  private gateRings: THREE.Mesh[] = [];
  private gateFieldMat!: THREE.MeshBasicMaterial;
  private gateFrame!: THREE.Mesh;
  /** Emitted when a bridge plank locks into place (for sparks). */
  onPlankLand?: (p: THREE.Vector3) => void;

  constructor(
    private game: Game,
    eras: EraSwapRegistry,
  ) {
    const L = game.level;
    // --- Bits: chunky pixels in 8-bit, faceted gems later.
    const bit8Mat = glow('#ffd36b', 1.6);
    const bitMat = glow('#6ff6ff', 1.9);
    const bitCore = glow('#fff4d6', 2.5);
    for (const b of game.bits) {
      const g = new THREE.Group();
      g.position.set(b.pos.x, b.pos.y, b.pos.z);
      const c8 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), bit8Mat);
      const gem = new THREE.Group();
      const o = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), bitMat);
      o.scale.y = 1.35;
      const inner = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), bitCore);
      gem.add(o, inner);
      eras.variants(g, [[c8, E(0)], [gem, E(1, 5)]], g.position.clone(), false);
      this.group.add(g);
      this.bits.push({ obj: g, id: b.id, base: g.position.clone() });
    }

    // --- Glitchlings
    const bodyMat = eraMaterial({ color: '#2b2d6e', roughness: 0.5 });
    const glitchMats = [glow('#ff4fd8', 1.6), glow('#2fd6c3', 1.6)];
    for (const e of game.enemies) {
      const g = new THREE.Group();
      const body = new THREE.Group();
      const core = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.56, 0.62, 2, 0.1), bodyMat);
      core.position.y = 0.32;
      body.add(core);
      for (const x of [-0.15, 0.15]) {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.05), M.white());
        eye.position.set(x, 0.38, 0.32);
        const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.03), M.ink());
        pupil.position.set(x + 0.03, 0.36, 0.35);
        body.add(eye, pupil);
      }
      for (const x of [-0.22, 0.22]) {
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.28), M.ink());
        foot.position.set(x, 0.04, 0.02);
        body.add(foot);
      }
      const antenna = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.06), glitchMats[0]);
      antenna.position.set(0, 0.68, 0);
      body.add(antenna);
      const slices: THREE.Mesh[] = [];
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.06, 0.64), glitchMats[i % 2]);
        s.position.y = 0.18 + i * 0.16;
        body.add(s);
        slices.push(s);
      }
      body.traverse((o) => (o.castShadow = true));
      g.add(body);
      this.group.add(g);
      this.enemies.push({ obj: g, body, slices });
    }

    // --- Generation Shard
    this.shard.position.set(L.shard.x, L.shard.y, L.shard.z);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), glow('#fff4d6', 2.6));
    crystal.scale.set(0.8, 1.6, 0.8);
    this.shard.add(crystal);
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55 + i * 0.15, 0.03, 6, 32), glow(i ? '#8e5bd6' : '#2fd6c3', 2));
      this.shard.add(ring);
      this.shardRings.push(ring);
    }
    this.group.add(this.shard);

    // --- Dimension Device on its pedestal
    this.device.position.set(L.device.x, L.device.y + 0.55, L.device.z);
    this.deviceRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 6, 28), M.metal());
    this.deviceCore = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.34, 0.34, 2, 0.06), this.deviceMat);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 4, 4), this.deviceMat);
    frame.rotation.z = Math.PI / 4;
    this.device.add(this.deviceRing, this.deviceCore, frame);
    this.group.add(this.device);

    // --- The pushable cube: ancient stone with glowing seams
    const cubeStone = eraMaterial({ color: '#b9b1c9', pattern: PATTERN.stone, roughness: 0.75 });
    const h = L.cubeHalf;
    const cb = new THREE.Mesh(new RoundedBoxGeometry(h * 2, h * 2, h * 2, 2, 0.06), cubeStone);
    cb.position.y = h;
    cb.castShadow = cb.receiveShadow = true;
    this.cube.add(cb);
    const e = h * 2 + 0.02;
    for (const [sx, sy, sz] of [[e, 0.06, 0.06], [0.06, e, 0.06], [0.06, 0.06, e]] as const) {
      for (const a of [-1, 1])
        for (const b2 of [-1, 1]) {
          const edge = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), this.cubeEdgeMat);
          if (sx > 1) edge.position.set(0, h + a * h, b2 * h);
          else if (sy > 1) edge.position.set(a * h, h, b2 * h);
          else edge.position.set(a * h, h + b2 * h, 0);
          this.cube.add(edge);
        }
    }
    for (const [x, z, ry] of [[0, h + 0.011, 0], [0, -h - 0.011, Math.PI], [h + 0.011, 0, Math.PI / 2], [-h - 0.011, 0, -Math.PI / 2]] as const) {
      const g2 = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.26, 4), this.cubeEdgeMat);
      g2.position.set(x, h, z);
      g2.rotation.y = ry;
      this.cube.add(g2);
    }
    this.group.add(this.cube);

    // --- Pressure plate
    this.plate.position.set(L.plate.x, L.plate.y, L.plate.z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.12, 24), M.ruinDark());
    base.position.y = 0.04;
    this.plateTop = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.75, 0.12, 24), M.stone());
    this.plateTop.position.y = 0.12;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.84, 0.05, 6, 32), this.plateRingMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.11;
    this.plate.add(base, this.plateTop, ring);
    this.group.add(this.plate);

    // --- Reset glyph
    this.glyph.position.set(L.resetGlyph.x, 0.02, L.resetGlyph.z);
    const gr = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 6), this.glyphMat);
    gr.rotation.x = -Math.PI / 2;
    const arrow = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.3, 3), this.glyphMat);
    arrow.rotation.x = -Math.PI / 2;
    this.glyph.add(gr, arrow);
    this.group.add(this.glyph);

    // --- Conduit from plate to bridge: lights up along its length when activated.
    const pts = L.conduit;
    let acc = 0;
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.ceil(len / 0.5);
      for (let k = 0; k < n; k++) {
        const t0 = k / n;
        const mat = glow('#2fd6c3', 0.15);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.16), mat);
        seg.position.set(lerp(a.x, b.x, t0 + 0.5 / n), 0.025, lerp(a.z, b.z, t0 + 0.5 / n));
        seg.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
        this.group.add(seg);
        this.conduitSegs.push({ mesh: seg, mat, at: (acc + (k + 0.5) * (len / n)) / total });
      }
      acc += len;
    }

    // --- Bridge planks (stubs are part of the solid geometry)
    const r = rng(5);
    const plankMat = eraMaterial({ color: '#b07a45', pattern: PATTERN.wood });
    const bandMat = M.ruinDark();
    const { x0, plankCount } = L.bridge;
    for (let i = 1; i < plankCount - 1; i++) {
      const g = new THREE.Group();
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.42, 1.6), plankMat);
      p.castShadow = p.receiveShadow = true;
      g.add(p);
      for (const z of [-0.6, 0.6]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.44, 0.1), bandMat);
        band.position.z = z;
        g.add(band);
      }
      const rune = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.08), this.cubeEdgeMat);
      rune.position.y = 0.22;
      g.add(rune);
      const place = new THREE.Vector3(x0 + i + 0.5, -0.21, 0);
      const fallen = new THREE.Vector3(x0 + 1 + r() * 8, -7.7 + r() * 0.4, -1 + r() * 2);
      const fallenRot = new THREE.Euler((r() - 0.5) * 1.2, r() * 3, (r() - 0.5) * 1.4);
      this.planks.push({ mesh: g, fallen, fallenRot, place, delay: 0.25 + (i - 1) * 0.24, landed: false });
      this.group.add(g);
    }
    // posts + rails
    const postMat = M.wood();
    for (const x of [x0 + 0.3, x0 + plankCount - 0.3]) {
      for (const z of [-0.75, 0.75]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.0, 0.16), postMat);
        post.position.set(x, 0.5, z);
        post.castShadow = true;
        this.group.add(post);
      }
    }
    for (const z of [-0.75, 0.75]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, plankCount - 0.6, 6), glow('#d9b07a', 0.25));
      rail.rotation.z = Math.PI / 2;
      rail.position.set(x0 + plankCount / 2, 0.85, z);
      this.rails.add(rail);
    }
    this.group.add(this.rails);

    // --- Checkpoints
    for (const cp of L.checkpoints) {
      // The start is where Pip appears: no marker there. The rest stand behind the path, so a respawning
      // Pip is never hidden behind one.
      if (cp.id === 'start') continue;
      const g = new THREE.Group();
      g.position.set(cp.pos.x, cp.pos.y, -1.6);
      const big = cp.id === 'beacon';
      const ped = new THREE.Mesh(new RoundedBoxGeometry(big ? 1.2 : 0.6, big ? 0.8 : 0.5, big ? 1.2 : 0.6, 2, 0.06), M.ruin());
      ped.position.y = big ? 0.4 : 0.25;
      ped.castShadow = true;
      const crystalMat = glow('#8e5bd6', 0.3);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(big ? 0.45 : 0.2, 0), crystalMat);
      crystal.scale.y = 1.6;
      crystal.position.y = big ? 1.6 : 0.8;
      g.add(ped, crystal);
      if (big) {
        g.position.z = -1.6;
        this.beaconColumn = new THREE.Mesh(
          new THREE.CylinderGeometry(0.5, 0.9, 40, 20, 1, true),
          new THREE.MeshBasicMaterial({ color: '#6ff6ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
        );
        this.beaconColumn.position.y = 20;
        g.add(this.beaconColumn);
        for (let i = 0; i < 3; i++) {
          const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.9 + i * 0.3, 0.04, 6, 32), glow(['#2fd6c3', '#ffcf6b', '#8e5bd6'][i], 2));
          ringM.position.y = 1.6;
          ringM.visible = false;
          g.add(ringM);
          this.beaconRings.push(ringM);
        }
      }
      this.group.add(g);
      this.checkpoints.push({ id: cp.id, obj: g, crystalMat, crystal });
    }

    this.buildMovers();
    this.buildAct2();

    // --- Awakening beam from the machine's eye to the pixel
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 1, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: '#9ffff4', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.group.add(this.beam);
  }

  /** Moving stone platforms with a glowing teal underside. */
  private buildMovers() {
    const top = eraMaterial({ color: '#cdbd9c', pattern: PATTERN.stone, roughness: 0.6 });
    const under = glow('#2fd6c3', 1.6);
    for (const m of this.game.movers) {
      const c = m.collider;
      const w = c.max.x - c.min.x;
      const d = c.max.z - c.min.z;
      const h = c.max.y - c.min.y;
      const g = new THREE.Group();
      const slab = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.06), top);
      slab.castShadow = slab.receiveShadow = true;
      const rim = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.06, d * 0.8), under);
      rim.position.y = -h / 2 - 0.02;
      const thruster = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 6), under);
      thruster.rotation.x = Math.PI;
      thruster.position.y = -h / 2 - 0.25;
      g.add(slab, rim, thruster);
      this.group.add(g);
      this.movers.push(g);
    }
  }

  /** Act 2: the lamp, its socket, the painted stair, and the Frame Gate. */
  private buildAct2() {
    const L = this.game.level;
    // Lamp: an iron-and-stone lantern on a plinth — open sides, a bright glowing core, a pointed roof.
    const h = L.lampHalf;
    const stone = eraMaterial({ color: '#c4b59c', pattern: PATTERN.ruin, roughness: 0.8 });
    const iron = eraMaterial({ color: '#3a3448', roughness: 0.4, metalness: 0.7 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(h * 2, 0.24, h * 2, 2, 0.06), stone);
    body.position.y = 0.12;
    body.castShadow = body.receiveShadow = true;
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.86, 0.12), iron);
      post.position.set(px * (h - 0.08), 0.24 + 0.43, pz * (h - 0.08));
      post.castShadow = true;
      this.lamp.add(post);
    }
    // the glowing heart: a glass box with a flame inside
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.7, 0.78), new THREE.MeshStandardMaterial({ color: '#fff1c8', emissive: '#ffcf6b', emissiveIntensity: 0.6, transparent: true, opacity: 0.35, roughness: 0.1 }));
    glass.position.y = 0.66;
    const flame = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), this.lampCoreMat);
    flame.position.y = 0.62;
    flame.scale.y = 1.5;
    this.lamp.add(glass, flame);
    const lampLight = new THREE.PointLight('#ffcf6b', 4, 6, 1.6);
    lampLight.position.y = 0.7;
    this.lamp.add(lampLight);
    // lens on the side that faces the mural: this is where the beam comes out
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.14, 16), this.lampCoreMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.66, -h - 0.02);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.82, 0.5, 4), M.ruinDark());
    cap.position.y = 1.1 + 0.25;
    cap.rotation.y = Math.PI / 4;
    cap.castShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 8, 16), iron);
    ring.position.y = 1.68;
    this.lamp.add(body, lens, cap, ring);
    this.group.add(this.lamp);
    const gc = document.createElement('canvas');
    gc.width = gc.height = 64;
    const gx = gc.getContext('2d')!;
    const grad = gx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,248,220,1)');
    grad.addColorStop(0.25, 'rgba(255,211,107,0.6)');
    grad.addColorStop(1, 'rgba(255,211,107,0)');
    gx.fillStyle = grad;
    gx.fillRect(0, 0, 64, 64);
    gx.fillStyle = '#fff8dc';
    gx.fillRect(30, 2, 4, 60);
    gx.fillRect(2, 30, 60, 4);
    const gt = new THREE.CanvasTexture(gc);
    this.lampGlint = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.lampGlint.renderOrder = 5;
    this.group.add(this.lampGlint);
    // Beam toward the mural, visible once docked.
    this.lampBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.9, 1, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffe3a0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.group.add(this.lampBeam);
    // Socket
    const sock = new THREE.Group();
    sock.position.set(L.lampSocket.x, 0.02, L.lampSocket.z);
    const sRing = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.9, 4), this.socketMat);
    sRing.rotation.x = -Math.PI / 2;
    sRing.rotation.z = Math.PI / 4;
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 3), this.socketMat);
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(0, 0.02, -1.1);
    sock.add(sRing, arrow);
    this.group.add(sock);
    this.socketColumn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.75, 3.2, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffd36b', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.socketColumn.position.set(L.lampSocket.x, 1.6, L.lampSocket.z);
    this.group.add(this.socketColumn);
    // Reset glyph for the lamp
    this.lampGlyph.position.set(L.lampGlyph.x, 0.02, L.lampGlyph.z);
    const gr = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 6), this.glyphMat);
    gr.rotation.x = -Math.PI / 2;
    this.lampGlyph.add(gr);
    this.group.add(this.lampGlyph);
    // Painted steps on the mural (decals). Missing ones fade in as the lamp repaints them.
    const z = STAIR.wall.z1 + 0.02;
    for (let i = 0; i < STAIR.count; i++) {
      const s = stairStep(i);
      const missing = STAIR.missing.includes(i);
      const mat = eraMaterial({
        color: i % 2 ? '#f0862a' : '#ffcf6b',
        emissive: '#ffcf6b',
        emissiveIntensity: 0.15,
        roughness: 0.9,
        transparent: true,
        opacity: missing ? 0.15 : 1,
      });
      const step = new THREE.Mesh(new THREE.PlaneGeometry(s.x1 - s.x0, s.top - s.bottom + 0.12), mat);
      step.position.set((s.x0 + s.x1) / 2, (s.top + s.bottom) / 2, z);
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(s.x1 - s.x0, 0.06), glow('#fff4d6', 0.6));
      edge.position.set(0, (s.top - s.bottom + 0.12) / 2, 0.005);
      step.add(edge);
      this.group.add(step);
      this.stairPaint.push({ mesh: step, mat, missing, i });
    }
    // The Frame Gate: a miniature of the Frame Engine on the plateau.
    this.gate.position.set(L.gate.x, L.gate.y, -0.9);
    const ringMat = eraMaterial({ color: '#4b4566', metalness: 0.7, roughness: 0.3, pattern: PATTERN.metal });
    const outer = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.22, 10, 48), ringMat);
    outer.position.y = 2.1;
    const frame = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.1, 4, 4), ringMat);
    frame.position.y = 2.1;
    frame.rotation.z = Math.PI / 4;
    this.gateFrame = frame;
    const base = new THREE.Mesh(new RoundedBoxGeometry(3.2, 0.4, 1.2, 2, 0.08), M.ruinDark());
    base.position.y = 0.2;
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new RoundedBoxGeometry(0.45, 1.2, 0.6, 2, 0.08), M.ruin());
      leg.position.set(sx * 1.55, 0.6, 0);
      this.gate.add(leg);
    }
    this.gateFieldMat = new THREE.MeshBasicMaterial({ color: '#6ff6ff', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const field = new THREE.Mesh(new THREE.CircleGeometry(1.7, 48), this.gateFieldMat);
    field.position.y = 2.1;
    this.gate.add(outer, frame, base, field);
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(2.3 + i * 0.35, 0.03, 4, 64), glow(['#6ff6ff', '#8e5bd6', '#ffcf6b'][i], 2.2));
      r.position.y = 2.1;
      this.gate.add(r);
      this.gateRings.push(r);
    }
    this.gate.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
    this.group.add(this.gate);
  }

  update(t: number, dt: number) {
    const g = this.game;
    const a = g.alpha;
    // bits
    for (const b of this.bits) {
      const bit = g.bits.find((x) => x.id === b.id)!;
      b.obj.visible = !bit.collected;
      b.obj.position.y = b.base.y + Math.sin(t * 3 + b.base.x) * 0.08;
      b.obj.rotation.y = t * 2.2 + b.base.x;
    }
    // enemies
    g.enemies.forEach((e, i) => {
      const v = this.enemies[i];
      const x = lerp(e.prevPos.x, e.pos.x, a);
      v.obj.position.set(x, e.pos.y, e.pos.z);
      v.obj.rotation.y = e.dir > 0 ? 0.5 : -0.5;
      if (!e.alive) {
        v.body.scale.set(1 + e.squash * 0.6, Math.max(0.05, 1 - e.squash), 1 + e.squash * 0.6);
        v.obj.visible = e.squash < 0.99;
      } else {
        const hop = Math.abs(Math.sin(t * 9 + i));
        v.body.position.y = hop * 0.08;
        v.body.scale.set(1 + (1 - hop) * 0.06, 1 - (1 - hop) * 0.08, 1);
        // glitch slices jitter sideways like a broken scanline
        const glitchy = Math.sin(t * 13 + i * 7) > 0.6;
        v.slices.forEach((s, k) => {
          s.position.x = glitchy ? Math.sin(t * 90 + k * 3) * 0.12 : 0;
          s.visible = glitchy || k === 1;
        });
      }
    });
    // shard
    this.shard.visible = !g.save.shardTaken;
    this.shard.rotation.y = t * 1.5;
    this.shard.position.y = g.level.shard.y + Math.sin(t * 2) * 0.12;
    this.shardRings.forEach((r, i) => {
      r.rotation.x = t * (1.2 + i * 0.7);
      r.rotation.y = t * (0.8 - i * 0.5);
    });
    // device
    const unlocked = g.shift.unlocked;
    this.deviceRing.rotation.x = t * (unlocked ? 0.4 : 1.6);
    this.deviceRing.rotation.y = t * (unlocked ? 0.3 : 1.1);
    this.deviceCore.rotation.set(t * 0.7, t, 0);
    this.device.position.y = g.level.device.y + 0.55 + Math.sin(t * 2.4) * 0.06;
    this.deviceMat.emissiveIntensity = unlocked ? 0.6 : 2.2 + Math.sin(t * 6) * 0.8;
    // cube & plate
    const c = g.puzzle.cubeCenter;
    this.cube.position.set(c.x, c.y, c.z);
    const latched = g.puzzle.plateLatched;
    this.cubeEdgeMat.emissiveIntensity = latched ? 2.6 + Math.sin(t * 4) * 0.5 : 1.2 + Math.sin(t * 2) * 0.3;
    this.plateTop.position.y = 0.12 - g.puzzle.plateDepress * 0.07;
    this.plateRingMat.emissiveIntensity = latched ? 2.8 : 0.5 + Math.sin(t * 3) * 0.35;
    this.glyph.visible = !latched;
    this.glyph.rotation.y = t * 0.5;
    this.glyphMat.emissiveIntensity = 0.8 + Math.sin(t * 3) * 0.4;
    // conduit + bridge assembly
    const st = g.puzzle.state;
    const pt = st === 'repaired' ? ASSEMBLE_TIME + 10 : st === 'assembling' ? g.puzzle.t : -1;
    for (const s of this.conduitSegs) {
      const on = pt >= 0 && pt / 0.7 > s.at;
      s.mat.emissiveIntensity = on ? 2.4 + Math.sin(t * 8 - s.at * 20) * 0.6 : 0.15;
    }
    for (const p of this.planks) {
      const k = pt < 0 ? 0 : clamp((pt - p.delay) / 0.85, 0, 1);
      const e = easeInOutCubic(k);
      const arc = Math.sin(k * Math.PI) * 2.5;
      p.mesh.position.set(lerp(p.fallen.x, p.place.x, e), lerp(p.fallen.y, p.place.y, easeOutBack(k, 1.2)) + arc, lerp(p.fallen.z, p.place.z, e));
      p.mesh.rotation.set(p.fallenRot.x * (1 - e), p.fallenRot.y * (1 - e), p.fallenRot.z * (1 - e) + k * (1 - k) * 4);
      if (k >= 1 && !p.landed) {
        p.landed = true;
        if (pt < ASSEMBLE_TIME + 5) this.onPlankLand?.(p.place);
      }
      if (k < 1) p.landed = false;
    }
    this.rails.visible = st === 'repaired';
    // checkpoints
    for (const cp of this.checkpoints) {
      const on = g.activeCheckpoints.has(cp.id);
      cp.crystalMat.emissive.set(on ? '#6ff6ff' : '#8e5bd6');
      cp.crystalMat.emissiveIntensity = on ? 2.4 + Math.sin(t * 3) * 0.4 : 0.35;
      cp.crystal.rotation.y = t * (on ? 1.5 : 0.3);
      cp.crystal.position.y = (cp.id === 'beacon' ? 1.6 : 0.8) + (on ? Math.sin(t * 2) * 0.08 : 0);
    }
    const beaconOn = g.activeCheckpoints.has('beacon');
    const bm = this.beaconColumn.material as THREE.MeshBasicMaterial;
    bm.opacity += ((beaconOn ? 0.28 : 0) - bm.opacity) * Math.min(1, dt * 2);
    this.beaconRings.forEach((r, i) => {
      r.visible = beaconOn;
      r.rotation.x = Math.PI / 2 + Math.sin(t + i) * 0.4;
      r.rotation.y = t * (0.6 + i * 0.4);
      r.position.y = 1.6 + Math.sin(t * 1.5 + i * 2) * 0.5;
    });
    // movers
    g.movers.forEach((m, i) => {
      const c = m.collider;
      const x = lerp(m.prevX, m.centerX, a);
      this.movers[i].position.set(x, (c.min.y + c.max.y) / 2, (c.min.z + c.max.z) / 2);
    });
    // lamp + stair
    const stair = g.stair;
    const lc = stair.lampCenter;
    this.lamp.position.set(lc.x, lc.y, lc.z);
    this.lampGlint.visible = !stair.latched;
    this.socketColumn.visible = !stair.latched && this.game.shift.mode === '3d';
    (this.socketColumn.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.08 * Math.sin(t * 2.4);
    if (this.lampGlint.visible) {
      const k = 0.6 + 0.5 * Math.max(0, Math.sin(t * 2.6));
      this.lampGlint.position.set(lc.x, lc.y + 2.3 + Math.sin(t * 1.3) * 0.08, lc.z);
      this.lampGlint.scale.setScalar(1.1 * k);
      this.lampGlint.material.rotation = t * 0.4;
    }
    this.lampCoreMat.emissiveIntensity = stair.latched ? 3.2 + Math.sin(t * 5) * 0.4 : 2 + Math.sin(t * 2) * 0.4;
    this.socketMat.emissiveIntensity = 0.4 + stair.socketGlow * 2.4;
    this.lampGlyph.visible = !stair.latched;
    this.lampGlyph.rotation.y = t * 0.5;
    const beamMat = this.lampBeam.material as THREE.MeshBasicMaterial;
    const beamOnL = stair.latched;
    beamMat.opacity += ((beamOnL ? 0.22 + (stair.state === 'painting' ? 0.25 : 0) : 0) - beamMat.opacity) * Math.min(1, dt * 4);
    this.lampBeam.visible = beamMat.opacity > 0.01;
    if (this.lampBeam.visible) {
      const from = new THREE.Vector3(lc.x, lc.y + g.level.lampHalf, lc.z - g.level.lampHalf);
      const to = new THREE.Vector3(lc.x, 4.6, STAIR.wall.z1 + 0.05);
      this.lampBeam.position.copy(from).add(to).multiplyScalar(0.5);
      this.lampBeam.scale.set(1, from.distanceTo(to), 1);
      this.lampBeam.lookAt(to);
      this.lampBeam.rotateX(-Math.PI / 2);
    }
    const paint = stair.paint;
    for (const sp of this.stairPaint) {
      if (sp.missing) {
        const k = clamp(paint * 1.6 - (sp.i - STAIR.missing[0]) * 0.4, 0, 1);
        sp.mat.opacity = 0.15 + 0.85 * k;
        sp.mat.emissiveIntensity = 0.15 + (k > 0 && k < 1 ? 1.4 : 0);
      }
      // painted steps glow faintly while the world is flat — that's when they're solid
      sp.mat.emissive.setScalar(1);
      sp.mat.emissive.set('#ffcf6b');
      if (!sp.missing || paint >= 1) sp.mat.emissiveIntensity = g.shift.mode === '2d' ? 0.35 + Math.sin(t * 2 + sp.i) * 0.1 : 0.08;
    }
    // frame gate
    const gg = g.gateGlow;
    this.gateFieldMat.opacity = 0.12 + gg * 0.45 + Math.sin(t * 3) * 0.05;
    this.gateRings.forEach((r, i) => {
      r.rotation.x = t * (0.6 + i * 0.3);
      r.rotation.y = t * (0.4 - i * 0.25);
      r.scale.setScalar(0.85 + gg * 0.25);
    });
    this.gateFrame.rotation.z += dt * (0.4 + gg);

    // awakening beam
    const beamOn = g.cine?.name === 'awakening' && g.machineEye > 0.9 && g.assemble < 1;
    const bmat = this.beam.material as THREE.MeshBasicMaterial;
    bmat.opacity += ((beamOn ? 0.85 : 0) - bmat.opacity) * Math.min(1, dt * 8);
    if (bmat.opacity > 0.01) {
      const from = new THREE.Vector3(g.level.awakeningMachine.x, 1.75, g.level.awakeningMachine.z + 0.45);
      const to = new THREE.Vector3(g.player.pos.x, 0.45, g.player.pos.z);
      const mid = from.clone().add(to).multiplyScalar(0.5);
      this.beam.position.copy(mid);
      this.beam.scale.set(1 + Math.sin(t * 40) * 0.3, from.distanceTo(to), 1);
      this.beam.lookAt(to);
      this.beam.rotateX(Math.PI / 2);
    }
    this.beam.visible = bmat.opacity > 0.01;
    void smoothstep;
  }
}
