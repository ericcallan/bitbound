/** Print the valley height profile along z at a given x (debugging the terrain shape). */
import { valleyHeight } from '../../src/game/level/valley';
const x = Number(process.argv[2] ?? 4);
let prev = valleyHeight(x, -3);
for (let z = -3; z >= -46; z -= 1) {
  const h = valleyHeight(x, z);
  console.log(`z=${z}\th=${h.toFixed(2)}\tslope=${(h - prev).toFixed(2)}`);
  prev = h;
}
