export type Direction = 'up' | 'down' | 'left' | 'right';
export type MirrorType = '/' | '\\';
export type CellType = 'empty' | 'obstacle' | 'start' | 'target';

export interface GridCell {
  x: number;
  y: number;
  type: CellType;
  direction?: Direction; // For start/target emitters
  mirrorType?: MirrorType | null;
}

export interface LevelConfig {
  levelNumber: number;
  width: number;
  height: number;
  grid: GridCell[]; // Static elements: starts, targets, obstacles
  muralText: string; // The text description or icon revealed by this level
  difficulty: 'EZ' | 'MEDIUM EZ' | 'BIT HARD' | 'CHALLENGING' | 'HARD ASF' | 'INSANE SCTR';
  reward: number;
}

export interface GameState {
  level: number;
  placedMirrors: Record<string, MirrorType>; // Keys are "x,y"
  muralRevealed: boolean[]; // Revealed states for levels
  cooldownUntil: number | null; // Milliseconds timestamp
  username: string;
  isSolved: boolean;
  laserPath: Array<{ x: number; y: number }>;
  targetsHit: boolean;
  gameMode: 'solo' | 'community';
  credits: number;
  prismsInventory: number;
  placedPrisms: Record<string, boolean>; // Keys are "x,y"
  onlineCount: number;
  queue: string[];
  activePlacer: string | null;
  refreshesRemaining: number;
  refreshCooldownEnd: number | null;
  activeStage: 'easy' | 'medium' | 'hard';
  activeLevelNumber: number;
  highestCompleted: Record<'easy' | 'medium' | 'hard', number>;
}

export interface PlayerMove {
  x: number;
  y: number;
  mirrorType: MirrorType | null; // null to clear/remove
  placeType?: 'mirror' | 'prism';
}

