import './index.css';

import { StrictMode, useEffect, useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { navigateTo } from '@devvit/web/client';
import { PhaserGame } from './phaser/PhaserGame';
import { LevelConfig, MirrorType, GameState } from '../shared/types';

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
  const [showSolveOverlay, setShowSolveOverlay] = useState(false);
  const lastUpdateRef = useRef<number>(0);

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
      if (data.lastUpdate) {
        lastUpdateRef.current = data.lastUpdate;
      }
      triggerToast(`🎯 Loaded ${stage.toUpperCase()} Level ${levelNum}`);
    } catch (err) {
      console.error('Failed to select level:', err);
      triggerToast('❌ Server error. Try again.');
    }
  };

  // Cooldown countdown timer effect
  useEffect(() => {
    if (!gameState?.cooldownUntil) {
      setCooldownSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      const diff = Math.ceil((gameState.cooldownUntil! - Date.now()) / 1000);
      if (diff <= 0) {
        setCooldownSeconds(0);
        // Refresh state from server to remove cooldown
        setGameState((prev) => prev ? { ...prev, cooldownUntil: null } : null);
        clearInterval(interval);
      } else {
        setCooldownSeconds(diff);
      }
    }, 1000);

    // Run once immediately
    const initialDiff = Math.ceil((gameState.cooldownUntil - Date.now()) / 1000);
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
      if (data.lastUpdate) {
        lastUpdateRef.current = data.lastUpdate;
      }

      // Play success screen if level was solved
      if (data.levelSolved) {
        setShowSolveOverlay(true);
        setTimeout(() => {
          setShowSolveOverlay(false);
        }, 4000);
      }

    } catch (err) {
      console.error('Failed to submit move:', err);
      triggerToast('❌ Server error. Try again.');
    }
  };

  // Handle purchasing prism
  const handleBuyPrism = async () => {
    try {
      const res = await fetch(`/api/buy-prism?mode=${gameMode}`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errData = await res.json();
        triggerToast(`❌ ${errData.error || 'Failed to buy Prism'}`);
        return;
      }

      const data = await res.json();
      setGameState(data.gameState);
      triggerToast('💎 Purchased 1 Prism blocker successfully!');
    } catch (err) {
      console.error('Failed to buy prism:', err);
      triggerToast('❌ Server error. Try again.');
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
    <div className="flex flex-col lg:flex-row lg:h-screen bg-[#0b0e14] text-slate-100 font-sans antialiased overflow-hidden">
      
      {/* Toast Alert */}
      {errorToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-red-500/50 text-red-200 px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 backdrop-blur-md animate-bounce">
          <span className="text-xl">⚠️</span>
          <span className="font-mono text-sm font-semibold">{errorToast}</span>
        </div>
      )}

      {/* Level Solve Overlay Animation */}
      {showSolveOverlay && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center animate-fade-in">
          <div className="text-center p-8 bg-slate-900 border border-blue-500/40 rounded-3xl shadow-2xl max-w-md mx-4 animate-scale-up">
            <span className="text-6xl mb-4 block animate-bounce">🌟</span>
            <h2 className="text-3xl font-extrabold text-blue-400 font-mono tracking-wider mb-2">TARGET UNLOCKED</h2>
            <p className="text-slate-300 text-sm mb-4 leading-relaxed font-mono">
              The laser hit the portal! Awarded <span className="text-amber-300 font-bold">+{currentConfig.reward} Lux Credits</span>!
            </p>
            <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 w-full animate-[progress_4s_linear]" />
            </div>
          </div>
        </div>
      )}

      {/* Main Game Screen */}
      <div className="flex-1 flex flex-col p-3 md:p-4 lg:p-6 justify-center items-center min-h-0 w-full">
        {/* Game Header */}
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
            {/* Solo / Community toggle tabs */}
            <div className="flex bg-slate-900 border border-slate-700/60 p-1 rounded-xl shadow-md">
              <button
                onClick={() => setGameMode('community')}
                className={`px-3 py-1.5 font-mono text-xs font-bold rounded-lg cursor-pointer transition-all ${
                  gameMode === 'community'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Community
              </button>
              <button
                onClick={() => setGameMode('solo')}
                className={`px-3 py-1.5 font-mono text-xs font-bold rounded-lg cursor-pointer transition-all ${
                  gameMode === 'solo'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Solo
              </button>
            </div>

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
            <button
              className="bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-300 font-mono text-xs font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              onClick={fetchState}
            >
              🔄 Refresh
            </button>
          </div>
        </div>

        {/* Game Canvas Board */}
        <div className="w-full max-w-3xl flex-1 flex items-center justify-center relative min-h-[350px] md:min-h-[400px]">
          {isGameCompleted ? (
            <div className="text-center p-8 bg-slate-900/60 border border-pink-500/30 rounded-2xl max-w-md w-full shadow-2xl backdrop-blur-sm">
              <span className="text-7xl mb-4 block">👑</span>
              <h2 className="text-2xl font-extrabold font-mono text-pink-400 mb-2">GRID CLEARED</h2>
              <p className="text-slate-300 text-sm font-mono leading-relaxed mb-6">
                Excellent coordination! You successfully routed the laser grids and fully revealed the secret mural.
              </p>
              <div className="bg-slate-950 p-4 border border-pink-500/20 rounded-xl mb-4 font-mono text-xs leading-5 select-all overflow-x-auto whitespace-pre">
                {levels.map((lvl) => lvl.muralText).join('\n')}
              </div>
              <p className="text-xs text-pink-400 font-mono animate-pulse">
                All levels solved! Thank you for playing.
              </p>
            </div>
          ) : (
            <div className="absolute inset-0">
              <PhaserGame
                levelConfig={currentConfig}
                placedMirrors={gameState.placedMirrors}
                placedPrisms={gameState.placedPrisms}
                selectedMirrorType={selectedMirror}
                selectedTool={selectedTool}
                cooldownActive={gameMode === 'community' && cooldownSeconds > 0}
                onMoveAttempt={handleMoveAttempt}
              />
              
              {/* Level label overlay */}
              <div className="absolute top-3 left-3 bg-slate-900/90 border border-slate-700 px-3 py-1.5 rounded-lg font-mono text-xs font-bold text-blue-400 pointer-events-none select-none shadow-lg flex items-center gap-2">
                <span className="capitalize">{gameState.activeStage}</span>
                <span>LEVEL {gameState.level > 10 ? 10 : gameState.level} / {levels.length}</span>
                <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-medium">
                  {currentConfig.difficulty}
                </span>
              </div>

              {/* Solved label overlay */}
              {gameState.targetsHit && (
                <div className="absolute bottom-3 right-3 bg-green-500/20 border border-green-500 text-green-300 px-3 py-1.5 rounded-lg font-mono text-xs font-bold pointer-events-none select-none shadow-lg animate-pulse">
                  ✅ STABLE BEAM DETECTED
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Control Sidebar */}
      <div className="w-full lg:w-96 bg-[#0e121a] border-t lg:border-t-0 lg:border-l border-slate-800 p-4 flex flex-col gap-3.5 select-none shrink-0 overflow-y-auto">
        
        {/* Lux Credits & Shop Panel */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3 flex flex-col gap-2 shadow-md">
          <div className="flex justify-between items-center border-b border-slate-800/60 pb-2">
            <h2 className="text-xs font-extrabold font-mono text-slate-400 uppercase tracking-widest">
              Lux Credit Shop
            </h2>
            <span className="bg-amber-500/10 border border-amber-500/35 text-amber-400 font-mono text-xs font-extrabold px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-inner">
              🪙 {gameState.credits} LC
            </span>
          </div>
          
          <div className="flex items-center justify-between bg-slate-950/60 p-3 rounded-lg border border-slate-850">
            <div className="flex flex-col">
              <span className="font-mono text-xs font-bold text-slate-200">Prism Blocker</span>
              <span className="text-[10px] text-slate-400 font-mono mt-0.5">Price: 15 LC</span>
            </div>
            <button
              onClick={handleBuyPrism}
              disabled={gameState.credits < 15}
              className={`font-mono text-xs font-extrabold px-3 py-1.5 rounded-lg cursor-pointer transition-all ${
                gameState.credits >= 15
                  ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-md active:scale-95'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/20'
              }`}
            >
              Buy Prism 💎
            </button>
          </div>
          
          <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono px-0.5">
            <span>Inventory:</span>
            <span className="font-extrabold text-cyan-400">{gameState.prismsInventory} Prisms</span>
          </div>
        </div>

        {/* Tool Inventory Card */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3 flex flex-col gap-2 shadow-md">
          <h2 className="text-xs font-extrabold font-mono text-slate-400 uppercase tracking-widest">
            Reflection Inventory
          </h2>
          <div className="grid grid-cols-2 gap-2">
            
            {/* Mirror 1: Forward Slash */}
            <button
              onClick={() => {
                setSelectedTool('mirror');
                setSelectedMirror('/');
              }}
              className={`flex flex-col items-center justify-center p-2.5 rounded-xl border font-mono text-xs font-bold cursor-pointer transition-all hover:bg-slate-800 ${
                selectedTool === 'mirror' && selectedMirror === '/'
                  ? 'border-pink-500 bg-pink-500/10 text-pink-300 shadow-[0_0_10px_rgba(236,72,153,0.15)]'
                  : 'border-slate-800 bg-slate-950 text-slate-400'
              }`}
            >
              <svg className="w-6 h-6 mb-1" viewBox="0 0 32 32" fill="none">
                <line x1="8" y1="24" x2="24" y2="8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
              <span>Mirror (/)</span>
            </button>

            {/* Mirror 2: Back Slash */}
            <button
              onClick={() => {
                setSelectedTool('mirror');
                setSelectedMirror('\\');
              }}
              className={`flex flex-col items-center justify-center p-2.5 rounded-xl border font-mono text-xs font-bold cursor-pointer transition-all hover:bg-slate-800 ${
                selectedTool === 'mirror' && selectedMirror === '\\'
                  ? 'border-pink-500 bg-pink-500/10 text-pink-300 shadow-[0_0_10px_rgba(236,72,153,0.15)]'
                  : 'border-slate-800 bg-slate-950 text-slate-400'
              }`}
            >
              <svg className="w-6 h-6 mb-1" viewBox="0 0 32 32" fill="none">
                <line x1="8" y1="8" x2="24" y2="24" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
              <span>Mirror (\)</span>
            </button>

            {/* Prism Block */}
            <button
              onClick={() => {
                setSelectedTool('prism');
                setSelectedMirror(null);
              }}
              className={`flex flex-col items-center justify-center p-2.5 rounded-xl border font-mono text-xs font-bold cursor-pointer transition-all hover:bg-slate-800 relative ${
                selectedTool === 'prism'
                  ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.15)]'
                  : 'border-slate-800 bg-slate-950 text-slate-400'
              }`}
            >
              <span className="absolute top-1 right-2 bg-cyan-950 border border-cyan-800 text-cyan-400 font-bold font-mono text-[9px] px-1.5 rounded-md">
                {gameState.prismsInventory}
              </span>
              <svg className="w-6 h-6 mb-1" viewBox="0 0 32 32" fill="none">
                <polygon points="16,6 26,16 16,26 6,16" stroke="currentColor" strokeWidth="3" />
                <line x1="16" y1="6" x2="16" y2="26" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
                <line x1="6" y1="16" x2="26" y2="16" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
              </svg>
              <span>Prism Block</span>
            </button>

            {/* Tool 3: Eraser */}
            <button
              onClick={() => {
                setSelectedTool('erase');
                setSelectedMirror(null);
              }}
              className={`flex flex-col items-center justify-center p-2.5 rounded-xl border font-mono text-xs font-bold cursor-pointer transition-all hover:bg-slate-800 ${
                selectedTool === 'erase'
                  ? 'border-red-500 bg-red-500/10 text-red-300 shadow-[0_0_10px_rgba(239,68,68,0.15)]'
                  : 'border-slate-800 bg-slate-950 text-slate-400'
              }`}
            >
              <svg className="w-6 h-6 mb-1" viewBox="0 0 32 32" fill="none">
                <rect x="6" y="6" width="20" height="20" rx="3" stroke="currentColor" strokeWidth="3" />
                <line x1="6" y1="6" x2="26" y2="26" stroke="currentColor" strokeWidth="3" />
              </svg>
              <span>Erase</span>
            </button>

          </div>
          <p className="text-[10px] text-slate-500 font-mono text-center leading-4 mt-1">
            {selectedTool === 'prism' 
              ? 'Prisms block laser paths entirely. Buy Prisms from the Shop, then click to place!' 
              : 'Choose a tool, then hover the board to preview its projection, and click to apply!'}
          </p>
        </div>

        {/* FCFS Queue Panel (Community Mode Only) */}
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
              <div className="flex items-center gap-2 bg-blue-950/40 border border-blue-900/30 p-2.5 rounded-lg text-xs font-mono">
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
              <div className="flex flex-col gap-1 max-h-[100px] overflow-y-auto bg-slate-950/40 p-1.5 rounded-lg border border-slate-850">
                {gameState.queue.map((name, index) => (
                  <div key={index} className="flex justify-between items-center font-mono text-[10px] text-slate-300 p-0.5 border-b border-slate-900 last:border-0">
                    <span className="flex items-center gap-1.5">
                      <span className="text-slate-500">#{index + 1}</span>
                      <span className={name === gameState.username ? 'text-pink-400 font-bold' : (index === 0 ? 'text-blue-400 font-bold' : '')}>
                        {name === gameState.username ? 'You' : name}
                      </span>
                    </span>
                    {index === 0 && <span className="bg-blue-500 text-slate-950 font-extrabold text-[8px] px-1 rounded">TURN</span>}
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

        {/* Community Cooldown Section */}
        {gameMode === 'community' && (
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3 flex flex-col gap-2 shadow-md">
            <h2 className="text-xs font-extrabold font-mono text-slate-400 uppercase tracking-widest">
              Deflect Power Charge
            </h2>
            
            {cooldownSeconds > 0 ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center text-xs font-mono font-bold">
                  <span className="text-red-400">⚡ RECHARGING BEAM</span>
                  <span className="text-slate-300">
                    {cooldownSeconds}s
                  </span>
                </div>
                <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div 
                    className="h-full bg-gradient-to-r from-red-500 to-pink-500 transition-all duration-1000" 
                    style={{ width: `${Math.max(0, Math.min(100, (cooldownSeconds / 5) * 100))}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-500 font-mono leading-relaxed mt-0.5">
                  Every player can make only 1 move every 5 seconds.
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

        {/* Administrative Reset Board Panel */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3 flex flex-col gap-2 shadow-md">
          <h2 className="text-xs font-extrabold font-mono text-slate-400 uppercase tracking-widest">
            Grid Actions
          </h2>
          
          <button
            onClick={handleResetLevel}
            disabled={resetCooldownSeconds > 0 && gameState.refreshesRemaining === 0}
            className={`w-full flex items-center justify-center gap-2 border font-mono text-xs font-bold py-1.5 px-3 rounded-lg transition-all cursor-pointer ${
              resetCooldownSeconds > 0 && gameState.refreshesRemaining === 0
                ? 'border-red-900/50 bg-red-950/20 text-red-500 cursor-not-allowed'
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
            <div className="text-[10px] font-mono text-red-400 text-center leading-relaxed bg-red-950/20 border border-red-900/30 p-2 rounded-lg">
              ⏱️ Resets limit reached! Cooldown expires in:{' '}
              <span className="font-bold">
                {Math.floor(resetCooldownSeconds / 60)}m {resetCooldownSeconds % 60}s
              </span>
            </div>
          )}
        </div>

        {/* Stage & Level Selection */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3 flex flex-col gap-3 shadow-md">
          <div className="flex justify-between items-center border-b border-slate-800/60 pb-1.5">
            <h2 className="text-xs font-extrabold font-mono text-slate-400 uppercase tracking-widest">
              Stage & Level Select
            </h2>
            <span className="bg-pink-500/10 border border-pink-500/35 text-pink-400 font-mono text-[9px] font-extrabold px-1.5 py-0.5 rounded shadow-inner">
              10 Levels / Stage
            </span>
          </div>

          {/* Stage Tabs */}
          <div className="grid grid-cols-3 bg-slate-950 border border-slate-850 p-1 rounded-xl shadow-md gap-1">
            {(['easy', 'medium', 'hard'] as const).map((stage) => {
              const isActive = gameState.activeStage === stage;
              return (
                <button
                  key={stage}
                  onClick={() => handleSelectLevel(stage, 1)}
                  className={`px-1 py-1.5 font-mono text-xs font-bold rounded-lg cursor-pointer transition-all capitalize ${
                    isActive
                      ? 'bg-pink-600 text-white shadow-sm font-extrabold'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  {stage}
                </button>
              );
            })}
          </div>

          {/* Level Grid */}
          <div className="grid grid-cols-5 gap-1.5">
            {Array.from({ length: 10 }).map((_, index) => {
              const lvlNum = index + 1;
              const isCompleted = lvlNum <= gameState.highestCompleted[gameState.activeStage];
              const isCurrent = gameState.activeLevelNumber === lvlNum;
              return (
                <button
                  key={lvlNum}
                  onClick={() => handleSelectLevel(gameState.activeStage, lvlNum)}
                  className={`flex flex-col items-center justify-center py-2 px-1 rounded-lg border font-mono text-xs font-bold cursor-pointer transition-all relative ${
                    isCurrent
                      ? 'border-pink-500 bg-pink-500/10 text-pink-300 shadow-[0_0_10px_rgba(236,72,153,0.15)] font-extrabold scale-105 z-10'
                      : isCompleted
                      ? 'border-green-500/40 bg-green-500/5 hover:bg-green-500/10 text-green-400 hover:border-green-500'
                      : 'border-slate-800 bg-slate-950 hover:bg-slate-850 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <span className="text-[11px]">{lvlNum}</span>
                  {isCompleted && (
                    <span className="text-[9px] mt-0.5 text-green-400">✓</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Mural Progress Reveal */}
          <div className="border-t border-slate-800/80 pt-2 flex flex-col gap-1 text-[10px] font-mono">
            <span className="text-[9px] text-slate-500 font-extrabold uppercase tracking-wider">
              Decrypted Murals ({gameState.highestCompleted[gameState.activeStage]}/10)
            </span>
            <div className="max-h-[120px] overflow-y-auto pr-1 flex flex-col gap-1">
              {Array.from({ length: 10 }).map((_, i) => {
                const lvlNum = i + 1;
                const isCompleted = lvlNum <= gameState.highestCompleted[gameState.activeStage];
                const currentConfig = levels[i];
                if (isCompleted && currentConfig) {
                  return (
                    <div key={lvlNum} className="flex gap-1 items-start text-blue-300 border-b border-slate-900 last:border-0 pb-1">
                      <span className="shrink-0 text-slate-500">🔓 L{lvlNum}:</span>
                      <span className="truncate leading-relaxed select-text" title={currentConfig.muralText}>
                        {currentConfig.muralText}
                      </span>
                    </div>
                  );
                }
                return null;
              })}
              {gameState.highestCompleted[gameState.activeStage] === 0 && (
                <span className="text-slate-600 italic">No node files decrypted yet. Deflect the laser beam to decrypt node data!</span>
              )}
            </div>
          </div>
        </div>

        {/* Cooperative logs widget */}
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
                    <span className="text-slate-300">
                      {log.action} <span className="text-slate-500">at ({log.x}, {log.y})</span>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Subreddit links */}
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
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

