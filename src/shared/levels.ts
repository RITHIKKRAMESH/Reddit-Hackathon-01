import { LevelConfig, GridCell, Direction } from './types';
import { SeededRandom } from './seededRandom';

export function generateLevel(stage: 'easy' | 'medium' | 'hard', levelNumber: number): LevelConfig {
  const seedStr = `${stage}_${levelNumber}`;
  const rng = new SeededRandom(seedStr);

  let width = 8;
  let height = 8;
  let numObstacles = 4;
  let difficulty: 'EZ' | 'BIT HARD' | 'HARD ASF' = 'EZ';
  let reward = 5;

  if (stage === 'medium') {
    width = 10;
    height = 10;
    numObstacles = rng.range(6, 9);
    difficulty = 'BIT HARD';
    reward = 10;
  } else if (stage === 'hard') {
    width = 12;
    height = 12;
    numObstacles = rng.range(12, 16);
    difficulty = 'HARD ASF';
    reward = 20;
  } else {
    numObstacles = rng.range(3, 5);
  }

  const grid: GridCell[] = [];
  const occupied = new Set<string>();

  // Determine start and target placement (horizontal or vertical configuration)
  let startX = 0;
  let startY = 0;
  let startDir: Direction = 'right';

  let targetX = 0;
  let targetY = 0;
  let targetDir: Direction = 'left';

  const placementType = rng.next() < 0.5 ? 'horizontal' : 'vertical';

  if (placementType === 'horizontal') {
    startY = rng.range(1, height - 2);
    startX = 0;
    startDir = 'right';

    targetY = rng.range(1, height - 2);
    targetX = width - 1;
    targetDir = 'left';
  } else {
    startX = rng.range(1, width - 2);
    startY = 0;
    startDir = 'down';

    targetX = rng.range(1, width - 2);
    targetY = height - 1;
    targetDir = 'up';
  }

  grid.push({ x: startX, y: startY, type: 'start', direction: startDir });
  occupied.add(`${startX},${startY}`);

  grid.push({ x: targetX, y: targetY, type: 'target', direction: targetDir });
  occupied.add(`${targetX},${targetY}`);

  // Guaranteed obstacle to block direct alignment path
  if (placementType === 'horizontal' && startY === targetY) {
    const midX = Math.floor(width / 2);
    grid.push({ x: midX, y: startY, type: 'obstacle' });
    occupied.add(`${midX},${startY}`);
  } else if (placementType === 'vertical' && startX === targetX) {
    const midY = Math.floor(height / 2);
    grid.push({ x: startX, y: midY, type: 'obstacle' });
    occupied.add(`${startX},${midY}`);
  }

  // Generate random obstacles
  let obstaclesPlaced = 0;
  let attempts = 0;
  while (obstaclesPlaced < numObstacles && attempts < 100) {
    attempts++;
    const ox = rng.range(0, width - 1);
    const oy = rng.range(0, height - 1);
    const key = `${ox},${oy}`;

    if (occupied.has(key)) continue;

    // Avoid blocking directly adjacent tiles of start/target to keep routing solvable
    const isAdjacentToStart = Math.abs(ox - startX) + Math.abs(oy - startY) <= 1;
    const isAdjacentToTarget = Math.abs(ox - targetX) + Math.abs(oy - targetY) <= 1;
    if (isAdjacentToStart || isAdjacentToTarget) continue;

    grid.push({ x: ox, y: oy, type: 'obstacle' });
    occupied.add(key);
    obstaclesPlaced++;
  }

  const PHRASES = [
    "REDDIT HACKATHON: BOARD INITIATED",
    "COOPERATIVE FUSION CORE: POWER STABLE",
    "COMMUNICATING DATA SATELLITE: ORBIT ALIGNED",
    "QUANTUM DECOHERENCE RESISTANT SYSTEM",
    "GRAND ARCHITECTURAL MURAL DECRYPTED",
    "NEBULA QUANTUM DEFLECTOR SECURED",
    "DECRYPTED INTERSTELLAR STREAM STABILIZED",
    "CYBERNETIC OPTIC ROUTING ESTABLISHED",
    "HYPERLOOP PHOTON EMITTER ONLINE",
    "CHRONO REFRACTOR PORTAL ENERGIZED"
  ];
  const phrase = PHRASES[(levelNumber - 1) % PHRASES.length];
  const muralText = `🔴 ${phrase} - STAGE ${stage.toUpperCase()} LVL ${levelNumber} OK`;

  return {
    levelNumber,
    width,
    height,
    grid,
    muralText,
    difficulty,
    reward,
  };
}

export function getLevelsForStage(stage: 'easy' | 'medium' | 'hard'): LevelConfig[] {
  const levels: LevelConfig[] = [];
  for (let i = 1; i <= 10; i++) {
    levels.push(generateLevel(stage, i));
  }
  return levels;
}

// Keep levels array exports for compatibility or static configurations if needed
export const LEVELS = getLevelsForStage('easy');
