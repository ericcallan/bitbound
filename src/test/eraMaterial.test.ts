import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { patchEraMaterial } from '../game/render/eraMaterial';

/** The fragment rules a patched material compiles to (only the era block, from three's own chunk names). */
function rules(o: Parameters<typeof patchEraMaterial>[1]) {
  const m = patchEraMaterial(new THREE.MeshStandardMaterial(), o);
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <project_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>',
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  const f = shader.fragmentShader;
  return f.slice(f.indexOf('float eraF'));
}

/**
 * The see-through bug: inside an 8-bit Regress bubble in 3D the terrain was discarded (it starts at Early 3D) and
 * nothing replaced it. Ground and structure may give way only where the 2D tile layer draws the world instead.
 */
describe('era discard rules never leave holes in the ground', () => {
  it('structural surfaces give way below their generation only to the 2D tile layer', () => {
    expect(rules({ minEra: 2, structural: true })).toMatch(/if \(uRetroTiles > 0\.5 && eraF < 1\.5\) discard;/);
  });
  it('decoration still drops out in older generations, everywhere', () => {
    expect(rules({ minEra: 4 })).toMatch(/if \(eraF < 3\.5\) discard;/);
  });
  it('level boxes give way only where the tiles draw the world (not inside a bubble in a modern world)', () => {
    const r = rules({ retroTile: true });
    expect(r).toMatch(/if \(uRetroTiles > 0\.5 && eraF < 1\.5\) discard;/);
    expect(r).not.toMatch(/uRetro2D > 0\.5 && eraF/);
  });
  it('the old box ground hides inside the valley in 3D in every generation (no double ground, no wedge)', () => {
    expect(rules({ hideInValley: true })).toMatch(/vEraWorld\.x < uValleyX && \(eraF > 1\.5 \|\| uRetroTiles < 0\.5\)/);
  });
});
