import './index.css';

import { StrictMode, useEffect, useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { navigateTo } from '@devvit/web/client';
import { PhaserGame } from './phaser/PhaserGame';
import { LevelConfig, MirrorType, GameState } from '../shared/types';
import { getLevelsForStage } from '../shared/levels';

const allLevels = [
  ...getLevelsForStage('easy'),
  ...getLevelsForStage('medium'),
  ...getLevelsForStage('hard'),
];

function getLevelDetails(index: number) {
  if (index <= 10) {
    return { stage: 'easy' as const, levelNumber: index };
  } else if (index <= 20) {
    return { stage: 'medium' as const, levelNumber: index - 10 };
  } else {
    return { stage: 'hard' as const, levelNumber: index - 20 };
  }
}

function isLevelCompleted(index: number, highestCompleted: Record<'easy' | 'medium' | 'hard', number> | undefined) {
  if (!highestCompleted) return false;
  const { stage, levelNumber } = getLevelDetails(index);
  return levelNumber <= highestCompleted[stage];
}

function isLevelUnlocked(index: number, highestCompleted: Record<'easy' | 'medium' | 'hard', number> | undefined) {
  if (index === 1) return true;
  if (!highestCompleted) return false;
  return isLevelCompleted(index - 1, highestCompleted);
}

function getActiveMapLevel(activeStage: 'easy' | 'medium' | 'hard', activeLevelNumber: number) {
  if (activeStage === 'easy') return activeLevelNumber;
  if (activeStage === 'medium') return activeLevelNumber + 10;
  return activeLevelNumber + 20;
}

interface LogEntry {
  username: string;
  action: string;
  x: number;
  y: number;
  timestamp: number;
}

export const App = () => {
  const [loading, setLoading] = useState(true);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [levels, setLevels] = useState<LevelConfig[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedMirror, setSelectedMirror] = useState<MirrorType | null>('/');
  const [selectedTool, setSelectedTool] = useState<'mirror' | 'prism' | 'erase'>('mirror');
  
  const [gameMode, setGameMode] = useState<'solo' | 'community'>('community');
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);
  const [resetCooldownSeconds, setResetCooldownSeconds] = useState<number>(0);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const lastUpdateRef = useRef<number>(0);

  const [viewMode, setViewMode] = useState<'mode-select' | 'map' | 'play'>('mode-select');
  const [levelJustSolved, setLevelJustSolved] = useState(false);
  const [solveType, setSolveType] = useState<'solved' | 'skipped'>('solved');
  const [completedLevelReward, setCompletedLevelReward] = useState<number>(1);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const mapScrollRef = useRef<HTMLDivElement>(null);

  // Fetch initial game state for selected mode
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/state?mode=${gameMode}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      
      setGameState(data.gameState);
      setLevels(data.levels);
      setLogs(data.logs);
      if (data.lastUpdate) {
        lastUpdateRef.current = data.lastUpdate;
      }
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch game state:', err);
      setLoading(false);
    }
  }, [gameMode]);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  useEffect(() => {
    if (viewMode === 'map' && mapScrollRef.current && gameState) {
      const { activeStage, activeLevelNumber } = gameState;
      const activeMapLevel = getActiveMapLevel(activeStage, activeLevelNumber);
      const activeY = (29 - (activeMapLevel - 1)) * 75 + 80;
      
      setTimeout(() => {
        if (mapScrollRef.current) {
          const containerHeight = mapScrollRef.current.clientHeight;
          mapScrollRef.current.scrollTo({
            top: activeY - containerHeight / 2,
            behavior: 'smooth',
          });
        }
      }, 100);
    }
  }, [viewMode, gameState]);

  // Polling for real-time updates in community mode
  useEffect(() => {
    if (gameMode !== 'community') return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/state-version');
        if (res.ok) {
          const data = await res.json();
          if (data.lastUpdate > lastUpdateRef.current) {
            // New updates on server, fetch the full state
            await fetchState();
          }
        }
      } catch (err) {
        console.error('Error polling state version:', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [gameMode, fetchState]);

  // Handle level/stage selection
  const handleSelectLevel = async (stage: 'easy' | 'medium' | 'hard', levelNum: number) => {
    try {
      const res = await fetch(`/api/select-level?mode=${gameMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, levelNumber: levelNum }),
      });

      if (!res.ok) {
        const errData = await res.json();
        triggerToast(`❌ ${errData.error || 'Failed to select level'}`);
        return;
      }

      const data = await res.json();
      setGameState(data.gameState);
      setLogs(data.logs);
      if (data.levels) {
        setLevels(data.levels);
      }
      if (data.lastUpdate) {
        lastUpdateRef.current = data.lastUpdate;
      }
      triggerToast(`🎯 Loaded ${stage.toUpperCase()} Level ${levelNum}`);
    } catch (err) {
      console.error('Failed to select level:', err);
      triggerToast('❌ Server error. Try again.');
    }
  };

  // Cooldown countdown timer effect (precision 100ms updates for 1s cooldown)
  useEffect(() => {
    if (!gameState?.cooldownUntil) {
      setCooldownSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      const diff = Math.max(0, (gameState.cooldownUntil! - Date.now()) / 1000);
      if (diff <= 0) {
        setCooldownSeconds(0);
        setGameState((prev) => prev ? { ...prev, cooldownUntil: null } : null);
        clearInterval(interval);
      } else {
        setCooldownSeconds(diff);
      }
    }, 100);

    const initialDiff = Math.max(0, (gameState.cooldownUntil - Date.now()) / 1000);
    setCooldownSeconds(initialDiff > 0 ? initialDiff : 0);

    return () => clearInterval(interval);
  }, [gameState?.cooldownUntil]);

  // Reset limit cooldown countdown timer effect
  useEffect(() => {
    if (!gameState?.refreshCooldownEnd) {
      setResetCooldownSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      const diff = Math.ceil((gameState.refreshCooldownEnd! - Date.now()) / 1000);
      if (diff <= 0) {
        setResetCooldownSeconds(0);
        setGameState((prev) => prev ? { ...prev, refreshCooldownEnd: null, refreshesRemaining: 3 } : null);
        clearInterval(interval);
      } else {
        setResetCooldownSeconds(diff);
      }
    }, 1000);

    const initialDiff = Math.ceil((gameState.refreshCooldownEnd - Date.now()) / 1000);
    setResetCooldownSeconds(initialDiff > 0 ? initialDiff : 0);

    return () => clearInterval(interval);
  }, [gameState?.refreshCooldownEnd]);

  // Toast handler
  const triggerToast = (msg: string) => {
    setErrorToast(msg);
    setTimeout(() => setErrorToast(null), 4000);
  };

  // Handle a user clicking a tile
  const handleMoveAttempt = async (
    x: number,
    y: number,
    mirrorType: MirrorType | null,
    placeType: 'mirror' | 'prism' = 'mirror'
  ) => {
    if (gameMode === 'community' && gameState?.cooldownUntil && Date.now() < gameState.cooldownUntil) {
      triggerToast('⚠️ Cooldown active! Wait for your next charge.');
      return;
    }

    // FCFS Check before fetch
    if (gameMode === 'community' && gameState?.activePlacer && gameState.username !== gameState.activePlacer) {
      triggerToast(`⚠️ Not your turn! Only ${gameState.activePlacer} can place mirrors/prisms right now.`);
      return;
    }

    try {
      const res = await fetch(`/api/make-move?mode=${gameMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y, mirrorType, placeType }),
      });

      if (res.status === 403) {
        const errData = await res.json();
        triggerToast(`⚠️ ${errData.error || 'Move rejected'}`);
        if (errData.cooldownUntil) {
          setGameState((prev) => 
            prev ? { ...prev, cooldownUntil: errData.cooldownUntil } : null
          );
        }
        return;
      }

      if (!res.ok) {
        const errData = await res.json();
        triggerToast(`❌ ${errData.error || 'Invalid move'}`);
        return;
      }

      const data = await res.json();
      
      // Update states
      setGameState(data.gameState);
      setLogs(data.logs);
      if (data.levels) {
        setLevels(data.levels);
      }
      if (data.lastUpdate) {
        lastUpdateRef.current = data.lastUpdate;
      }

      // Play success screen if level was solved
      if (data.levelSolved) {
        setSolveType('solved');
        if (gameState) {
          const completedLevelConfig = levels[gameState.activeLevelNumber - 1];
          setCompletedLevelReward(completedLevelConfig ? completedLevelConfig.reward : 1);
        }
        setLevelJustSolved(true);
      }

    } catch (err) {
      console.error('Failed to submit move:', err);
      triggerToast('❌ Server error. Try again.');
    }
  };



  const handleNextLevel = async () => {
    if (!gameState) return;
    setLevelJustSolved(false);

    const currentLvl = gameState.activeLevelNumber;
    const currentStage = gameState.activeStage;

    if (currentLvl === 10) {
      if (currentStage === 'easy') {
        await handleSelectLevel('medium', 1);
      } else if (currentStage === 'medium') {
        await handleSelectLevel('hard', 1);
      }
    } else {
      await handleSelectLevel(currentStage, currentLvl + 1);
    }
  };

  const handleMapNodeClick = (index: number) => {
    const isUnlocked = isLevelUnlocked(index, gameState?.highestCompleted);
    if (!isUnlocked) {
      triggerToast('🔒 Complete previous levels to unlock this node!');
      return;
    }
    
    const { stage, levelNumber } = getLevelDetails(index);
    void handleSelectLevel(stage, levelNumber);
    setViewMode('play');
  };

  const handleSkipLevel = async () => {
    if (!gameState) return;
    if (gameState.credits < 5) {
      triggerToast('❌ Insufficient credits! Cost: 5 LC.');
      return;
    }
    try {
      const res = await fetch(`/api/skip-level?mode=${gameMode}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const errData = await res.json();
        triggerToast(`❌ ${errData.error || 'Failed to skip level'}`);
        return;
      }
      const data = await res.json();
      setSolveType('skipped');
      setCompletedLevelReward(0);
      setGameState(data.gameState);
      setLogs(data.logs);
      if (data.levels) {
        setLevels(data.levels);
      }
      if (data.lastUpdate) {
        lastUpdateRef.current = data.lastUpdate;
      }
      triggerToast('⏩ Level skipped successfully!');
      if (data.stageCompleted) {
        setViewMode('map');
      } else {
        setLevelJustSolved(true);
      }
    } catch (err) {
      console.error('Failed to skip level:', err);
      triggerToast('❌ Server error');
    }
  };

  // Handle resetting current level
  const handleResetLevel = async () => {
    try {
      const res = await fetch(`/api/reset-board?mode=${gameMode}`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errData = await res.json();
        triggerToast(`❌ ${errData.error || 'Failed to reset level'}`);
        if (errData.cooldownRemainingMs) {
          setGameState((prev) => prev ? {
            ...prev,
            refreshCooldownEnd: Date.now() + errData.cooldownRemainingMs,
            refreshesRemaining: 0
          } : null);
        }
        return;
      }

      const data = await res.json();
      setGameState(data.gameState);
      setLogs(data.logs);
      if (data.levels) {
        setLevels(data.levels);
      }
      if (data.lastUpdate) {
        lastUpdateRef.current = data.lastUpdate;
      }
      triggerToast('🔄 Resetted all mirrors & prisms on current level!');
    } catch (err) {
      console.error('Failed to reset board:', err);
      triggerToast('❌ Server error. Try again.');
    }
  };

  // Handle joining placement queue
  const handleJoinQueue = async () => {
    try {
      const res = await fetch(`/api/join-queue?mode=${gameMode}`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errData = await res.json();
        triggerToast(`❌ ${errData.error || 'Failed to join queue'}`);
        return;
      }

      const data = await res.json();
      setGameState(data.gameState);
      triggerToast('🤝 Joined placement queue successfully!');
    } catch (err) {
      console.error('Failed to join queue:', err);
      triggerToast('❌ Server error');
    }
  };

  // Handle leaving placement queue
  const handleLeaveQueue = async () => {
    try {
      const res = await fetch(`/api/leave-queue?mode=${gameMode}`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errData = await res.json();
        triggerToast(`❌ ${errData.error || 'Failed to leave queue'}`);
        return;
      }

      const data = await res.json();
      setGameState(data.gameState);
      triggerToast('👋 Left placement queue');
    } catch (err) {
      console.error('Failed to leave queue:', err);
      triggerToast('❌ Server error');
    }
  };

  if (loading || !gameState) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0b0e14] text-white">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-pink-500 mb-4"></div>
        <p className="text-slate-400 font-mono">Connecting to Laser Grid...</p>
      </div>
    );
  }

  const currentLevelIndex = Math.min(gameState.level - 1, levels.length - 1);
  const currentConfig = (levels[currentLevelIndex] || levels[0]) as LevelConfig;
  const isGameCompleted = gameState.level > levels.length;

  return (
    <div className="h-screen w-full bg-[#0b0e14] text-slate-100 font-sans antialiased overflow-hidden">
      
      {/* Toast Alert */}
      {errorToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-red-500/50 text-red-200 px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 backdrop-blur-md animate-bounce">
          <span className="text-xl">⚠️</span>
          <span className="font-mono text-sm font-semibold">{errorToast}</span>
        </div>
      )}

      {/* Skip Confirmation Modal */}
      {showSkipConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center animate-fade-in">
          <div className="text-center p-8 bg-slate-900 border border-amber-500/40 rounded-3xl shadow-2xl max-w-sm mx-4 animate-scale-up relative overflow-hidden">
            <div className="absolute -inset-10 bg-amber-500/10 blur-3xl rounded-full pointer-events-none" />
            
            <span className="text-5xl mb-4 block animate-bounce">⚡</span>
            <h2 className="text-2xl font-extrabold text-amber-400 font-mono tracking-wider mb-2">
              CONFIRM SKIP
            </h2>
            
            <p className="text-slate-300 text-xs mb-6 leading-relaxed font-mono">
              Are you sure you want to bypass this sector grid?
              <br />
              This will spend <span className="text-amber-300 font-bold">5 Lux Credits</span>.
            </p>
            
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={async () => {
                  setShowSkipConfirm(false);
                  await handleSkipLevel();
                }}
                className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-mono text-xs font-extrabold py-2.5 rounded-xl cursor-pointer shadow-lg active:scale-95 transition-all"
              >
                YES, SKIP
              </button>
              <button
                onClick={() => setShowSkipConfirm(false)}
                className="bg-slate-800 border border-slate-700 hover:border-slate-650 text-slate-350 font-mono text-xs font-bold py-2.5 rounded-xl cursor-pointer transition-all active:scale-95"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Victory / Warp Modal */}
      {levelJustSolved && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center animate-fade-in">
          <div className="text-center p-8 bg-slate-900 border border-emerald-500/40 rounded-3xl shadow-2xl max-w-md mx-4 animate-scale-up relative overflow-hidden">
            <div className="absolute -inset-10 bg-emerald-500/10 blur-3xl rounded-full pointer-events-none" />
            
            {gameState.activeLevelNumber === 10 ? (
              <>
                <span className="text-6xl mb-4 block animate-bounce">🌌</span>
                <h2 className="text-2xl font-extrabold text-indigo-400 font-mono tracking-wider mb-2 uppercase">
                  Sector Completed!
                </h2>
                
                <p className="text-slate-300 text-xs mb-6 leading-relaxed font-mono">
                  {solveType === 'solved'
                    ? `Successfully secured the ${gameState.activeStage.toUpperCase()} Sector grid! Ready to warp.`
                    : `Bypassed the final sector lock.`
                  }
                  {solveType === 'solved' && (
                    <span className="text-amber-300 font-bold block mt-1.5">
                      Awarded +{completedLevelReward} Lux Credits!
                    </span>
                  )}
                </p>
                
                <div className="flex flex-col gap-3">
                  {gameState.activeStage !== 'hard' ? (
                    <button
                      onClick={handleNextLevel}
                      className="w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-600 hover:from-indigo-600 hover:via-purple-600 hover:to-pink-700 text-white font-mono text-sm font-extrabold py-3.5 rounded-xl cursor-pointer shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 animate-pulse"
                    >
                      🚀 WARP TO {gameState.activeStage === 'easy' ? 'MEDIUM' : 'HARD'} SECTOR
                    </button>
                  ) : (
                    <p className="text-pink-400 font-mono text-xs font-bold mb-2">
                      👑 Game Cleared! You've beaten all sectors!
                    </p>
                  )}
                  
                  <button
                    onClick={() => {
                      setLevelJustSolved(false);
                      setViewMode('map');
                    }}
                    className="w-full bg-slate-800 border border-slate-700 hover:border-slate-650 text-slate-350 font-mono text-sm font-bold py-3 rounded-xl cursor-pointer transition-all active:scale-95"
                  >
                    BACK TO MAP 🗺️
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="text-6xl mb-4 block animate-bounce">🌟</span>
                <h2 className="text-3xl font-extrabold text-emerald-400 font-mono tracking-wider mb-2">
                  {solveType === 'solved' ? 'LEVEL COMPLETED' : 'LEVEL SKIPPED'}
                </h2>
                
                <p className="text-slate-300 text-sm mb-6 leading-relaxed font-mono">
                  {solveType === 'solved'
                    ? `Successfully routed the laser grids! Awarded ` 
                    : `Spent 5 Lux Credits to bypass this sector grid.`
                  }
                  {solveType === 'solved' && (
                    <span className="text-amber-300 font-bold">
                      +{completedLevelReward} {completedLevelReward === 1 ? 'Lux Credit' : 'Lux Credits'}
                    </span>
                  )}
                </p>
                
                <div className="flex flex-col gap-3">
                  <button
                    onClick={handleNextLevel}
                    className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-mono text-sm font-extrabold py-3 rounded-xl cursor-pointer shadow-lg active:scale-95 transition-all"
                  >
                    NEXT LEVEL ➡️
                  </button>
                  
                  <button
                    onClick={() => {
                      setLevelJustSolved(false);
                      setViewMode('map');
                    }}
                    className="w-full bg-slate-800 border border-slate-700 hover:border-slate-650 text-slate-350 font-mono text-sm font-bold py-3 rounded-xl cursor-pointer transition-all active:scale-95"
                  >
                    BACK TO MAP 🗺️
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {viewMode === 'mode-select' ? (
        /* Render Mode Selection Page */
        <div className="flex flex-col h-screen w-full bg-gradient-to-b from-[#311166] via-[#10114c] to-[#040417] text-slate-100 font-sans antialiased overflow-hidden relative justify-center items-center px-6 select-none">
          
          {/* Glowing cosmic nebula overlay */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.28),transparent_70%),radial-gradient(circle_at_25%_35%,rgba(236,72,153,0.45),transparent_45%),radial-gradient(circle_at_75%_65%,rgba(34,211,238,0.45),transparent_45%)] pointer-events-none z-0" />
          
          {/* Rotating central neon triangle */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-80 z-0 animate-[spin_60s_linear_infinite] flex items-center justify-center" style={{ width: 440, height: 440 }}>
            <svg className="w-full h-full text-indigo-400 drop-shadow-[0_0_30px_rgba(99,102,241,0.6)]" viewBox="0 0 100 100" fill="none">
              <polygon points="50,10 90,85 10,85" stroke="currentColor" strokeWidth="2.5" />
              <polygon points="50,25 80,80 20,80" stroke="currentColor" strokeWidth="1.2" opacity="0.8" />
            </svg>
          </div>

          {/* Glowing particle stars */}
          {Array.from({ length: 30 }).map((_, idx) => {
            const size = (idx % 3) + 1.5;
            const color = idx % 3 === 0 ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]' : (idx % 3 === 1 ? 'bg-pink-500 shadow-[0_0_8px_#ec4899]' : 'bg-blue-400 shadow-[0_0_8px_#60a5fa]');
            const top = (idx * 79) % 100;
            const left = (idx * 23) % 100;
            const animDelay = `${(idx * 0.2).toFixed(1)}s`;
            return (
              <div
                key={`star-select-${idx}`}
                className={`absolute rounded-full ${color} animate-pulse pointer-events-none z-0`}
                style={{
                  width: size,
                  height: size,
                  top: `${top}%`,
                  left: `${left}%`,
                  opacity: 0.5,
                  animationDelay: animDelay,
                  animationDuration: '3s'
                }}
              />
            );
          })}

          {/* 40 Sparkling White Stars (large & bright) */}
          {Array.from({ length: 40 }).map((_, idx) => {
            const size = (idx % 2 === 0) ? 2.0 : 3.0;
            const top = (idx * 13) % 100;
            const left = (idx * 67) % 100;
            const opacity = 0.5 + ((idx * 5) % 5) * 0.12;
            const animDelay = `${((idx * 0.25) % 3).toFixed(2)}s`;
            return (
              <div
                key={`white-star-select-${idx}`}
                className="absolute rounded-full bg-white shadow-[0_0_6px_#fff] animate-pulse pointer-events-none z-0"
                style={{
                  width: size,
                  height: size,
                  top: `${top}%`,
                  left: `${left}%`,
                  opacity,
                  animationDelay: animDelay,
                  animationDuration: '3.5s'
                }}
              />
            );
          })}

          <div className="flex flex-col items-center text-center max-w-2xl gap-3 z-10 mb-12">
            <h1 className="text-4xl md:text-5xl font-extrabold font-mono tracking-wider bg-gradient-to-r from-blue-400 via-pink-400 to-purple-500 bg-clip-text text-transparent drop-shadow-[0_0_20px_rgba(236,72,153,0.35)] animate-pulse">
              QUANTUM SECTOR GATEWAY
            </h1>
            <p className="text-xs uppercase font-mono tracking-widest text-slate-400 font-bold">
              Select your optic grid connection vector
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl z-10 px-4">
            
            {/* Community Gateway Card */}
            <button
              onClick={async () => {
                setGameMode('community');
                setViewMode('map');
              }}
              className="group text-left bg-slate-900/60 border border-slate-800 hover:border-pink-500/50 p-6 rounded-3xl cursor-pointer transition-all duration-300 active:scale-98 shadow-2xl backdrop-blur-md flex flex-col justify-between h-[230px] hover:shadow-[0_0_30px_rgba(236,72,153,0.15)] relative overflow-hidden"
            >
              <div className="absolute -right-10 -bottom-10 h-32 w-32 bg-pink-500/10 rounded-full blur-3xl pointer-events-none group-hover:bg-pink-500/20 transition-all" />
              <div className="flex flex-col gap-3">
                <div className="h-12 w-12 rounded-xl bg-pink-500/15 border border-pink-500/30 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform shadow-inner">
                  👥
                </div>
                <h2 className="text-lg font-bold font-mono text-white group-hover:text-pink-300 transition-colors tracking-wide uppercase">
                  Community Gateway
                </h2>
                <p className="text-slate-400 text-xs font-mono leading-relaxed mt-1 leading-5 font-medium">
                  Collaborate in real-time on a shared optic grid. Work with other Redditors to solve sectors together. Cooldowns are active.
                </p>
              </div>
              <span className="text-[10px] font-bold font-mono text-pink-400 group-hover:translate-x-1.5 transition-transform flex items-center gap-1.5 mt-4 uppercase tracking-wider">
                ENTER NETWORK 👥 ➡️
              </span>
            </button>

            {/* Solo Gateway Card */}
            <button
              onClick={async () => {
                setGameMode('solo');
                setViewMode('map');
              }}
              className="group text-left bg-slate-900/60 border border-slate-800 hover:border-blue-500/50 p-6 rounded-3xl cursor-pointer transition-all duration-300 active:scale-98 shadow-2xl backdrop-blur-md flex flex-col justify-between h-[230px] hover:shadow-[0_0_30px_rgba(59,130,246,0.15)] relative overflow-hidden"
            >
              <div className="absolute -right-10 -bottom-10 h-32 w-32 bg-blue-500/10 rounded-full blur-3xl pointer-events-none group-hover:bg-blue-500/20 transition-all" />
              <div className="flex flex-col gap-3">
                <div className="h-12 w-12 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform shadow-inner">
                  🛰️
                </div>
                <h2 className="text-lg font-bold font-mono text-white group-hover:text-blue-300 transition-colors tracking-wide uppercase">
                  Solo Simulator
                </h2>
                <p className="text-slate-400 text-xs font-mono leading-relaxed mt-1 leading-5 font-medium">
                  Deploy a private sandbox. Complete puzzles at your own pace with independent states. Ideal for practice and testing paths.
                </p>
              </div>
              <span className="text-[10px] font-bold font-mono text-blue-400 group-hover:translate-x-1.5 transition-transform flex items-center gap-1.5 mt-4 uppercase tracking-wider">
                INITIALIZE SIMULATOR 🛰️ ➡️
              </span>
            </button>

          </div>

          <footer className="absolute bottom-6 left-0 right-0 flex flex-col items-center justify-center gap-1.5 text-[9px] font-mono text-slate-500 z-10">
            <span>Establishing connection for: {gameState.username}</span>
            <span className="text-[8px] opacity-75">Cooperative Optical Refraction Grid Systems v1.0</span>
          </footer>

        </div>
      ) : viewMode === 'map' ? (
        /* Render Map View */
        <div className="flex flex-col h-screen w-full bg-gradient-to-b from-[#311166] via-[#10114c] to-[#040417] text-slate-100 font-sans antialiased overflow-hidden relative">
          
          {/* Glowing colorful radial nebula overlay (super vibrant) */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.25),transparent_70%),radial-gradient(circle_at_25%_35%,rgba(236,72,153,0.38),transparent_45%),radial-gradient(circle_at_75%_65%,rgba(34,211,238,0.38),transparent_45%)] pointer-events-none" />

          {/* A single central glowing neon triangle rotating stationary in background viewport center */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-80 z-0 animate-[spin_50s_linear_infinite] flex items-center justify-center" style={{ width: 460, height: 460 }}>
            <svg className="w-full h-full text-cyan-400 drop-shadow-[0_0_30px_rgba(34,211,238,0.95)]" viewBox="0 0 100 100" fill="none">
              <polygon points="50,10 90,85 10,85" stroke="currentColor" strokeWidth="3" filter="url(#glow-beam)" />
              <polygon points="50,25 80,80 20,80" stroke="currentColor" strokeWidth="1.5" opacity="0.75" />
              <polygon points="50,40 70,75 30,75" stroke="currentColor" strokeWidth="1" opacity="0.5" />
            </svg>
          </div>

          {/* Glowing particle stars (cyan, pink, blue) */}
          {Array.from({ length: 60 }).map((_, idx) => {
            const size = (idx % 3) + 1.5;
            const color = idx % 3 === 0 ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]' : (idx % 3 === 1 ? 'bg-pink-500 shadow-[0_0_8px_#ec4899]' : 'bg-blue-400 shadow-[0_0_8px_#60a5fa]');
            const top = (idx * 97) % 2350;
            const left = (idx * 23) % 100;
            const opacity = 0.35 + ((idx * 7) % 7) * 0.1;
            const animDelay = `${(idx * 0.3).toFixed(1)}s`;
            return (
              <div
                key={`star-${idx}`}
                className={`absolute rounded-full ${color} animate-pulse pointer-events-none z-0`}
                style={{
                  width: size,
                  height: size,
                  top: top,
                  left: `${left}%`,
                  opacity,
                  animationDelay: animDelay,
                  animationDuration: '3s'
                }}
              />
            );
          })}

          {/* 40 Sparkling White Stars (large & bright) */}
          {Array.from({ length: 40 }).map((_, idx) => {
            const size = (idx % 2 === 0) ? 2.0 : 3.0;
            const top = (idx * 113) % 2350;
            const left = (idx * 67) % 100;
            const opacity = 0.5 + ((idx * 5) % 5) * 0.12;
            const animDelay = `${((idx * 0.25) % 3).toFixed(2)}s`;
            return (
              <div
                key={`white-star-${idx}`}
                className="absolute rounded-full bg-white shadow-[0_0_6px_#fff] animate-pulse pointer-events-none z-0"
                style={{
                  width: size,
                  height: size,
                  top: top,
                  left: `${left}%`,
                  opacity,
                  animationDelay: animDelay,
                  animationDuration: '3.5s'
                }}
              />
            );
          })}

          {/* 60 Small Background White Stars (sparkling dust) */}
          {Array.from({ length: 60 }).map((_, idx) => {
            const top = (idx * 137) % 2350;
            const left = (idx * 43) % 100;
            const opacity = 0.25 + ((idx * 3) % 4) * 0.1;
            const animDelay = `${((idx * 0.15) % 2).toFixed(2)}s`;
            return (
              <div
                key={`star-dust-${idx}`}
                className="absolute rounded-full bg-slate-100 shadow-[0_0_3px_#cbd5e1] animate-pulse pointer-events-none z-0"
                style={{
                  width: 1,
                  height: 1,
                  top: top,
                  left: `${left}%`,
                  opacity,
                  animationDelay: animDelay,
                  animationDuration: '4.5s'
                }}
              />
            );
          })}

          {/* Background Speed Light Rays (very vibrant) */}
          {Array.from({ length: 35 }).map((_, idx) => {
            const rotation = (idx * 12) % 360;
            const length = 120 + ((idx * 31) % 150);
            const delay = `${((idx * 0.4) % 4).toFixed(1)}s`;
            const top = (idx * 97) % 2350;
            const left = (idx * 59) % 100;
            const isCyan = idx % 2 === 0;
            
            return (
              <div
                key={`ray-${idx}`}
                className={`absolute opacity-40 pointer-events-none rounded-full z-0 ${
                  isCyan 
                    ? 'bg-gradient-to-r from-cyan-400/90 via-cyan-300/35 to-transparent' 
                    : 'bg-gradient-to-r from-pink-400/90 via-pink-300/35 to-transparent'
                }`}
                style={{
                  width: length,
                  height: '2px',
                  top: top,
                  left: `${left}%`,
                  transform: `rotate(${rotation}deg)`,
                  animation: 'pulse 4s infinite ease-in-out',
                  animationDelay: delay,
                }}
              />
            );
          })}

          <div className="w-full max-w-5xl mx-auto px-6 py-4 flex flex-col md:flex-row items-center justify-between border-b border-slate-900 bg-slate-950/80 backdrop-blur-md z-30 gap-4">
            <div>
              <h1 className="text-2xl font-extrabold font-mono bg-gradient-to-r from-blue-400 via-pink-400 to-purple-500 bg-clip-text text-transparent tracking-wide">
                LASER DEFLECT NETWORK
              </h1>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Select an unlocked data node to route the optic beam
              </p>
            </div>
            
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-xl shadow-md">
                <button
                  onClick={() => setGameMode('community')}
                  className={"px-4 py-2 font-mono text-xs font-bold rounded-lg cursor-pointer transition-all " + (
                    gameMode === 'community'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  )}
                >
                  Community Map
                </button>
                <button
                  onClick={() => setGameMode('solo')}
                  className={"px-4 py-2 font-mono text-xs font-bold rounded-lg cursor-pointer transition-all " + (
                    gameMode === 'solo'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  )}
                >
                  Solo Map
                </button>
              </div>

              {gameMode === 'community' && (
                <span className="bg-slate-900 border border-slate-800 text-blue-400 font-mono text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-1.5 shadow-sm">
                  <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                  {gameState.onlineCount} Online
                </span>
              )}

              <span className="bg-slate-800 border border-slate-700 text-slate-300 font-mono text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-1.5 shadow-md">
                🪙 {gameState.credits} LC
              </span>

              <button
                className="bg-slate-850 hover:bg-slate-800 border border-slate-750 text-slate-300 font-mono text-xs font-bold px-3.5 py-2 rounded-lg transition-all cursor-pointer active:scale-95"
                onClick={() => setViewMode('mode-select')}
              >
                🌌 Gateway Select
              </button>

            </div>
          </div>

          <div className="flex-1 overflow-y-auto relative py-16 scrollbar-thin" ref={mapScrollRef}>
            <div className="w-full max-w-[480px] h-[2350px] relative mx-auto">
              
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 2350" preserveAspectRatio="none">
                <defs>
                  <filter id="glow-beam" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="6" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                
                {Array.from({ length: 29 }).map((_, i) => {
                  const x1 = 50 + 38 * Math.sin(i * 1.2);
                  const y1 = (29 - i) * 75 + 80;
                  const x2 = 50 + 38 * Math.sin((i + 1) * 1.2);
                  const y2 = (29 - (i + 1)) * 75 + 80;
                  
                  const isSegmentActive = isLevelCompleted(i + 1, gameState.highestCompleted);
                  
                  return (
                    <g key={i}>
                      {isSegmentActive && (
                        <line
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          stroke="#60a5fa"
                          strokeWidth="6"
                          strokeLinecap="round"
                          opacity="0.85"
                          filter="url(#glow-beam)"
                        />
                      )}
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={isSegmentActive ? '#93c5fd' : '#1e293b'}
                        strokeWidth={isSegmentActive ? '3.0' : '1.5'}
                        strokeLinecap="round"
                        strokeDasharray={isSegmentActive ? undefined : '4,4'}
                        opacity={isSegmentActive ? '0.95' : '0.4'}
                      />
                    </g>
                  );
                })}
              </svg>

              <div className="absolute left-1/2 -translate-x-1/2 font-mono text-[10px] font-bold text-slate-400 bg-slate-950 border border-slate-900 px-4 py-1.5 rounded-full tracking-widest pointer-events-none select-none z-10" style={{ top: 2240 }}>
                🟢 EASY SECTOR: CORE INITIATION
              </div>

              <div className="absolute left-0 right-0 flex items-center justify-center pointer-events-none z-10" style={{ top: 1550 }}>
                <div className="w-full h-[1px] bg-slate-800/80 relative flex items-center justify-center">
                  <span className="font-mono text-[10px] font-bold text-blue-400 bg-[#0b0e14] px-4 py-1 border border-blue-500/20 rounded-full tracking-widest">
                    🔵 MEDIUM SECTOR: NEBULA DEFLECTORS
                  </span>
                </div>
              </div>

              <div className="absolute left-0 right-0 flex items-center justify-center pointer-events-none z-10" style={{ top: 800 }}>
                <div className="w-full h-[1px] bg-slate-800/80 relative flex items-center justify-center">
                  <span className="font-mono text-[10px] font-bold text-pink-400 bg-[#0b0e14] px-4 py-1 border border-pink-500/20 rounded-full tracking-widest">
                    🔴 HARD SECTOR: QUANTUM PORTALS
                  </span>
                </div>
              </div>

              {Array.from({ length: 30 }).map((_, i) => {
                const levelIdx = i + 1;
                const { stage } = getLevelDetails(levelIdx);
                const isCompleted = isLevelCompleted(levelIdx, gameState.highestCompleted);
                const isUnlocked = isLevelUnlocked(levelIdx, gameState.highestCompleted);
                const isCurrent = getActiveMapLevel(gameState.activeStage, gameState.activeLevelNumber) === levelIdx;
                
                const x = 50 + 38 * Math.sin(i * 1.2);
                const y = (29 - i) * 75 + 80;
                
                const levelConfig = allLevels[i]!;

                return (
                  <div
                    key={levelIdx}
                    className="absolute -translate-x-1/2 -translate-y-1/2 group z-20"
                    style={{ left: `${x}%`, top: y }}
                  >
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3.5 w-52 bg-slate-955 border border-slate-800 p-3 rounded-2xl shadow-2xl opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-all duration-200 z-30 scale-90 group-hover:scale-100 select-none">
                      <div className="flex flex-col gap-1.5 text-[10px] font-mono">
                        <div className="flex justify-between items-center border-b border-slate-900 pb-1.5">
                          <span className="text-slate-400 capitalize font-bold">Lvl {levelIdx}: {stage}</span>
                          <span className="bg-slate-905 text-slate-450 px-1.5 py-0.5 rounded text-[8px] border border-slate-800 uppercase font-semibold">
                            {levelConfig.difficulty}
                          </span>
                        </div>
                        <p className="text-[9px] text-slate-500 italic leading-snug mt-1 font-medium">
                          {isCompleted ? '✓ Decrypted node data' : (isUnlocked ? '⚡ Ready to deflect beam' : '🔒 Node database locked')}
                        </p>
                        {isUnlocked && (
                          <p className="text-cyan-400 font-semibold truncate text-[9px] py-1 border-t border-b border-slate-900/50 my-0.5" title={levelConfig.muralText}>
                            {levelConfig.muralText.substring(2)}
                          </p>
                        )}
                        <div className="flex justify-between items-center text-[9px] text-amber-400 font-extrabold mt-1">
                          <span>Reward:</span>
                          <span>🪙 {levelConfig.reward} LC</span>
                        </div>
                        {isUnlocked && (
                          <div className="text-[8px] text-center text-blue-400 font-bold mt-2 border border-blue-500/20 bg-blue-500/5 rounded py-1 uppercase tracking-wider">
                            Click to play
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => handleMapNodeClick(levelIdx)}
                      className={`w-14 h-14 rounded-full border-2 flex flex-col items-center justify-center font-mono text-xs font-bold transition-all relative ${
                        isCurrent
                          ? 'border-pink-300 bg-gradient-to-br from-pink-500 via-purple-600 to-indigo-800 text-white shadow-[0_0_25px_rgba(236,72,153,0.95),0_0_10px_rgba(168,85,247,0.7)] scale-110 animate-pulse cursor-pointer z-10'
                          : isCompleted
                          ? 'border-emerald-300 bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-[0_0_18px_rgba(16,185,129,0.65),0_0_8px_rgba(20,184,166,0.4)] hover:scale-105 cursor-pointer'
                          : isUnlocked
                          ? 'border-blue-300 bg-gradient-to-br from-blue-600 to-indigo-700 text-white hover:scale-105 cursor-pointer shadow-[0_0_18px_rgba(59,130,246,0.65),0_0_8px_rgba(99,102,241,0.4)]'
                          : 'border-slate-800 bg-slate-900/90 text-slate-655 cursor-not-allowed'
                      }`}
                    >
                      <span className="text-[11px]">{levelIdx}</span>
                      {isCompleted && (
                        <span className="text-[8px] font-extrabold text-emerald-200 mt-0.5">✓</span>
                      )}
                      {!isUnlocked && (
                        <span className="text-[9px] mt-0.5">🔒</span>
                      )}
                    </button>
                  </div>
                );
              })}

            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row h-full overflow-hidden">
          <div className="flex-1 flex flex-col p-3 md:p-4 lg:p-6 justify-center items-center min-h-0 w-full">
            <div className="w-full max-w-3xl flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-4">
              <div>
                <h1 className="text-2xl md:text-3xl font-extrabold font-mono bg-gradient-to-r from-blue-400 via-pink-400 to-purple-500 bg-clip-text text-transparent tracking-wide">
                  LASER DEFLECT
                </h1>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Cooperative optic network grid • Subreddit sandbox
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setViewMode('map')}
                  className="bg-slate-900 border border-slate-700/80 hover:border-slate-500 text-slate-355 font-mono text-xs font-bold px-4 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 shadow-md active:scale-95"
                >
                  🗺️ Map View
                </button>

                {gameMode === 'community' && (
                  <span className="bg-slate-900/80 border border-slate-800 text-blue-400 font-mono text-[10px] font-bold px-2 py-1.5 rounded-lg flex items-center gap-1 shadow-sm">
                    <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                    {gameState.onlineCount} Online
                  </span>
                )}

                <span className="bg-slate-800/80 border border-slate-700 text-slate-300 font-mono text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-md">
                  <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse"></span>
                  {gameState.username}
                </span>
                
                {gameState.targetsHit ? (
                  <button
                    className="bg-gradient-to-r from-emerald-500 to-teal-600 border border-emerald-400/40 hover:from-emerald-600 hover:to-teal-700 text-white font-mono text-xs font-extrabold px-3.5 py-1.5 rounded-lg transition-all active:scale-95 cursor-pointer shadow-lg animate-pulse"
                    onClick={handleNextLevel}
                  >
                    ➡️ Next Level
                  </button>
                ) : (
                  <button
                    className="bg-slate-850 border border-blue-900/50 hover:border-blue-500 text-blue-300 font-mono text-xs font-bold px-3.5 py-1.5 rounded-lg transition-all hover:bg-slate-800 active:scale-95 cursor-pointer shadow-md"
                    onClick={() => setShowSkipConfirm(true)}
                  >
                    ⏩ Skip Level (5 LC)
                  </button>
                )}
              </div>
            </div>

            <div className="w-full max-w-3xl flex-1 flex items-center justify-center relative min-h-[350px] md:min-h-[400px]">
              {isGameCompleted ? (
                <div className="text-center p-8 bg-slate-900/60 border border-pink-500/30 rounded-2xl max-w-md w-full shadow-2xl backdrop-blur-sm">
                  <span className="text-7xl mb-4 block">👑</span>
                  <h2 className="text-2xl font-extrabold font-mono text-pink-400 mb-2">GRID CLEARED</h2>
                  <p className="text-slate-350 text-sm font-mono leading-relaxed mb-6">
                    Excellent coordination! You successfully routed the laser grids and fully revealed the secret mural.
                  </p>
                  <div className="bg-slate-950 p-4 border border-pink-500/20 rounded-xl mb-4 font-mono text-xs leading-5 select-all overflow-x-auto whitespace-pre">
                    {allLevels.map((lvl) => lvl.muralText).join('\n')}
                  </div>
                  <button
                    onClick={() => setViewMode('map')}
                    className="bg-slate-850 hover:bg-slate-750 text-slate-200 border border-slate-700 font-mono text-sm font-bold py-2.5 px-6 rounded-xl cursor-pointer transition-all"
                  >
                    Return to Map 🗺️
                  </button>
                </div>
              ) : (
                <div className="absolute inset-0">
                  <PhaserGame
                    levelConfig={currentConfig}
                    placedMirrors={gameState.placedMirrors}
                    placedPrisms={gameState.placedPrisms}
                    selectedMirrorType={selectedMirror}
                    selectedTool={selectedTool}
                    cooldownActive={cooldownSeconds > 0}
                    onMoveAttempt={handleMoveAttempt}
                  />
                  
                  <div className="absolute top-3 left-3 bg-slate-900/90 border border-slate-700 px-3 py-1.5 rounded-lg font-mono text-xs font-bold text-blue-400 pointer-events-none select-none shadow-lg flex items-center gap-2">
                    <span className="capitalize">{gameState.activeStage}</span>
                    <span>LEVEL {gameState.activeLevelNumber} / 10</span>
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-medium">
                      {currentConfig.difficulty}
                    </span>
                  </div>

                  {gameState.targetsHit && (
                    <div className="absolute bottom-3 right-3 bg-green-500/20 border border-green-500 text-green-300 px-3 py-1.5 rounded-lg font-mono text-xs font-bold pointer-events-none select-none shadow-lg animate-pulse">
                      ✅ STABLE BEAM DETECTED
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="w-full lg:w-96 bg-[#0e121a] border-t lg:border-t-0 lg:border-l border-slate-800 p-4 flex flex-col gap-3.5 select-none shrink-0 overflow-y-auto h-full">
            
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3 flex flex-col gap-3 shadow-md">
              <div className="flex justify-between items-center border-b border-slate-800/60 pb-1.5">
                <h2 className="text-xs font-extrabold font-mono text-slate-400 uppercase tracking-widest">
                  Active Node Details
                </h2>
                <span className="bg-pink-500/10 border border-pink-500/35 text-pink-400 font-mono text-[9px] font-extrabold px-1.5 py-0.5 rounded shadow-inner uppercase">
                  {currentConfig.difficulty}
                </span>
              </div>
              
              <div className="flex flex-col gap-1.5 font-mono">
                <div className="flex items-center justify-between text-xs font-bold text-slate-200">
                  <span className="uppercase">{gameState.activeStage} Level {gameState.activeLevelNumber}</span>
                  <span className="text-amber-400">🪙 {currentConfig.reward} LC</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed italic mt-1 bg-slate-950 p-2.5 border border-slate-900 rounded-lg select-text font-semibold">
                  {currentConfig.muralText}
                </p>
              </div>

              <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono px-0.5 border-t border-slate-800/60 pt-2">
                <span>Your Balance:</span>
                <span className="text-amber-400 font-bold">🪙 {gameState.credits} LC</span>
              </div>

              <button
                onClick={() => setViewMode('map')}
                className="w-full flex items-center justify-center gap-2 border border-slate-700 bg-slate-950 hover:bg-slate-900 hover:border-slate-500 text-slate-355 font-mono text-xs font-bold py-2 px-3 rounded-lg transition-all cursor-pointer active:scale-95"
              >
                🗺️ View Full Map Path
              </button>
            </div>

            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3 flex flex-col gap-2 shadow-md">
              <h2 className="text-xs font-extrabold font-mono text-slate-400 uppercase tracking-widest">
                Reflection Inventory
              </h2>
              <div className="grid grid-cols-3 gap-2">
                
                <button
                  onClick={() => {
                    setSelectedTool('mirror');
                    setSelectedMirror('/');
                  }}
                  className={`flex flex-col items-center justify-center p-2.5 rounded-xl border font-mono text-xs font-bold cursor-pointer transition-all hover:bg-slate-800 ${
                    selectedTool === 'mirror' && selectedMirror === '/'
                      ? 'border-pink-500 bg-pink-500/10 text-pink-300 shadow-[0_0_10px_rgba(236,72,153,0.15)]'
                      : 'border-slate-800 bg-slate-950 text-slate-450 hover:text-slate-200'
                  }`}
                >
                  <svg className="w-6 h-6 mb-1" viewBox="0 0 32 32" fill="none">
                    <line x1="8" y1="24" x2="24" y2="8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                  </svg>
                  <span>Mirror (/)</span>
                </button>

                <button
                  onClick={() => {
                    setSelectedTool('mirror');
                    setSelectedMirror('\\');
                  }}
                  className={`flex flex-col items-center justify-center p-2.5 rounded-xl border font-mono text-xs font-bold cursor-pointer transition-all hover:bg-slate-800 ${
                    selectedTool === 'mirror' && selectedMirror === '\\'
                      ? 'border-pink-500 bg-pink-500/10 text-pink-300 shadow-[0_0_10px_rgba(236,72,153,0.15)]'
                      : 'border-slate-800 bg-slate-950 text-slate-455 hover:text-slate-200'
                  }`}
                >
                  <svg className="w-6 h-6 mb-1" viewBox="0 0 32 32" fill="none">
                    <line x1="8" y1="8" x2="24" y2="24" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                  </svg>
                  <span>Mirror (\\)</span>
                </button>

                <button
                  onClick={() => {
                    setSelectedTool('erase');
                    setSelectedMirror(null);
                  }}
                  className={`flex flex-col items-center justify-center p-2.5 rounded-xl border font-mono text-xs font-bold cursor-pointer transition-all hover:bg-slate-800 ${
                    selectedTool === 'erase'
                      ? 'border-red-500 bg-red-500/10 text-red-300 shadow-[0_0_10px_rgba(239,68,68,0.15)]'
                      : 'border-slate-800 bg-slate-950 text-slate-455 hover:text-slate-200'
                  }`}
                >
                  <svg className="w-6 h-6 mb-1" viewBox="0 0 32 32" fill="none">
                    <rect x="6" y="6" width="20" height="20" rx="3" stroke="currentColor" strokeWidth="3" />
                    <line x1="6" y1="6" x2="26" y2="26" stroke="currentColor" strokeWidth="3" />
                  </svg>
                  <span>Erase</span>
                </button>

              </div>
              <p className="text-[10px] text-slate-555 font-mono text-center leading-4 mt-1">
                Choose a tool, then hover the board to preview its projection, and click to apply!
              </p>
            </div>

            {gameMode === 'community' && (
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3 flex flex-col gap-2 shadow-md animate-fade-in">
                <div className="flex justify-between items-center border-b border-slate-800/60 pb-2">
                  <h2 className="text-xs font-extrabold font-mono text-slate-400 uppercase tracking-widest">
                    Optic Placement Queue
                  </h2>
                  <span className="bg-blue-500/15 border border-blue-500/30 text-blue-300 font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-md">
                    FCFS Turn
                  </span>
                </div>

                {gameState.activePlacer ? (
                  <div className="flex items-center gap-2 bg-blue-955/40 border border-blue-900/30 p-2.5 rounded-lg text-xs font-mono">
                    <span className="text-lg">🎯</span>
                    <div className="flex flex-col">
                      <span className="text-[9px] text-slate-400 font-bold uppercase">Active Placer</span>
                      <span className="font-extrabold text-blue-300">
                        {gameState.activePlacer === gameState.username ? 'You (Your Turn!)' : gameState.activePlacer}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-center italic text-xs text-slate-500 py-2 font-mono">
                    Queue empty. Join to place mirrors!
                  </div>
                )}

                {gameState.queue.length > 0 && (
                  <div className="flex flex-col gap-1 max-h-[100px] overflow-y-auto bg-slate-955/40 p-1.5 rounded-lg border border-slate-850">
                    {gameState.queue.map((name, index) => (
                      <div key={index} className="flex justify-between items-center font-mono text-[10px] text-slate-350 p-0.5 border-b border-slate-900 last:border-0">
                        <span className="flex items-center gap-1.5">
                          <span className="text-slate-500">#{index + 1}</span>
                          <span className={name === gameState.username ? 'text-pink-400 font-bold' : (index === 0 ? 'text-blue-400 font-bold' : '')}>
                            {name === gameState.username ? 'You' : name}
                          </span>
                        </span>
                        {index === 0 && <span className="bg-blue-500 text-slate-955 font-extrabold text-[8px] px-1 rounded">TURN</span>}
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    onClick={handleJoinQueue}
                    disabled={gameState.queue.includes(gameState.username)}
                    className={`font-mono text-[10px] font-extrabold py-2 rounded-lg transition-all cursor-pointer ${
                      !gameState.queue.includes(gameState.username)
                        ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/20'
                    }`}
                  >
                    Join Queue
                  </button>
                  <button
                    onClick={handleLeaveQueue}
                    disabled={!gameState.queue.includes(gameState.username)}
                    className={`font-mono text-[10px] font-extrabold py-2 rounded-lg transition-all cursor-pointer ${
                      gameState.queue.includes(gameState.username)
                        ? 'bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-300 shadow-md'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/20'
                    }`}
                  >
                    Leave Queue
                  </button>
                </div>
              </div>
            )}

            {/* Deflect Power Charge */}
            {(
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3 flex flex-col gap-2 shadow-md">
                <h2 className="text-xs font-extrabold font-mono text-slate-400 uppercase tracking-widest">
                  Deflect Power Charge
                </h2>
                
                {cooldownSeconds > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center text-xs font-mono font-bold">
                      <span className="text-red-400">⚡ RECHARGING BEAM</span>
                      <span className="text-slate-355">
                        {cooldownSeconds}s
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-955 rounded-full overflow-hidden border border-slate-800">
                      <div 
                        className="h-full bg-gradient-to-r from-red-500 to-pink-500 transition-all duration-100" 
                        style={{ width: `${Math.max(0, Math.min(100, (cooldownSeconds / 1.0) * 100))}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-500 font-mono leading-relaxed mt-0.5">
                      Every player can make only 1 move every 1 second.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-green-400 border border-green-500/20 bg-green-500/5 p-3 rounded-lg">
                    <span className="text-2xl animate-pulse">⚡</span>
                    <div className="flex flex-col">
                      <span className="font-mono text-xs font-bold">CHARGE COMPLETE</span>
                      <span className="text-[10px] text-slate-400 font-mono mt-0.5">You are authorized to place 1 mirror or prism.</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3 flex flex-col gap-2 shadow-md">
              <h2 className="text-xs font-extrabold font-mono text-slate-400 uppercase tracking-widest">
                Grid Actions
              </h2>
              
              <button
                onClick={handleResetLevel}
                disabled={resetCooldownSeconds > 0 && gameState.refreshesRemaining === 0}
                className={`w-full flex items-center justify-center gap-2 border font-mono text-xs font-bold py-1.5 px-3 rounded-lg transition-all cursor-pointer ${
                  resetCooldownSeconds > 0 && gameState.refreshesRemaining === 0
                    ? 'border-red-900/50 bg-red-955/20 text-red-500 cursor-not-allowed'
                    : 'border-red-500/40 bg-red-500/5 hover:bg-red-500/10 text-red-300 hover:border-red-500 active:scale-95'
                }`}
              >
                🔄 Reset Board Elements
              </button>

              <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono px-0.5">
                <span>Remaining Resets:</span>
                <span className={gameState.refreshesRemaining === 0 ? 'text-red-400 font-bold' : 'text-slate-300 font-bold'}>
                  {gameState.refreshesRemaining} / 3
                </span>
              </div>

              {resetCooldownSeconds > 0 && (
                <div className="text-[10px] font-mono text-red-400 text-center leading-relaxed bg-red-955/20 border border-red-900/30 p-2 rounded-lg">
                  ⏱️ Resets limit reached! Cooldown expires in:{' '}
                  <span className="font-bold">
                    {Math.floor(resetCooldownSeconds / 60)}m {resetCooldownSeconds % 60}s
                  </span>
                </div>
              )}
            </div>

            <div className="flex-1 min-h-[140px] bg-slate-900/40 border border-slate-800 rounded-xl p-3 flex flex-col gap-2 shadow-md overflow-hidden">
              <h2 className="text-xs font-extrabold font-mono text-slate-400 uppercase tracking-widest">
                Recent Network Edits
              </h2>
              <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-1.5 font-mono text-[10px] leading-relaxed">
                {logs.length === 0 ? (
                  <p className="text-slate-600 italic text-center py-4">No entries in the grid feed.</p>
                ) : (
                  logs.map((log, index) => {
                    const formattedTime = new Date(log.timestamp).toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    });
                    return (
                      <div key={index} className="border-b border-slate-800/40 pb-1.5 flex flex-col gap-0.5">
                        <div className="flex justify-between items-center text-[9px] text-slate-500">
                          <span className="font-bold text-slate-400">{log.username}</span>
                          <span>{formattedTime}</span>
                        </div>
                        <span className="text-slate-355">
                          {log.action} <span className="text-slate-500">at ({log.x}, {log.y})</span>
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <footer className="flex justify-between text-[10px] text-slate-500 font-mono px-1">
              <button
                className="hover:text-slate-300 transition-colors cursor-pointer"
                onClick={() => navigateTo('https://developers.reddit.com/docs')}
              >
                Dev Docs
              </button>
              <span>•</span>
              <button
                className="hover:text-slate-300 transition-colors cursor-pointer"
                onClick={() => navigateTo('https://www.reddit.com/r/Devvit')}
              >
                r/Devvit
              </button>
              <span>•</span>
              <button
                className="hover:text-slate-300 transition-colors cursor-pointer"
                onClick={() => navigateTo('https://discord.com/invite/R7yu2wh9Qz')}
              >
                Discord
              </button>
            </footer>

          </div>
        </div>
      )}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

