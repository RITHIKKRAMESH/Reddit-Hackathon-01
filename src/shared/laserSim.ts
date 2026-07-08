import { LevelConfig, MirrorType } from './types';

export interface LaserSimResult {
  path: Array<{ x: number; y: number }>;
  targetsHit: boolean;
}

export function simulateLaser(
  level: LevelConfig,
  placedMirrors: Record<string, MirrorType>
): LaserSimResult {
  // Find start cell
  const startCell = level.grid.find((c) => c.type === 'start');
  if (!startCell) {
    return { path: [], targetsHit: false };
  }

  let currX = startCell.x;
  let currY = startCell.y;
  const startDir = startCell.direction || 'right';

  let dx = 0;
  let dy = 0;
  switch (startDir) {
    case 'up':
      dy = -1;
      break;
    case 'down':
      dy = 1;
      break;
    case 'left':
      dx = -1;
      break;
    case 'right':
      dx = 1;
      break;
  }

  const path: Array<{ x: number; y: number }> = [{ x: currX, y: currY }];
  let targetsHit = false;

  // Find target coordinates
  const targetCells = level.grid.filter((c) => c.type === 'target');
  const obstacles = new Set(
    level.grid.filter((c) => c.type === 'obstacle').map((c) => `${c.x},${c.y}`)
  );

  const maxSteps = 150; // safeguard against infinite loops
  let step = 0;

  while (step < maxSteps) {
    const nextX = currX + dx;
    const nextY = currY + dy;

    // Check boundary
    if (nextX < 0 || nextX >= level.width || nextY < 0 || nextY >= level.height) {
      path.push({ x: nextX, y: nextY }); // show it exiting
      break;
    }

    path.push({ x: nextX, y: nextY });
    currX = nextX;
    currY = nextY;

    const cellKey = `${currX},${currY}`;

    // Hit static obstacle?
    if (obstacles.has(cellKey)) {
      break;
    }

    // Hit target?
    const hitTarget = targetCells.find((t) => t.x === currX && t.y === currY);
    if (hitTarget) {
      targetsHit = true;
      break;
    }

    // Hit start node? (cannot route back into start)
    if (currX === startCell.x && currY === startCell.y) {
      break;
    }

    // Hit a mirror?
    const mirror = placedMirrors[cellKey];
    if (mirror) {
      if (mirror === '/') {
        // Reflection for '/' (45 degrees)
        // (dx=1, dy=0) -> (dx=0, dy=-1) [Right -> Up]
        // (dx=-1, dy=0) -> (dx=0, dy=1) [Left -> Down]
        // (dx=0, dy=1) -> (dx=-1, dy=0) [Down -> Left]
        // (dx=0, dy=-1) -> (dx=1, dy=0) [Up -> Right]
        const oldDx = dx;
        dx = -dy;
        dy = -oldDx;
      } else if (mirror === '\\') {
        // Reflection for '\' (135 degrees)
        // (dx=1, dy=0) -> (dx=0, dy=1) [Right -> Down]
        // (dx=-1, dy=0) -> (dx=0, dy=-1) [Left -> Up]
        // (dx=0, dy=1) -> (dx=1, dy=0) [Down -> Right]
        // (dx=0, dy=-1) -> (dx=-1, dy=0) [Up -> Left]
        const oldDx = dx;
        dx = dy;
        dy = oldDx;
      }
    }

    step++;
  }

  return {
    path,
    targetsHit,
  };
}
