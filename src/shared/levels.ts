import { LevelConfig } from './types';

export const LEVELS: LevelConfig[] = [
  {
    levelNumber: 1,
    width: 8,
    height: 8,
    muralText: '🔴 REDDIT HACKATHON 2026: BOARD INITIATED',
    grid: [
      { x: 0, y: 3, type: 'start', direction: 'right' },
      { x: 7, y: 3, type: 'target', direction: 'left' },
      // Direct path is blocked, forcing the laser to deflect around
      { x: 3, y: 3, type: 'obstacle' },
      { x: 4, y: 3, type: 'obstacle' },
    ],
  },
  {
    levelNumber: 2,
    width: 10,
    height: 10,
    muralText: '⚡ COOPERATIVE FUSION CORE: POWER STABLE',
    grid: [
      { x: 1, y: 1, type: 'start', direction: 'down' },
      { x: 8, y: 8, type: 'target', direction: 'up' },
      // Block standard diagonals
      { x: 1, y: 8, type: 'obstacle' },
      { x: 8, y: 1, type: 'obstacle' },
      { x: 4, y: 4, type: 'obstacle' },
      { x: 5, y: 5, type: 'obstacle' },
    ],
  },
  {
    levelNumber: 3,
    width: 10,
    height: 10,
    muralText: '🛰️ COMMUNICATING DATA SATELLITE: ORBIT ALIGNED',
    grid: [
      { x: 0, y: 1, type: 'start', direction: 'right' },
      { x: 9, y: 8, type: 'target', direction: 'left' },
      // Obstacle walls forcing vertical routing
      { x: 4, y: 0, type: 'obstacle' },
      { x: 4, y: 1, type: 'obstacle' },
      { x: 4, y: 2, type: 'obstacle' },
      { x: 4, y: 3, type: 'obstacle' },
      { x: 4, y: 4, type: 'obstacle' },
      { x: 4, y: 5, type: 'obstacle' },
      { x: 6, y: 9, type: 'obstacle' },
      { x: 6, y: 8, type: 'obstacle' },
      { x: 6, y: 7, type: 'obstacle' },
      { x: 6, y: 6, type: 'obstacle' },
      { x: 6, y: 5, type: 'obstacle' },
    ],
  },
  {
    levelNumber: 4,
    width: 12,
    height: 12,
    muralText: '🧬 QUANTUM DECOHERENCE RESISTANT SYSTEM ACTIVE',
    grid: [
      { x: 0, y: 0, type: 'start', direction: 'down' },
      { x: 11, y: 0, type: 'target', direction: 'down' },
      // Obstacles in a zigzag pattern
      { x: 0, y: 6, type: 'obstacle' },
      { x: 2, y: 2, type: 'obstacle' },
      { x: 2, y: 9, type: 'obstacle' },
      { x: 4, y: 4, type: 'obstacle' },
      { x: 6, y: 7, type: 'obstacle' },
      { x: 8, y: 2, type: 'obstacle' },
      { x: 8, y: 9, type: 'obstacle' },
      { x: 10, y: 6, type: 'obstacle' },
    ],
  },
  {
    levelNumber: 5,
    width: 12,
    height: 12,
    muralText: '🏆 GRAND ARCHITECTURAL MURAL UNLOCKED! CONGRATS REDDIT COMMUNITY! 🏆',
    grid: [
      { x: 5, y: 0, type: 'start', direction: 'down' },
      { x: 6, y: 11, type: 'target', direction: 'up' },
      // Central blocks forcing extreme perimeter bounces
      { x: 5, y: 5, type: 'obstacle' },
      { x: 6, y: 5, type: 'obstacle' },
      { x: 5, y: 6, type: 'obstacle' },
      { x: 6, y: 6, type: 'obstacle' },
      { x: 3, y: 3, type: 'obstacle' },
      { x: 8, y: 3, type: 'obstacle' },
      { x: 3, y: 8, type: 'obstacle' },
      { x: 8, y: 8, type: 'obstacle' },
    ],
  },
];
