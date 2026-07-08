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
}

export interface PlayerMove {
  x: number;
  y: number;
  mirrorType: MirrorType | null; // null to clear/remove
}
