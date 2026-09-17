import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Server, ArrowLeft, Cpu, HardDrive, Terminal, Zap } from 'lucide-react';

const ServerMonitoring: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col relative overflow-hidden font-sans">
      
      {/* Top subtle border */}
      <div className="h-0.5 bg-zinc-800 w-full" />

      {/* Top Header */}
      <header className="max-w-7xl mx-auto w-full px-4 md:px-8 py-6 flex items-center justify-between border-b border-zinc-800 relative z-10 font-mono">
        <button
          onClick={() => navigate('/')}
          className="flex items-center space-x-2 py-1.5 px-3 bg-zinc-900 hover:bg-black text-zinc-200 hover:text-white rounded-xl border border-zinc-700 transition-all text-xs font-semibold cursor-pointer shadow-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Dashboard</span>
        </button>

        <div className="flex items-center space-x-2">
          <Server className="h-5 w-5 text-white" />
          <span className="font-bold tracking-tight text-white text-sm uppercase">Antigravity Server Agent</span>
        </div>
      </header>

      {/* Center Hero Panel */}
      <main className="flex-grow max-w-4xl mx-auto w-full px-4 flex flex-col items-center justify-center py-16 relative z-10 text-center font-mono">
        
        {/* Animated main visual icon */}
        <div className="relative mb-8 group">
          <div className="relative p-6 bg-black rounded-3xl border border-zinc-700 backdrop-blur-md shadow-2xl flex items-center justify-center">
            <Server className="h-16 w-16 text-white animate-pulse" />
          </div>
          <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-zinc-900 text-zinc-300 text-[9px] font-mono font-bold uppercase rounded-full tracking-widest border border-zinc-700 shadow-md">
            Available Soon
          </span>
        </div>

        {/* Text descriptions */}
        <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight leading-tight max-w-xl">
          Antigravity Server Agent
        </h1>
        
        <p className="text-zinc-400 text-xs md:text-sm mt-4 max-w-lg leading-relaxed font-normal">
          The Antigravity Server Agent will be available soon. Comprehensive OS-level diagnostics, disk usage tracking, memory exhaustion checks, and CPU load alarms.
        </p>

        {/* Coming soon badge */}
        <div className="mt-6 inline-flex items-center space-x-2 py-1 px-3.5 bg-zinc-900 border border-zinc-700 rounded-full text-[10px] font-bold text-white uppercase tracking-widest font-mono shadow-sm">
          <Zap className="h-3 w-3 text-white animate-bounce" />
          <span>Agent Available Soon</span>
        </div>

        {/* Install Preview Snippet */}
        <div className="mt-8 max-w-lg w-full bg-black border border-zinc-800 rounded-2xl p-4 text-left font-mono shadow-inner">
          <div className="flex items-center justify-between text-[10px] text-zinc-500 border-b border-zinc-800 pb-2 mb-3">
            <span className="flex items-center space-x-1.5">
              <Terminal className="h-3.5 w-3.5 text-zinc-400" />
              <span>Upcoming Agent One-Line Install</span>
            </span>
            <span className="text-[9px] uppercase tracking-wider text-zinc-500">Preview</span>
          </div>
          <div className="text-xs text-zinc-300 flex items-center justify-between">
            <code className="text-zinc-300 select-all">
              curl -sSL https://agent.antigravity.io/install.sh | sudo bash
            </code>
            <span className="ml-2 text-[10px] text-zinc-500 font-bold uppercase tracking-wider whitespace-nowrap">
              Soon
            </span>
          </div>
        </div>

        {/* Feature Teasers Columns */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12 w-full text-left">
          <div className="bg-zinc-900/90 p-6 rounded-2xl border border-zinc-800 hover:border-zinc-700 transition-all shadow-md">
            <Cpu className="h-6 w-6 text-white mb-3" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">CPU & Load Tracking</h4>
            <p className="text-[10px] text-zinc-400 leading-relaxed mt-2">
              Visualizes multicore processor usage, load averages, and highlights processes causing spikes.
            </p>
          </div>

          <div className="bg-zinc-900/90 p-6 rounded-2xl border border-zinc-800 hover:border-zinc-700 transition-all shadow-md">
            <HardDrive className="h-6 w-6 text-white mb-3" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Storage Diagnostics</h4>
            <p className="text-[10px] text-zinc-400 leading-relaxed mt-2">
              Inspects filesystem storage allocations, I/O bandwidth bottlenecks, and sends warnings when storage fills.
            </p>
          </div>

          <div className="bg-zinc-900/90 p-6 rounded-2xl border border-zinc-800 hover:border-zinc-700 transition-all shadow-md">
            <Terminal className="h-6 w-6 text-white mb-3" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Host Telemetry Daemon</h4>
            <p className="text-[10px] text-zinc-400 leading-relaxed mt-2">
              A light-weight single binary daemon reporting host diagnostics back to your private central dashboard securely.
            </p>
          </div>
        </section>

        {/* Return Button */}
        <div className="mt-12">
          <button
            onClick={() => navigate('/')}
            className="py-2.5 px-6 bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-bold rounded-xl text-xs cursor-pointer shadow-md border border-zinc-300 transition-all font-mono"
          >
            Return to Dashboard
          </button>
        </div>
      </main>

      {/* Footer copyright */}
      <footer className="py-6 text-center text-[10px] text-zinc-500 border-t border-zinc-800 relative z-10 font-mono">
        &copy; {new Date().getFullYear()} Antigravity Uptime. All rights reserved.
      </footer>
    </div>
  );
};

export default ServerMonitoring;
