import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { GameView } from '../game/render/GameView';
import { roomAt, type Game } from '../game/sim/Game';
import { audio } from '../game/audio/AudioEngine';
import { session } from './session';
import { useUI, type HudState } from './store';


function hudSnapshot(g: Game): HudState {
  return {
    era: g.era.displayEra,
    cells: Math.max(0, g.cells),
    bits: g.bitsCollected,
    totalBits: g.bits.length,
    shift: g.shiftStatus,
    mode3d: g.shift.mode === '3d',
    prompt: g.prompt(),
    banner: g.banner,
    expression: g.expression(),
    finaleCard: g.finaleCard,
    cinematic: !!g.cine,
    visited: g.save.visited,
    room: roomAt(g.player.pos),
    shardTaken: g.save.shardTaken,
    shiftUnlocked: g.shift.unlocked,
    bridgeRepaired: g.puzzle.state !== 'broken',
    stairRepaired: g.stair.state !== 'faded',
    gatePassed: g.save.gatePassed,
    eraKeys: g.save.eraKeys,
    maxCells: g.maxCells,
    objective: g.mode === 'play' && !g.cine ? g.objective() : '',
    dialogue: g.dialogue,
    regress: g.save.regress,
    bubbleEra: g.era.bubble ? g.era.bubble.era : -1,
    wheelOpen: g.wheelOpen,
    regressEra: g.regressEra,
    maxEraUnlocked: g.save.eraKeys ? 5 : g.era.era,
  };
}

function changed(a: HudState, b: HudState) {
  for (const k of Object.keys(a) as (keyof HudState)[]) {
    const x = a[k];
    const y = b[k];
    if (k === 'prompt') {
      if ((x as HudState['prompt'])?.text !== (y as HudState['prompt'])?.text) return true;
    } else if (k === 'banner') {
      if ((x as HudState['banner'])?.id !== (y as HudState['banner'])?.id) return true;
    } else if (k === 'dialogue') {
      if ((x as HudState['dialogue'])?.id !== (y as HudState['dialogue'])?.id) return true;
    } else if (k === 'visited') {
      if ((x as string[]).length !== (y as string[]).length) return true;
    } else if (x !== y) return true;
  }
  return false;
}

/** Bridges the imperative game/render loop into R3F's frame loop. */
export function Stage({ game, menu = false }: { game: Game; menu?: boolean }) {
  const { camera, gl } = useThree();
  const view = useMemo(() => {
    return new GameView(game, camera as THREE.PerspectiveCamera, gl, { split: menu, immersive: menu });
  }, [game, camera, gl, menu]);
  const last = useRef<HudState | null>(null);
  const fpsAcc = useRef({ t: 0, n: 0 });
  const lastBubble = useRef(-1);

  useEffect(() => {
    if (menu) return;
    audio.setEra(game.era.era);
    const off = game.on((e) => audio.handle(e));
    return () => {
      off();
      audio.setBubble(-1);
    };
  }, [game, menu]);

  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(session as object, { gl, view });
    return () => view.dispose();
  }, [view, gl]);

  useFrame((_, dt) => {
    const ui = useUI.getState();
    const input = session.input;
    if (!menu && input) {
      input.pollGamepad();
      if (input.consume('pause') && !game.finaleCard) {
        if (ui.mapOpen) ui.setMap(false);
        else if (ui.settingsOpen) ui.setSettingsOpen(false);
        else ui.setPaused(!ui.paused);
      }
      if (input.consume('map') && !game.finaleCard) ui.setMap(!ui.mapOpen);
      const blocked = ui.paused || ui.mapOpen || ui.settingsOpen || game.finaleCard;
      game.paused = ui.paused || ui.mapOpen || ui.settingsOpen;
      input.enabled = !blocked;
      if (!ui.settings.shake) game.camera.shake = 0;
      const be = game.era.bubble ? game.era.bubble.era : -1;
      if (be !== lastBubble.current) {
        lastBubble.current = be;
        audio.setBubble(be);
      }
      audio.mystery = game.shift.mode === '3d' && game.player.pos.z < -1.3 && game.player.pos.x > 52 && game.player.pos.x < 62 && !game.puzzle.plateLatched;
    }
    if (menu && game.camera.override) {
      game.camera.override.yaw = 0.3 + Math.sin(performance.now() / 9000) * 0.06;
    }
    view.setQuality(ui.settings.quality);
    game.update(Math.min(dt, 0.1));
    if (!menu) {
      const snap = hudSnapshot(game);
      if (!last.current || changed(last.current, snap)) {
        last.current = snap;
        ui.setHud(snap);
      }
      const f = fpsAcc.current;
      f.t += dt;
      f.n++;
      if (f.t > 0.5) {
        if (ui.settings.showFps) useUI.setState({ fps: Math.round(f.n / f.t) });
        f.t = 0;
        f.n = 0;
      }
    }
  }, -1);

  useFrame((_, dt) => view.update(Math.min(dt, 0.1)), 0);
  useFrame(() => view.render(gl), 1);
  return null;
}
