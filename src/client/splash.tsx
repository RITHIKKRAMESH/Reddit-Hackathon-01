import './index.css';

import { navigateTo, context, requestExpandedMode } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

export const Splash = () => {
  return (
    <div className="flex relative flex-col justify-center items-center min-h-screen gap-5 bg-[#0b0e14] text-slate-100 overflow-hidden font-sans select-none px-6">
      
      {/* Decorative neon laser grids */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.08),transparent_70%)] pointer-events-none" />
      <div className="absolute top-1/4 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-red-500/50 to-transparent blur-[1px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-blue-500/30 to-transparent blur-[1px] pointer-events-none" />

      {/* Retro target portal graphic in pure SVG */}
      <div className="relative w-36 h-36 flex items-center justify-center animate-pulse">
        <svg className="w-full h-full text-pink-500/20" viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="45" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" />
          <circle cx="50" cy="50" r="35" stroke="currentColor" strokeWidth="2" className="text-pink-500/80" />
          <circle cx="50" cy="50" r="18" stroke="#3b82f6" strokeWidth="2.5" strokeDasharray="3 3" />
          <circle cx="50" cy="50" r="6" fill="#ffffff" />
          
          {/* Laser beam bouncing off */}
          <line x1="50" y1="50" x2="90" y2="10" stroke="#3b82f6" strokeWidth="2" />
          <line x1="0" y1="50" x2="50" y2="50" stroke="#ef4444" strokeWidth="2" />
        </svg>
      </div>

      <div className="flex flex-col items-center text-center max-w-md gap-3 z-10">
        <h1 className="text-3xl md:text-4xl font-extrabold font-mono tracking-widest bg-gradient-to-r from-blue-400 via-pink-400 to-purple-500 bg-clip-text text-transparent drop-shadow-[0_0_15px_rgba(236,72,153,0.3)] animate-pulse">
          LASER DEFLECT
        </h1>
        <p className="text-xs uppercase font-mono tracking-wider text-slate-400">
          Cooperative Optic Network Grid
        </p>
        <p className="text-sm font-mono leading-relaxed text-slate-300 mt-2 px-2">
          Collaborate with the Reddit community to deflect a single laser beam to hit portal targets. Placed mirrors redirect the ray.
        </p>
        <p className="text-[11px] text-pink-400 font-mono mt-1 font-semibold">
          💡 Every player can make only 1 move every 5 seconds.
        </p>
      </div>

      <div className="flex flex-col items-center gap-2 mt-4 z-10">
        <button
          className="flex items-center justify-center bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white font-mono text-sm font-extrabold w-auto h-12 rounded-xl cursor-pointer tracking-wider shadow-[0_0_20px_rgba(236,72,153,0.3)] hover:shadow-[0_0_25px_rgba(236,72,153,0.5)] transition-all px-8 border border-pink-400/20 active:scale-95"
          onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
        >
          CONNECT TO GRID ⚡
        </button>
        <span className="text-[10px] text-slate-500 font-mono mt-1">
          Currently online: {context.username ?? 'anonymous redditor'}
        </span>
      </div>

      <footer className="absolute bottom-4 left-0 right-0 flex justify-center gap-3 text-[9px] font-mono text-slate-600 z-10">
        <button
          className="cursor-pointer hover:text-slate-400 transition-colors"
          onClick={() => navigateTo('https://developers.reddit.com/docs')}
        >
          Docs
        </button>
        <span>|</span>
        <button
          className="cursor-pointer hover:text-slate-400 transition-colors"
          onClick={() => navigateTo('https://www.reddit.com/r/Devvit')}
        >
          r/Devvit
        </button>
        <span>|</span>
        <button
          className="cursor-pointer hover:text-slate-400 transition-colors"
          onClick={() => navigateTo('https://discord.com/invite/R7yu2wh9Qz')}
        >
          Discord
        </button>
      </footer>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
