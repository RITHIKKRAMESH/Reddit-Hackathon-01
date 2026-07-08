import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import { LEVELS } from '../../shared/levels';
import { simulateLaser } from '../../shared/laserSim';
import type { GameState, PlayerMove, MirrorType, LevelConfig, GridCell } from '../../shared/types';

export const api = new Hono();

interface LogEntry {
  username: string;
  action: string;
  x: number;
  y: number;
  timestamp: number;
}

// Helper to get game state
async function getGameStateForPost(postId: string, username: string): Promise<GameState> {
  const levelStr = await redis.get(`laser_deflect:${postId}:level`);
  const levelNum = levelStr ? parseInt(levelStr, 10) : 1;
  const currentLevelConfig = LEVELS[Math.min(levelNum - 1, LEVELS.length - 1)] as LevelConfig;

  // Get placed mirrors
  const gridStr = await redis.get(`laser_deflect:${postId}:grid:${levelNum}`);
  const placedMirrors: Record<string, MirrorType> = gridStr ? JSON.parse(gridStr) : {};

  // Get mural progress
  const muralStr = await redis.get(`laser_deflect:${postId}:mural`);
  const muralRevealed: boolean[] = muralStr
    ? JSON.parse(muralStr)
    : Array(LEVELS.length).fill(false);

  // Check cooldown
  const cooldownStr = await redis.get(`laser_deflect:cooldown:${postId}:${username}`);
  const cooldownUntil = cooldownStr ? parseInt(cooldownStr, 10) : null;

  // Run simulation
  const { path: laserPath, targetsHit } = simulateLaser(currentLevelConfig, placedMirrors);

  return {
    level: levelNum,
    placedMirrors,
    muralRevealed,
    cooldownUntil,
    username,
    isSolved: levelNum > LEVELS.length,
    laserPath,
    targetsHit,
  };
}

// Get full game state + recent activity logs
api.get('/state', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json({ error: 'postId not found in context' }, 400);
  }

  try {
    const rawUsername = await reddit.getCurrentUsername();
    const username = rawUsername ?? 'anonymous';

    const gameState = await getGameStateForPost(postId, username);

    // Get log entries
    const logsStr = await redis.get(`laser_deflect:${postId}:logs`);
    const logs: LogEntry[] = logsStr ? JSON.parse(logsStr) : [];

    return c.json({
      gameState,
      logs,
      levels: LEVELS,
    });
  } catch (err) {
    console.error('Error fetching game state:', err);
    return c.json({ error: 'Failed to load game state' }, 500);
  }
});

// Process a player's mirror action
api.post('/make-move', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json({ error: 'postId not found in context' }, 400);
  }

  try {
    const rawUsername = await reddit.getCurrentUsername();
    const username = rawUsername ?? 'anonymous';

    const move: PlayerMove = await c.req.json();
    const { x, y, mirrorType } = move;

    // Fetch current state
    const levelStr = await redis.get(`laser_deflect:${postId}:level`);
    const levelNum = levelStr ? parseInt(levelStr, 10) : 1;

    if (levelNum > LEVELS.length) {
      return c.json({ error: 'Mural already completed!' }, 400);
    }

    const currentLevelConfig = LEVELS[levelNum - 1] as LevelConfig;

    // 1. Cooldown validation
    const cooldownStr = await redis.get(`laser_deflect:cooldown:${postId}:${username}`);
    const cooldownUntil = cooldownStr ? parseInt(cooldownStr, 10) : 0;
    if (Date.now() < cooldownUntil) {
      return c.json(
        {
          error: 'On cooldown',
          cooldownUntil,
        },
        403
      );
    }

    // 2. Bound validation
    if (x < 0 || x >= currentLevelConfig.width || y < 0 || y >= currentLevelConfig.height) {
      return c.json({ error: 'Coordinates out of bounds' }, 400);
    }

    // 3. Entity collision (cannot place on start, target, obstacles)
    const staticEntity = currentLevelConfig.grid.find((cell: GridCell) => cell.x === x && cell.y === y);
    if (staticEntity && staticEntity.type !== 'empty') {
      return c.json({ error: 'Cannot place mirror on this grid tile' }, 400);
    }

    // Get current grid of mirrors
    const gridKey = `laser_deflect:${postId}:grid:${levelNum}`;
    const gridStr = await redis.get(gridKey);
    const placedMirrors: Record<string, MirrorType> = gridStr ? JSON.parse(gridStr) : {};

    // 4. Update the mirror
    const cellKey = `${x},${y}`;
    let actionText = '';
    if (mirrorType === null) {
      if (!placedMirrors[cellKey]) {
        return c.json({ error: 'No mirror to remove at this coordinate' }, 400);
      }
      delete placedMirrors[cellKey];
      actionText = 'cleared cell';
    } else {
      placedMirrors[cellKey] = mirrorType;
      actionText = `placed ${mirrorType}`;
    }

    // Save grid state back
    await redis.set(gridKey, JSON.stringify(placedMirrors));

    // 5. Simulate to check for level completion
    const { targetsHit } = simulateLaser(currentLevelConfig, placedMirrors);

    let levelSolved = false;
    let nextLevel = levelNum;
    const muralKey = `laser_deflect:${postId}:mural`;
    const muralStr = await redis.get(muralKey);
    const muralRevealed: boolean[] = muralStr
      ? JSON.parse(muralStr)
      : Array(LEVELS.length).fill(false);

    if (targetsHit) {
      // Level solved!
      levelSolved = true;
      muralRevealed[levelNum - 1] = true;
      await redis.set(muralKey, JSON.stringify(muralRevealed));

      nextLevel = levelNum + 1;
      await redis.set(`laser_deflect:${postId}:level`, nextLevel.toString());
      actionText += ` and SOLVED Level ${levelNum}! 🌟`;
    }

    // 6. Log activity
    const logsStr = await redis.get(`laser_deflect:${postId}:logs`);
    const logs: LogEntry[] = logsStr ? JSON.parse(logsStr) : [];
    logs.unshift({
      username,
      action: actionText,
      x,
      y,
      timestamp: Date.now(),
    });
    // Keep last 15 logs
    if (logs.length > 15) {
      logs.pop();
    }
    await redis.set(`laser_deflect:${postId}:logs`, JSON.stringify(logs));

    // 7. Enforce cooldown
    const cooldownMs = 5 * 1000; // 5 seconds cooldown
    const nextCooldown = Date.now() + cooldownMs;
    await redis.set(`laser_deflect:cooldown:${postId}:${username}`, nextCooldown.toString());

    // Fetch new status
    const updatedState = await getGameStateForPost(postId, username);

    return c.json({
      success: true,
      levelSolved,
      gameState: updatedState,
      logs,
    });
  } catch (err) {
    console.error('Error handling player move:', err);
    return c.json({ error: 'Failed to process move' }, 500);
  }
});
