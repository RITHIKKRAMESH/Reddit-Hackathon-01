import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import { generateLevel, getLevelsForStage } from '../../shared/levels';
import { simulateLaser } from '../../shared/laserSim';
import type { GameState, PlayerMove, MirrorType, GridCell } from '../../shared/types';

export const api = new Hono();

interface LogEntry {
  username: string;
  action: string;
  x: number;
  y: number;
  timestamp: number;
}

// Helper to get game state
async function getGameStateForPost(
  postId: string,
  username: string,
  mode: 'solo' | 'community'
): Promise<GameState> {
  const isSolo = mode === 'solo';

  // Get active stage and level number
  const stageKey = isSolo
    ? `laser_deflect:${postId}:solo:${username}:stage`
    : `laser_deflect:${postId}:stage`;
  const activeStageStr = await redis.get(stageKey);
  const activeStage = (activeStageStr || 'easy') as 'easy' | 'medium' | 'hard';

  const levelKey = isSolo
    ? `laser_deflect:${postId}:solo:${username}:level`
    : `laser_deflect:${postId}:level`;
  const levelStr = await redis.get(levelKey);
  const activeLevelNumber = Math.min(10, levelStr ? parseInt(levelStr, 10) : 1);

  // Generate current config
  const currentLevelConfig = generateLevel(activeStage, activeLevelNumber);

  // Get placed mirrors
  const gridKey = isSolo
    ? `laser_deflect:${postId}:solo:${username}:grid:${activeStage}:${activeLevelNumber}`
    : `laser_deflect:${postId}:grid:${activeStage}:${activeLevelNumber}`;
  const gridStr = await redis.get(gridKey);
  const placedMirrors: Record<string, MirrorType> = gridStr ? JSON.parse(gridStr) : {};

  // Get placed prisms
  const prismsKey = isSolo
    ? `laser_deflect:${postId}:solo:${username}:prisms:${activeStage}:${activeLevelNumber}`
    : `laser_deflect:${postId}:prisms:${activeStage}:${activeLevelNumber}`;
  const prismsStr = await redis.get(prismsKey);
  const placedPrisms: Record<string, boolean> = prismsStr ? JSON.parse(prismsStr) : {};

  // Boundary sanitization (automatically prune out-of-bounds items from state)
  let stateSanitized = false;
  for (const key of Object.keys(placedMirrors)) {
    const coords = key.split(',').map(Number);
    const cx = coords[0];
    const cy = coords[1];
    if (cx === undefined || cy === undefined || isNaN(cx) || isNaN(cy) || cx < 0 || cx >= currentLevelConfig.width || cy < 0 || cy >= currentLevelConfig.height) {
      delete placedMirrors[key];
      stateSanitized = true;
    }
  }
  for (const key of Object.keys(placedPrisms)) {
    const coords = key.split(',').map(Number);
    const cx = coords[0];
    const cy = coords[1];
    if (cx === undefined || cy === undefined || isNaN(cx) || isNaN(cy) || cx < 0 || cx >= currentLevelConfig.width || cy < 0 || cy >= currentLevelConfig.height) {
      delete placedPrisms[key];
      stateSanitized = true;
    }
  }
  if (stateSanitized) {
    await redis.set(gridKey, JSON.stringify(placedMirrors));
    await redis.set(prismsKey, JSON.stringify(placedPrisms));
  }

  // Get highest completed level per stage
  const stages: ('easy' | 'medium' | 'hard')[] = ['easy', 'medium', 'hard'];
  const highestCompleted: Record<'easy' | 'medium' | 'hard', number> = {
    easy: 0,
    medium: 0,
    hard: 0,
  };
  for (const s of stages) {
    const key = isSolo
      ? `laser_deflect:completed:${postId}:${username}:${s}`
      : `laser_deflect:completed:${postId}:${s}`;
    const val = await redis.get(key);
    highestCompleted[s] = val ? parseInt(val, 10) : 0;
  }

  // Get mural progress dynamically based on completed levels
  const muralRevealed = Array(10)
    .fill(false)
    .map((_, i) => i + 1 <= highestCompleted[activeStage]);

  // Check cooldown
  const cooldownStr = await redis.get(`laser_deflect:cooldown:${postId}:${username}`);
  const cooldownUntil = cooldownStr ? parseInt(cooldownStr, 10) : null;

  // Get credits
  const creditsKey = `laser_deflect:credits:${username}`;
  const creditsStr = await redis.get(creditsKey);
  const credits = creditsStr ? parseInt(creditsStr, 10) : 0;

  // Get prism inventory
  const inventoryPrismsKey = `laser_deflect:inventory:${username}:prisms`;
  const prismsInventoryStr = await redis.get(inventoryPrismsKey);
  const prismsInventory = prismsInventoryStr ? parseInt(prismsInventoryStr, 10) : 0;

  // Run simulation
  const { path: laserPath, targetsHit } = simulateLaser(currentLevelConfig, placedMirrors, placedPrisms);

  // Get online players count active in last 30s
  const now = Date.now();
  const activePlayersKey = `laser_deflect:${postId}:active_players`;
  const recentPlayers = await redis.zRange(activePlayersKey, now - 30000, now, { by: 'score' });
  const onlineCount = recentPlayers.length;

  // Get queue and prune idle users (inactive for more than 5 minutes)
  const queueKey = `laser_deflect:${postId}:queue`;
  const queueStr = await redis.get(queueKey);
  let queue: string[] = queueStr ? JSON.parse(queueStr) : [];
  
  const activePlayers5m = await redis.zRange(activePlayersKey, now - 300000, now, { by: 'score' });
  const activeSet5m = new Set(activePlayers5m.map((m) => m.member));
  queue = queue.filter((name) => activeSet5m.has(name) || name === username || name === 'anonymous');
  
  // Save filtered queue back if changed
  const newQueueStr = JSON.stringify(queue);
  if (newQueueStr !== queueStr) {
    await redis.set(queueKey, newQueueStr);
  }

  const activePlacer = queue[0] || null;

  // Refreshes limit rate limit info
  const refreshesKey = `laser_deflect:refreshes:${postId}:${username}`;
  const refreshCooldownKey = `laser_deflect:refresh_cooldown:${postId}:${username}`;
  
  const refreshCountStr = await redis.get(refreshesKey);
  let refreshCount = refreshCountStr ? parseInt(refreshCountStr, 10) : 0;
  
  const cooldownEndStr = await redis.get(refreshCooldownKey);
  let cooldownEnd = cooldownEndStr ? parseInt(cooldownEndStr, 10) : 0;

  if (cooldownEnd && now > cooldownEnd) {
    refreshCount = 0;
    await redis.del(refreshesKey);
    await redis.del(refreshCooldownKey);
    cooldownEnd = 0;
  }

  return {
    level: activeLevelNumber,
    placedMirrors,
    placedPrisms,
    muralRevealed,
    cooldownUntil,
    username,
    isSolved: highestCompleted[activeStage] >= 10,
    laserPath,
    targetsHit,
    gameMode: mode,
    credits,
    prismsInventory,
    onlineCount,
    queue,
    activePlacer,
    refreshesRemaining: Math.max(0, 3 - refreshCount),
    refreshCooldownEnd: cooldownEnd || null,
    activeStage,
    activeLevelNumber,
    highestCompleted,
  };
}

// Get full game state + recent activity logs
api.get('/state', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json({ error: 'postId not found in context' }, 400);
  }

  const mode = (c.req.query('mode') as 'solo' | 'community') || 'community';

  try {
    const rawUsername = await reddit.getCurrentUsername();
    const username = rawUsername ?? 'anonymous';

    const now = Date.now();
    const activePlayersKey = `laser_deflect:${postId}:active_players`;

    // Track active players in Community Mode
    if (mode === 'community' && username !== 'anonymous') {
      await redis.zAdd(activePlayersKey, { member: username, score: now });
      await redis.zRemRangeByScore(activePlayersKey, 0, now - 300000);
    }

    // Auto-join placement queue if in Community Mode
    if (mode === 'community' && username !== 'anonymous') {
      const queueKey = `laser_deflect:${postId}:queue`;
      const queueStr = await redis.get(queueKey);
      const queue: string[] = queueStr ? JSON.parse(queueStr) : [];
      if (!queue.includes(username)) {
        queue.push(username);
        await redis.set(queueKey, JSON.stringify(queue));
      }
    }

    const gameState = await getGameStateForPost(postId, username, mode);

    // Get log entries
    const logsStr = await redis.get(`laser_deflect:${postId}:logs`);
    const logs: LogEntry[] = logsStr ? JSON.parse(logsStr) : [];

    const lastUpdateStr = await redis.get(`laser_deflect:${postId}:last_update`);
    const lastUpdate = lastUpdateStr ? parseInt(lastUpdateStr, 10) : 0;

    return c.json({
      gameState,
      logs,
      levels: getLevelsForStage(gameState.activeStage),
      lastUpdate,
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
    const { x, y, mirrorType, placeType } = move;
    
    // Support passing mode in body or query param
    const body = move as any;
    const mode: 'solo' | 'community' = body.mode || c.req.query('mode') || 'community';
    const isSolo = mode === 'solo';

    // Fetch current state
    const stageKey = isSolo
      ? `laser_deflect:${postId}:solo:${username}:stage`
      : `laser_deflect:${postId}:stage`;
    const activeStageStr = await redis.get(stageKey);
    const activeStage = (activeStageStr || 'easy') as 'easy' | 'medium' | 'hard';

    const levelKey = isSolo
      ? `laser_deflect:${postId}:solo:${username}:level`
      : `laser_deflect:${postId}:level`;
    const levelStr = await redis.get(levelKey);
    const activeLevelNumber = Math.min(10, levelStr ? parseInt(levelStr, 10) : 1);

    if (activeLevelNumber > 10) {
      return c.json({ error: 'Stage already completed!' }, 400);
    }

    const currentLevelConfig = generateLevel(activeStage, activeLevelNumber);

    // 1a. Cooldown validation (Both Solo and Community)
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

    // 1b. Queue validation (Community Mode only)
    if (!isSolo) {
      const queueKey = `laser_deflect:${postId}:queue`;
      const queueStr = await redis.get(queueKey);
      const queue: string[] = queueStr ? JSON.parse(queueStr) : [];
      const activePlacer = queue[0] || null;
      if (activePlacer && username !== activePlacer) {
        return c.json({ error: `Not your turn! Active placer is: ${activePlacer}` }, 403);
      }
    }

    // 2. Bound validation
    if (x < 0 || x >= currentLevelConfig.width || y < 0 || y >= currentLevelConfig.height) {
      return c.json({ error: 'Coordinates out of bounds' }, 400);
    }

    // 3. Entity collision (cannot place on start, target, obstacles)
    const staticEntity = currentLevelConfig.grid.find((cell: GridCell) => cell.x === x && cell.y === y);
    if (staticEntity && staticEntity.type !== 'empty') {
      return c.json({ error: 'Cannot place on this grid tile' }, 400);
    }

    // Keys for grids
    const gridKey = isSolo
      ? `laser_deflect:${postId}:solo:${username}:grid:${activeStage}:${activeLevelNumber}`
      : `laser_deflect:${postId}:grid:${activeStage}:${activeLevelNumber}`;
    const prismsKey = isSolo
      ? `laser_deflect:${postId}:solo:${username}:prisms:${activeStage}:${activeLevelNumber}`
      : `laser_deflect:${postId}:prisms:${activeStage}:${activeLevelNumber}`;

    // Get current mirrors & prisms
    const gridStr = await redis.get(gridKey);
    const placedMirrors: Record<string, MirrorType> = gridStr ? JSON.parse(gridStr) : {};

    const prismsStr = await redis.get(prismsKey);
    const placedPrisms: Record<string, boolean> = prismsStr ? JSON.parse(prismsStr) : {};

    const cellKey = `${x},${y}`;
    let actionText = '';

    const inventoryPrismsKey = `laser_deflect:inventory:${username}:prisms`;

    // 4. Update elements
    if (placeType === 'prism') {
      // Place a Prism block
      if (mirrorType === null) {
        // Erase prism
        if (!placedPrisms[cellKey]) {
          return c.json({ error: 'No prism to remove at this coordinate' }, 400);
        }
        delete placedPrisms[cellKey];
        // Refund prism back to inventory
        await redis.incrBy(inventoryPrismsKey, 1);
        actionText = 'cleared prism';
      } else {
        // Buy / place check
        const prismsInventoryStr = await redis.get(inventoryPrismsKey);
        const prismsInventory = prismsInventoryStr ? parseInt(prismsInventoryStr, 10) : 0;
        if (prismsInventory < 1) {
          return c.json({ error: 'You do not have any Prisms! Buy one in the Shop.' }, 400);
        }

        // Overwrite mirror if exists
        if (placedMirrors[cellKey]) {
          delete placedMirrors[cellKey];
        }

        placedPrisms[cellKey] = true;
        await redis.incrBy(inventoryPrismsKey, -1);
        actionText = 'placed Prism';
      }
    } else {
      // Place or clear a Mirror
      if (mirrorType === null) {
        // Erase
        if (placedPrisms[cellKey]) {
          delete placedPrisms[cellKey];
          await redis.incrBy(inventoryPrismsKey, 1);
          actionText = 'cleared prism';
        } else if (placedMirrors[cellKey]) {
          delete placedMirrors[cellKey];
          actionText = 'cleared mirror';
        } else {
          return c.json({ error: 'No element to remove at this coordinate' }, 400);
        }
      } else {
        // If there was a prism, clear and refund it
        if (placedPrisms[cellKey]) {
          delete placedPrisms[cellKey];
          await redis.incrBy(inventoryPrismsKey, 1);
        }

        placedMirrors[cellKey] = mirrorType;
        actionText = `placed ${mirrorType}`;
      }
    }

    // Save grid state back
    await redis.set(gridKey, JSON.stringify(placedMirrors));
    await redis.set(prismsKey, JSON.stringify(placedPrisms));

    // 5. Simulate to check for level completion
    const { targetsHit } = simulateLaser(currentLevelConfig, placedMirrors, placedPrisms);

    let levelSolved = false;
    let nextLevel = activeLevelNumber;

    if (targetsHit) {
      // Level solved!
      levelSolved = true;

      // Update highest completed level
      const highestCompletedKey = isSolo
        ? `laser_deflect:completed:${postId}:${username}:${activeStage}`
        : `laser_deflect:completed:${postId}:${activeStage}`;
      const highestCompletedStr = await redis.get(highestCompletedKey);
      const currentHighest = highestCompletedStr ? parseInt(highestCompletedStr, 10) : 0;
      if (activeLevelNumber > currentHighest) {
        await redis.set(highestCompletedKey, activeLevelNumber.toString());
      }

      nextLevel = activeLevelNumber + 1;
      await redis.set(levelKey, nextLevel.toString());
      actionText += ` and SOLVED Level ${activeLevelNumber}! 🌟`;

      // Award Lux Credits
      const creditsKey = `laser_deflect:credits:${username}`;
      await redis.incrBy(creditsKey, currentLevelConfig.reward);
    }

    // 6. Queue rotation & Cooldown (Community Mode only)
    if (!isSolo) {
      const queueKey = `laser_deflect:${postId}:queue`;
      const queueStr = await redis.get(queueKey);
      let queue: string[] = queueStr ? JSON.parse(queueStr) : [];
      if (queue.length > 0 && queue[0] === username) {
        queue.shift();
        queue.push(username);
        await redis.set(queueKey, JSON.stringify(queue));
      }

      // Log activity
      const logsStr = await redis.get(`laser_deflect:${postId}:logs`);
      const logs: LogEntry[] = logsStr ? JSON.parse(logsStr) : [];
      logs.unshift({
        username,
        action: actionText,
        x,
        y,
        timestamp: Date.now(),
      });
      if (logs.length > 15) {
        logs.pop();
      }
      await redis.set(`laser_deflect:${postId}:logs`, JSON.stringify(logs));
      
      // Update last update timestamp
      await redis.set(`laser_deflect:${postId}:last_update`, Date.now().toString());

      // Enforce cooldown (1 second)
      const cooldownMs = 1 * 1000;
      const nextCooldown = Date.now() + cooldownMs;
      await redis.set(`laser_deflect:cooldown:${postId}:${username}`, nextCooldown.toString());
    } else {
      // Enforce cooldown for Solo mode as well (1 second)
      const cooldownMs = 1 * 1000;
      const nextCooldown = Date.now() + cooldownMs;
      await redis.set(`laser_deflect:cooldown:${postId}:${username}`, nextCooldown.toString());
    }

    // Fetch new status
    const updatedState = await getGameStateForPost(postId, username, mode);
    const logsStr = await redis.get(`laser_deflect:${postId}:logs`);
    const logs = logsStr ? JSON.parse(logsStr) : [];

    const lastUpdateStr = await redis.get(`laser_deflect:${postId}:last_update`);
    const lastUpdate = lastUpdateStr ? parseInt(lastUpdateStr, 10) : 0;

    return c.json({
      success: true,
      levelSolved,
      gameState: updatedState,
      logs,
      lastUpdate,
      levels: getLevelsForStage(updatedState.activeStage),
    });
  } catch (err) {
    console.error('Error handling player move:', err);
    return c.json({ error: 'Failed to process move' }, 500);
  }
});

// Shop purchase endpoint
api.post('/buy-prism', async (c) => {
  const { postId } = context;
  if (!postId) return c.json({ error: 'postId not found in context' }, 400);
  const mode = (c.req.query('mode') as 'solo' | 'community') || 'community';

  try {
    const rawUsername = await reddit.getCurrentUsername();
    const username = rawUsername ?? 'anonymous';
    if (username === 'anonymous') {
      return c.json({ error: 'Must be logged in to buy a Prism' }, 400);
    }

    const creditsKey = `laser_deflect:credits:${username}`;
    const creditsStr = await redis.get(creditsKey);
    const credits = creditsStr ? parseInt(creditsStr, 10) : 0;

    if (credits < 15) {
      return c.json({ error: 'Insufficient Lux Credits. Price is 15 LC.' }, 400);
    }

    await redis.incrBy(creditsKey, -15);
    const inventoryPrismsKey = `laser_deflect:inventory:${username}:prisms`;
    await redis.incrBy(inventoryPrismsKey, 1);

    const updatedState = await getGameStateForPost(postId, username, mode);
    return c.json({ success: true, gameState: updatedState });
  } catch (err) {
    console.error('Error buying prism:', err);
    return c.json({ error: 'Failed to buy prism' }, 500);
  }
});

// Skip Level endpoint (cost: 5 LC)
api.post('/skip-level', async (c) => {
  const { postId } = context;
  if (!postId) return c.json({ error: 'postId not found in context' }, 400);
  const mode = (c.req.query('mode') as 'solo' | 'community') || 'community';

  try {
    const rawUsername = await reddit.getCurrentUsername();
    const username = rawUsername ?? 'anonymous';
    if (username === 'anonymous') {
      return c.json({ error: 'Must be logged in to skip level' }, 400);
    }

    const isSolo = mode === 'solo';

    // Fetch current state
    const stageKey = isSolo
      ? `laser_deflect:${postId}:solo:${username}:stage`
      : `laser_deflect:${postId}:stage`;
    const activeStageStr = await redis.get(stageKey);
    const activeStage = (activeStageStr || 'easy') as 'easy' | 'medium' | 'hard';

    const levelKey = isSolo
      ? `laser_deflect:${postId}:solo:${username}:level`
      : `laser_deflect:${postId}:level`;
    const levelStr = await redis.get(levelKey);
    const activeLevelNumber = Math.min(10, levelStr ? parseInt(levelStr, 10) : 1);

    if (activeLevelNumber > 10) {
      return c.json({ error: 'Stage already completed!' }, 400);
    }

    // Check and deduct 5 credits
    const creditsKey = `laser_deflect:credits:${username}`;
    const creditsStr = await redis.get(creditsKey);
    const credits = creditsStr ? parseInt(creditsStr, 10) : 0;

    if (credits < 5) {
      return c.json({ error: 'Insufficient Lux Credits. Price is 5 LC.' }, 400);
    }

    await redis.incrBy(creditsKey, -5);

    // Update highest completed level
    const highestCompletedKey = isSolo
      ? `laser_deflect:completed:${postId}:${username}:${activeStage}`
      : `laser_deflect:completed:${postId}:${activeStage}`;
    const highestCompletedStr = await redis.get(highestCompletedKey);
    const currentHighest = highestCompletedStr ? parseInt(highestCompletedStr, 10) : 0;
    if (activeLevelNumber > currentHighest) {
      await redis.set(highestCompletedKey, activeLevelNumber.toString());
    }

    // Update active level to next
    const nextLevel = activeLevelNumber + 1;
    await redis.set(levelKey, nextLevel.toString());

    // Clear board on skipping (specific to level skipped!)
    const gridKey = isSolo
      ? `laser_deflect:${postId}:solo:${username}:grid:${activeStage}:${activeLevelNumber}`
      : `laser_deflect:${postId}:grid:${activeStage}:${activeLevelNumber}`;
    const prismsKey = isSolo
      ? `laser_deflect:${postId}:solo:${username}:prisms:${activeStage}:${activeLevelNumber}`
      : `laser_deflect:${postId}:prisms:${activeStage}:${activeLevelNumber}`;
    await redis.del(gridKey);
    await redis.del(prismsKey);

    // Log skipping action (Community Mode only)
    if (!isSolo) {
      const logsStr = await redis.get(`laser_deflect:${postId}:logs`);
      const logs = logsStr ? JSON.parse(logsStr) : [];
      logs.unshift({
        username,
        action: `SKIPPED Level ${activeLevelNumber} (paid 5 LC) ⏩`,
        x: -1,
        y: -1,
        timestamp: Date.now(),
      });
      if (logs.length > 15) {
        logs.pop();
      }
      await redis.set(`laser_deflect:${postId}:logs`, JSON.stringify(logs));
      await redis.set(`laser_deflect:${postId}:last_update`, Date.now().toString());
    }

    const updatedState = await getGameStateForPost(postId, username, mode);
    const logsStr = await redis.get(`laser_deflect:${postId}:logs`);
    const logs = logsStr ? JSON.parse(logsStr) : [];

    const lastUpdateStr = await redis.get(`laser_deflect:${postId}:last_update`);
    const lastUpdate = lastUpdateStr ? parseInt(lastUpdateStr, 10) : 0;

    return c.json({
      success: true,
      gameState: updatedState,
      logs,
      lastUpdate,
      levels: getLevelsForStage(updatedState.activeStage),
      skippedLevel: activeLevelNumber,
      stageCompleted: nextLevel > 10,
    });
  } catch (err) {
    console.error('Error skipping level:', err);
    return c.json({ error: 'Failed to skip level' }, 500);
  }
});

// Rate-limited Reset Board endpoint
api.post('/reset-board', async (c) => {
  const { postId } = context;
  if (!postId) return c.json({ error: 'postId not found in context' }, 400);
  const mode = (c.req.query('mode') as 'solo' | 'community') || 'community';

  try {
    const rawUsername = await reddit.getCurrentUsername();
    const username = rawUsername ?? 'anonymous';

    const refreshCountKey = `laser_deflect:refreshes:${postId}:${username}`;
    const cooldownKey = `laser_deflect:refresh_cooldown:${postId}:${username}`;

    const now = Date.now();
    const countStr = await redis.get(refreshCountKey);
    let count = countStr ? parseInt(countStr, 10) : 0;

    const cooldownEndStr = await redis.get(cooldownKey);
    let cooldownEnd = cooldownEndStr ? parseInt(cooldownEndStr, 10) : 0;

    if (cooldownEnd && now > cooldownEnd) {
      count = 0;
      await redis.del(refreshCountKey);
      await redis.del(cooldownKey);
      cooldownEnd = 0;
    }

    if (count >= 3) {
      const remainingMs = cooldownEnd - now;
      return c.json(
        {
          error: `Rate limit exceeded. Remaining cooldown: ${Math.ceil(remainingMs / 1000)} seconds.`,
          cooldownRemainingMs: remainingMs > 0 ? remainingMs : 0,
        },
        429
      );
    }

    const isSolo = mode === 'solo';

    const stageKey = isSolo
      ? `laser_deflect:${postId}:solo:${username}:stage`
      : `laser_deflect:${postId}:stage`;
    const activeStageStr = await redis.get(stageKey);
    const activeStage = (activeStageStr || 'easy') as 'easy' | 'medium' | 'hard';

    const levelKey = isSolo
      ? `laser_deflect:${postId}:solo:${username}:level`
      : `laser_deflect:${postId}:level`;
    const levelStr = await redis.get(levelKey);
    const activeLevelNumber = levelStr ? parseInt(levelStr, 10) : 1;

    const gridKey = isSolo
      ? `laser_deflect:${postId}:solo:${username}:grid:${activeStage}:${activeLevelNumber}`
      : `laser_deflect:${postId}:grid:${activeStage}:${activeLevelNumber}`;
    const prismsKey = isSolo
      ? `laser_deflect:${postId}:solo:${username}:prisms:${activeStage}:${activeLevelNumber}`
      : `laser_deflect:${postId}:prisms:${activeStage}:${activeLevelNumber}`;

    // Refund placed prisms on reset
    const placedPrismsStr = await redis.get(prismsKey);
    const placedPrisms: Record<string, boolean> = placedPrismsStr ? JSON.parse(placedPrismsStr) : {};
    let refundCount = 0;
    for (const placed of Object.values(placedPrisms)) {
      if (placed) refundCount++;
    }

    if (refundCount > 0 && username !== 'anonymous') {
      const inventoryPrismsKey = `laser_deflect:inventory:${username}:prisms`;
      await redis.incrBy(inventoryPrismsKey, refundCount);
    }

    await redis.del(gridKey);
    await redis.del(prismsKey);

    // Increment refresh counter
    if (count === 0) {
      await redis.set(refreshCountKey, '1');
      await redis.set(cooldownKey, (now + 300000).toString());
      await redis.expire(refreshCountKey, 300);
      await redis.expire(cooldownKey, 300);
    } else {
      await redis.incrBy(refreshCountKey, 1);
    }

    // Community activity logs
    if (!isSolo) {
      const logsStr = await redis.get(`laser_deflect:${postId}:logs`);
      const logs: LogEntry[] = logsStr ? JSON.parse(logsStr) : [];
      logs.unshift({
        username,
        action: `reset all elements on Level ${activeLevelNumber}! 🔄`,
        x: 0,
        y: 0,
        timestamp: Date.now(),
      });
      if (logs.length > 15) {
        logs.pop();
      }
      await redis.set(`laser_deflect:${postId}:logs`, JSON.stringify(logs));

      // Update last update timestamp
      await redis.set(`laser_deflect:${postId}:last_update`, Date.now().toString());
    }

    const updatedState = await getGameStateForPost(postId, username, mode);
    const logsStr = await redis.get(`laser_deflect:${postId}:logs`);
    const logs = logsStr ? JSON.parse(logsStr) : [];

    const lastUpdateStr = await redis.get(`laser_deflect:${postId}:last_update`);
    const lastUpdate = lastUpdateStr ? parseInt(lastUpdateStr, 10) : 0;

    return c.json({
      success: true,
      gameState: updatedState,
      logs,
      lastUpdate,
      levels: getLevelsForStage(updatedState.activeStage),
    });
  } catch (err) {
    console.error('Error resetting board:', err);
    return c.json({ error: 'Failed to reset board' }, 500);
  }
});

// Join queue manually
api.post('/join-queue', async (c) => {
  const { postId } = context;
  if (!postId) return c.json({ error: 'postId not found in context' }, 400);
  const mode = (c.req.query('mode') as 'solo' | 'community') || 'community';

  try {
    const rawUsername = await reddit.getCurrentUsername();
    const username = rawUsername ?? 'anonymous';
    if (username === 'anonymous') {
      return c.json({ error: 'Must be logged in to join placement queue' }, 400);
    }

    const queueKey = `laser_deflect:${postId}:queue`;
    const queueStr = await redis.get(queueKey);
    const queue: string[] = queueStr ? JSON.parse(queueStr) : [];
    if (!queue.includes(username)) {
      queue.push(username);
      await redis.set(queueKey, JSON.stringify(queue));
    }

    const updatedState = await getGameStateForPost(postId, username, mode);
    return c.json({ success: true, gameState: updatedState });
  } catch (err) {
    console.error('Error joining queue:', err);
    return c.json({ error: 'Failed to join queue' }, 500);
  }
});

// Leave queue manually
api.post('/leave-queue', async (c) => {
  const { postId } = context;
  if (!postId) return c.json({ error: 'postId not found in context' }, 400);
  const mode = (c.req.query('mode') as 'solo' | 'community') || 'community';

  try {
    const rawUsername = await reddit.getCurrentUsername();
    const username = rawUsername ?? 'anonymous';

    const queueKey = `laser_deflect:${postId}:queue`;
    const queueStr = await redis.get(queueKey);
    let queue: string[] = queueStr ? JSON.parse(queueStr) : [];
    queue = queue.filter((name) => name !== username);
    await redis.set(queueKey, JSON.stringify(queue));

    const updatedState = await getGameStateForPost(postId, username, mode);
    return c.json({ success: true, gameState: updatedState });
  } catch (err) {
    console.error('Error leaving queue:', err);
    return c.json({ error: 'Failed to leave queue' }, 500);
  }
});

// Get the last update timestamp
api.get('/state-version', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json({ error: 'postId not found in context' }, 400);
  }
  const lastUpdateStr = await redis.get(`laser_deflect:${postId}:last_update`);
  const lastUpdate = lastUpdateStr ? parseInt(lastUpdateStr, 10) : 0;
  return c.json({ lastUpdate });
});

// Select specific level and stage
api.post('/select-level', async (c) => {
  const { postId } = context;
  if (!postId) return c.json({ error: 'postId not found in context' }, 400);
  const mode = (c.req.query('mode') as 'solo' | 'community') || 'community';
  const isSolo = mode === 'solo';

  try {
    const rawUsername = await reddit.getCurrentUsername();
    const username = rawUsername ?? 'anonymous';

    const { stage, levelNumber } = await c.req.json();

    if (!['easy', 'medium', 'hard'].includes(stage)) {
      return c.json({ error: 'Invalid stage' }, 400);
    }
    if (typeof levelNumber !== 'number' || levelNumber < 1 || levelNumber > 10) {
      return c.json({ error: 'Invalid level number' }, 400);
    }

    const stageKey = isSolo
      ? `laser_deflect:${postId}:solo:${username}:stage`
      : `laser_deflect:${postId}:stage`;
    const levelKey = isSolo
      ? `laser_deflect:${postId}:solo:${username}:level`
      : `laser_deflect:${postId}:level`;

    await redis.set(stageKey, stage);
    await redis.set(levelKey, levelNumber.toString());

    // Trigger state-version update for community mode
    if (!isSolo) {
      await redis.set(`laser_deflect:${postId}:last_update`, Date.now().toString());

      // Add a log entry for switching stage/level
      const logsStr = await redis.get(`laser_deflect:${postId}:logs`);
      const logs: LogEntry[] = logsStr ? JSON.parse(logsStr) : [];
      logs.unshift({
        username,
        action: `switched to Stage: ${stage.toUpperCase()}, Level: ${levelNumber} 🎯`,
        x: 0,
        y: 0,
        timestamp: Date.now(),
      });
      if (logs.length > 15) {
        logs.pop();
      }
      await redis.set(`laser_deflect:${postId}:logs`, JSON.stringify(logs));
    }

    const updatedState = await getGameStateForPost(postId, username, mode);
    const logsStr = await redis.get(`laser_deflect:${postId}:logs`);
    const logs = logsStr ? JSON.parse(logsStr) : [];

    const lastUpdateStr = await redis.get(`laser_deflect:${postId}:last_update`);
    const lastUpdate = lastUpdateStr ? parseInt(lastUpdateStr, 10) : 0;

    return c.json({
      success: true,
      gameState: updatedState,
      logs,
      lastUpdate,
      levels: getLevelsForStage(updatedState.activeStage),
    });
  } catch (err) {
    console.error('Error selecting level:', err);
    return c.json({ error: 'Failed to select level' }, 500);
  }
});

