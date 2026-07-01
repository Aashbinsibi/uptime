import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Server, ArrowLeft, Cpu, HardDrive, Terminal, Zap } from 'lucide-react';

const ServerMonitoring: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col relative overflow-hidden font-sans">
      
      {/* Background gradients */}
      <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-500/5 blur-[120px] pointer-events-none" />

      {/* Decorative top bar */}
      <div className="h-1.5 bg-gradient-to-r from-emerald-500 via-blue-500 to-indigo-500 w-full" />

      {/* Top Header */}
      <header className="max-w-7xl mx-auto w-full px-4 md:px-8 py-6 flex items-center justify-between border-b border-white/5 relative z-10">
        <button
          onClick={() => navigate('/')}
          className="flex items-center space-x-2 py-1.5 px-3 bg-slate-900/40 hover:bg-slate-900/80 text-slate-400 hover:text-white rounded-xl border border-white/5 hover:border-white/10 transition-all text-xs font-semibold cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Dashboard</span>
        </button>

        <div className="flex items-center space-x-2">
          <Server className="h-5 w-5 text-emerald-400" />
          <span className="font-bold tracking-tight text-white text-sm uppercase">Antigravity Monitor</span>
        </div>
      </header>

      {/* Center Hero Panel */}
      <main className="flex-grow max-w-4xl mx-auto w-full px-4 flex flex-col items-center justify-center py-16 relative z-10 text-center">
        
        {/* Animated main visual icon */}
        <div className="relative mb-8 group">
          <div className="absolute inset-0 bg-emerald-500/20 rounded-3xl blur-xl group-hover:bg-emerald-500/30 transition-all duration-300" />
          <div className="relative p-6 bg-slate-950/60 rounded-3xl border border-emerald-500/20 backdrop-blur-md shadow-2xl flex items-center justify-center">
            <Server className="h-16 w-16 text-emerald-400 animate-pulse" />
          </div>
          <span className="absolute -bottom-2 -right-2 px-2.5 py-1 bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-[9px] font-extrabold uppercase rounded-full tracking-widest border border-white/10 shadow-lg">
            Agent Mode
          </span>
        </div>

        {/* Text descriptions */}
        <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight leading-tight max-w-lg">
          Server & Infrastructure Monitoring
        </h1>
        
        <p className="text-slate-400 text-sm mt-4 max-w-md leading-relaxed">
          Comprehensive OS-level diagnostics, disk usage tracking, memory exhaustion checks, and CPU spikes alarms are coming soon.
        </p>

        {/* Coming soon badge */}
        <div className="mt-6 inline-flex items-center space-x-2 py-1 px-3 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
          <Zap className="h-3 w-3 animate-bounce" />
          <span>Feature Coming Soon</span>
        </div>

        {/* Feature Teasers Columns */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16 w-full">
          <div className="glass-panel p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all text-left">
            <Cpu className="h-6 w-6 text-emerald-400 mb-3" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">CPU & Load Tracking</h4>
            <p className="text-[10px] text-slate-500 leading-relaxed mt-2">
              Visualizes multicore processor usage, load averages, and highlights processes causing spikes.
            </p>
          </div>

          <div className="glass-panel p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all text-left">
            <HardDrive className="h-6 w-6 text-blue-400 mb-3" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Storage Diagnostics</h4>
            <p className="text-[10px] text-slate-500 leading-relaxed mt-2">
              Inspects filesystem storage allocations, I/O bandwidth bottlenecks, and sends warnings when storage fills.
            </p>
          </div>

          <div className="glass-panel p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all text-left">
            <Terminal className="h-6 w-6 text-indigo-400 mb-3" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Linux Agent Node</h4>
            <p className="text-[10px] text-slate-500 leading-relaxed mt-2">
              A light-weight daemon package reporting daemon diagnostics back to your private central dashboard securely.
            </p>
          </div>
        </section>

        {/* Return Button */}
        <div className="mt-12">
          <button
            onClick={() => navigate('/')}
            className="py-2.5 px-6 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 font-bold rounded-xl text-xs cursor-pointer shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20 transition-all"
          >
            Return to Dashboard
          </button>
        </div>
      </main>

      {/* Footer copyright */}
      <footer className="py-6 text-center text-[10px] text-slate-600 border-t border-white/5 relative z-10">
        &copy; {new Date().getFullYear()} Antigravity Uptime. All rights reserved.
      </footer>
    </div>
  );
};

export default ServerMonitoring;
