import './index.css';

import { StrictMode, useEffect, useState, useCallback } from 'react';
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
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [showSolveOverlay, setShowSolveOverlay] = useState(false);

  // Fetch initial game state
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      
      setGameState(data.gameState);
      setLevels(data.levels);
      setLogs(data.logs);
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch game state:', err);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

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

  // Toast handler
  const triggerToast = (msg: string) => {
    setErrorToast(msg);
    setTimeout(() => setErrorToast(null), 4000);
  };

  // Handle a user clicking a tile
  const handleMoveAttempt = async (x: number, y: number, mirrorType: MirrorType | null) => {
    if (gameState?.cooldownUntil && Date.now() < gameState.cooldownUntil) {
      triggerToast('⚠️ Cooldown active! Wait for your next charge.');
      return;
    }

    try {
      const res = await fetch('/api/make-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y, mirrorType }),
      });

      if (res.status === 403) {
        const errData = await res.json();
        triggerToast('⚠️ Cooldown active!');
        setGameState((prev) => 
          prev ? { ...prev, cooldownUntil: errData.cooldownUntil } : null
        );
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
    <div className="flex flex-col lg:flex-row min-h-screen bg-[#0b0e14] text-slate-100 font-sans antialiased overflow-x-hidden">
      
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
              The laser hit the portal! A new piece of the cybernetic mural has been uncovered.
            </p>
            <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 w-full animate-[progress_4s_linear]" />
            </div>
          </div>
        </div>
      )}

      {/* Main Game Screen */}
      <div className="flex-1 flex flex-col p-4 md:p-6 lg:p-8 justify-center items-center">
        {/* Game Header */}
        <div className="w-full max-w-3xl flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-2">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold font-mono bg-gradient-to-r from-blue-400 via-pink-400 to-purple-500 bg-clip-text text-transparent tracking-wide">
              LASER DEFLECT
            </h1>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Cooperative optic network grid • Subreddit sandbox
            </p>
          </div>
          <div className="flex items-center gap-3">
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
        <div className="w-full max-w-3xl flex-1 flex items-center justify-center relative min-h-[400px]">
          {isGameCompleted ? (
            <div className="text-center p-8 bg-slate-900/60 border border-pink-500/30 rounded-2xl max-w-md w-full shadow-2xl backdrop-blur-sm">
              <span className="text-7xl mb-4 block">👑</span>
              <h2 className="text-2xl font-extrabold font-mono text-pink-400 mb-2">GRID CLEARED</h2>
              <p className="text-slate-300 text-sm font-mono leading-relaxed mb-6">
                Excellent team coordination! The community successfully routed the laser grids and fully revealed the secret mural.
              </p>
              <div className="bg-slate-950 p-4 border border-pink-500/20 rounded-xl mb-4 font-mono text-xs leading-5 select-all overflow-x-auto whitespace-pre">
                {levels.map((lvl) => lvl.muralText).join('\n')}
              </div>
              <p className="text-xs text-pink-400 font-mono animate-pulse">
                All levels solved! Thank you for playing.
              </p>
            </div>
          ) : (
            <div className="w-full h-full relative">
              <PhaserGame
                levelConfig={currentConfig}
                placedMirrors={gameState.placedMirrors}
                selectedMirrorType={selectedMirror}
                cooldownActive={cooldownSeconds > 0}
                onMoveAttempt={handleMoveAttempt}
              />
              
              {/* Level label overlay */}
              <div className="absolute top-3 left-3 bg-slate-900/90 border border-slate-700 px-3 py-1.5 rounded-lg font-mono text-xs font-bold text-blue-400 pointer-events-none select-none shadow-lg">
                LEVEL {gameState.level} / {levels.length}
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
      <div className="w-full lg:w-96 bg-[#0e121a] border-t lg:border-t-0 lg:border-l border-slate-800 p-6 flex flex-col gap-6 select-none shrink-0 overflow-y-auto">
        
        {/* Tool Inventory Card */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-md">
          <h2 className="text-xs font-extrabold font-mono text-slate-400 uppercase tracking-widest">
            Reflection Inventory
          </h2>
          <div className="grid grid-cols-3 gap-2">
            
            {/* Mirror 1: Forward Slash */}
            <button
              onClick={() => setSelectedMirror('/')}
              className={`flex flex-col items-center justify-center p-3 rounded-xl border font-mono text-xs font-bold cursor-pointer transition-all hover:bg-slate-800 ${
                selectedMirror === '/'
                  ? 'border-pink-500 bg-pink-500/10 text-pink-300 shadow-[0_0_10px_rgba(236,72,153,0.15)]'
                  : 'border-slate-800 bg-slate-950 text-slate-400'
              }`}
            >
              <svg className="w-8 h-8 mb-1.5" viewBox="0 0 32 32" fill="none">
                <line x1="8" y1="24" x2="24" y2="8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
              <span>Mirror (/)</span>
            </button>

            {/* Mirror 2: Back Slash */}
            <button
              onClick={() => setSelectedMirror('\\')}
              className={`flex flex-col items-center justify-center p-3 rounded-xl border font-mono text-xs font-bold cursor-pointer transition-all hover:bg-slate-800 ${
                selectedMirror === '\\'
                  ? 'border-pink-500 bg-pink-500/10 text-pink-300 shadow-[0_0_10px_rgba(236,72,153,0.15)]'
                  : 'border-slate-800 bg-slate-950 text-slate-400'
              }`}
            >
              <svg className="w-8 h-8 mb-1.5" viewBox="0 0 32 32" fill="none">
                <line x1="8" y1="8" x2="24" y2="24" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
              <span>Mirror (\)</span>
            </button>

            {/* Tool 3: Eraser */}
            <button
              onClick={() => setSelectedMirror(null)}
              className={`flex flex-col items-center justify-center p-3 rounded-xl border font-mono text-xs font-bold cursor-pointer transition-all hover:bg-slate-800 ${
                selectedMirror === null
                  ? 'border-red-500 bg-red-500/10 text-red-300 shadow-[0_0_10px_rgba(239,68,68,0.15)]'
                  : 'border-slate-800 bg-slate-950 text-slate-400'
              }`}
            >
              <svg className="w-8 h-8 mb-1.5" viewBox="0 0 32 32" fill="none">
                <rect x="6" y="6" width="20" height="20" rx="3" stroke="currentColor" strokeWidth="3" />
                <line x1="6" y1="6" x2="26" y2="26" stroke="currentColor" strokeWidth="3" />
              </svg>
              <span>Erase</span>
            </button>

          </div>
          <p className="text-[10px] text-slate-500 font-mono text-center leading-4 mt-1">
            Choose a tool, then hover the board to preview its projection, and click to apply!
          </p>
        </div>

        {/* Community Cooldown Section */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-md">
          <h2 className="text-xs font-extrabold font-mono text-slate-400 uppercase tracking-widest">
            Deflect Power Charge
          </h2>
          
          {cooldownSeconds > 0 ? (
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center text-xs font-mono font-bold">
                <span className="text-red-400">⚡ RECHARGING BEAM</span>
                <span className="text-slate-300">
                  {cooldownSeconds}s
                </span>
              </div>
              <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                {/* Visual indicator of progress */}
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
                <span className="text-[10px] text-slate-400 font-mono mt-0.5">You are authorized to place 1 mirror projection.</span>
              </div>
            </div>
          )}
        </div>

        {/* Mural Progress Reveal */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-md">
          <h2 className="text-xs font-extrabold font-mono text-slate-400 uppercase tracking-widest">
            Community Mural Progress
          </h2>
          <div className="flex flex-col gap-2 font-mono text-xs">
            {levels.map((lvl, index) => {
              const isUnlocked = gameState.muralRevealed[index];
              const isActive = gameState.level === lvl.levelNumber;
              return (
                <div
                  key={lvl.levelNumber}
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-all ${
                    isUnlocked
                      ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                      : isActive
                      ? 'bg-slate-800/50 border-slate-700 text-slate-200'
                      : 'bg-slate-950/20 border-slate-900/60 text-slate-600'
                  }`}
                >
                  <span className="text-sm shrink-0">
                    {isUnlocked ? '🔓' : isActive ? '🎯' : '🔒'}
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span className={`font-bold ${isActive ? 'text-pink-400' : ''}`}>
                      Node {lvl.levelNumber}
                    </span>
                    <span className="text-[10px] truncate leading-relaxed mt-0.5">
                      {isUnlocked ? lvl.muralText : 'Complete prior level to decrypt file content'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Cooperative logs widget */}
        <div className="flex-1 min-h-[160px] bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-md overflow-hidden">
          <h2 className="text-xs font-extrabold font-mono text-slate-400 uppercase tracking-widest">
            Recent Network Edits
          </h2>
          <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2.5 font-mono text-[10px] leading-relaxed">
            {logs.length === 0 ? (
              <p className="text-slate-600 italic text-center py-6">No entries in the grid feed.</p>
            ) : (
              logs.map((log, index) => {
                const formattedTime = new Date(log.timestamp).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });
                return (
                  <div key={index} className="border-b border-slate-800/40 pb-2 flex flex-col gap-0.5">
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
