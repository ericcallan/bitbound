import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { Stage } from './ui/Stage';
import { useUI } from './ui/store';
import { ensureInput, makeMenuGame, session } from './ui/session';
import { MainMenu } from './ui/MainMenu';
import { HUD } from './ui/HUD';
import { PauseMenu } from './ui/PauseMenu';
import { SettingsPanel } from './ui/SettingsPanel';
import { WorldMap } from './ui/WorldMap';
import { FinaleCard } from './ui/FinaleCard';
import { Gallery } from './ui/Gallery';
import { audio } from './game/audio/AudioEngine';

export function App() {
  const screen = useUI((s) => s.screen);
  const sessionId = useUI((s) => s.session);
  const settings = useUI((s) => s.settings);
  const mapOpen = useUI((s) => s.mapOpen);
  const settingsOpen = useUI((s) => s.settingsOpen);
  const wrap = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (wrap.current) ensureInput(wrap.current);
    setReady(true);
    // Dev builds: ?scenario=<name> starts straight into a fixed, reproducible game state.
    if (import.meta.env.DEV) {
      void import('./dev/scenarios').then((m) => {
        const sc = m.requestedScenario();
        if (sc) m.bootScenario(sc);
      });
    }
  }, []);

  useEffect(() => audio.setVolumes(settings.music, settings.sfx), [settings.music, settings.sfx]);

  // The title screen gets its own attract-mode world; gameplay gets a fresh one per session.
  const menuGame = useMemo(() => (screen === 'menu' ? makeMenuGame() : null), [screen]);
  const game = screen === 'game' ? session.game : null;

  useEffect(() => {
    audio.menu = screen !== 'game';
    // A hot reload can drop the live game while the UI still says "game": fall back to the menu.
    if (screen === 'game' && !session.game) useUI.getState().setScreen('menu');
  }, [screen]);

  return (
    <div className="app" ref={wrap} onContextMenu={(e) => e.preventDefault()}>
      {screen !== 'gallery' && ready && (
        <Canvas
          className="world-canvas"
          shadows={{ type: THREE.PCFShadowMap }}
          dpr={[1, 1.5]}
          flat
          gl={{ antialias: false, powerPreference: 'high-performance' }}
          camera={{ fov: 13, near: 0.3, far: 900, position: [0, 2, 40] }}
        >
          {menuGame && <Stage key="menu" game={menuGame} menu />}
          {game && <Stage key={`game-${sessionId}`} game={game} />}
        </Canvas>
      )}
      {screen === 'menu' && <MainMenu />}
      {screen === 'game' && game && (
        <>
          <HUD />
          <PauseMenu />
          <FinaleCard />
          {mapOpen && <WorldMap overlay onClose={() => useUI.getState().setMap(false)} />}
        </>
      )}
      {screen === 'gallery' && <Gallery />}
      {settingsOpen && <SettingsPanel />}
      {settings.showFps && <FpsCounter />}
    </div>
  );
}

function FpsCounter() {
  const fps = useUI((s) => s.fps);
  return <div className="fps">{fps} fps</div>;
}
