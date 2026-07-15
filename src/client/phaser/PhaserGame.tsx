import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { GameScene } from './GameScene';
import { LevelConfig, MirrorType } from '../../shared/types';

interface PhaserGameProps {
  levelConfig: LevelConfig;
  placedMirrors: Record<string, MirrorType>;
  placedPrisms: Record<string, boolean>;
  selectedMirrorType: MirrorType | null;
  selectedTool: 'mirror' | 'prism' | 'erase';
  cooldownActive: boolean;
  onMoveAttempt: (
    x: number,
    y: number,
    mirrorType: MirrorType | null,
    placeType?: 'mirror' | 'prism'
  ) => void;
}

export const PhaserGame: React.FC<PhaserGameProps> = ({
  levelConfig,
  placedMirrors,
  placedPrisms,
  selectedMirrorType,
  selectedTool,
  cooldownActive,
  onMoveAttempt,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<GameScene | null>(null);

  // Initialize Phaser
  useEffect(() => {
    if (!containerRef.current) return;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: '100%',
      height: '100%',
      backgroundColor: '#0b0e14',
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [GameScene],
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;

    // Start scene with initial state
    game.scene.start('GameScene', {
      levelConfig,
      placedMirrors,
      placedPrisms,
      selectedMirrorType,
      selectedTool,
      cooldownActive,
      onMoveAttempt,
    });

    game.events.on('step', () => {
      const activeScene = game.scene.getScene('GameScene');
      if (activeScene && !sceneRef.current) {
        sceneRef.current = activeScene as GameScene;
      }
    });

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
        sceneRef.current = null;
      }
    };
  }, [levelConfig.levelNumber, levelConfig.difficulty, levelConfig.width, levelConfig.height]); // Recreate game instance if level config changes

  // Update properties reactively inside the running scene
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.updateState(
        placedMirrors,
        placedPrisms,
        selectedMirrorType,
        selectedTool,
        cooldownActive
      );
    }
  }, [placedMirrors, placedPrisms, selectedMirrorType, selectedTool, cooldownActive]);


  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-0 bg-slate-950 rounded-lg overflow-hidden border border-slate-800 shadow-inner"
    />
  );
};
