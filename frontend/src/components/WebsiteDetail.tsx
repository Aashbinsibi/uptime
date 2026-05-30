import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import io from 'socket.io-client';
import { 
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid 
} from 'recharts';
import { 
  Activity, ArrowLeft, RefreshCw, ShieldAlert, 
  Calendar, BarChart2, Server 
} from 'lucide-react';

interface Website {
  id: string;
  name: string;
  url: string;
  check_interval: number;
  timeout: number;
  enabled: boolean;
}

interface CheckHistoryItem {
  id: string;
  status_code: number | null;
  response_time: number;
  is_up: boolean;
  error_message: string | null;
  checked_at: string;
}

interface Stats {
  totalChecks: number;
  upChecks: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  uptimePercentage: number;
}

const WebsiteDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [website, setWebsite] = useState<Website | null>(null);
  const [history, setHistory] = useState<CheckHistoryItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('24h');
  
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  // 1. Fetch website and performance stats
  const fetchData = async () => {
    try {
      // Get details
      const siteRes = await api.get(`/api/websites/${id}`);
      if (siteRes.data.success) {
        setWebsite(siteRes.data.data);
      }

      // Get stats
      const statsRes = await api.get(`/api/websites/${id}/stats?range=${timeRange}`);
      if (statsRes.data.success) {
        setStats(statsRes.data.data);
      }

      // Get checks
      const checksRes = await api.get(`/api/websites/${id}/checks?limit=100`);
      if (checksRes.data.success) {
        setHistory(checksRes.data.data);
      }
    } catch (error) {
      console.error('[WebsiteDetail] Error fetching details:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id, timeRange]);

  // 2. Setup WS for real-time appending of lines chart
  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const socket = io(socketUrl, {
      withCredentials: true
    });

    socket.on('check-completed', (data: any) => {
      if (data.websiteId === id) {
        // Append to history list
        setHistory(prev => {
          const newItem: CheckHistoryItem = {
            id: Math.random().toString(), // local fallback
            status_code: data.statusCode,
            response_time: data.responseTime,
            is_up: data.isUp,
            error_message: data.errorMessage,
            checked_at: data.checkedAt
          };
          // Append and limit to last 100
          const updated = [...prev, newItem];
          if (updated.length > 100) {
            updated.shift();
          }
          return updated;
        });

        // Recalculate quick stats dynamically in client
        setStats(prev => {
          if (!prev) return null;
          const newTotal = prev.totalChecks + 1;
          const newUp = data.isUp ? prev.upChecks + 1 : prev.upChecks;
          const newAvg = Math.round(((prev.avgResponseTime * prev.totalChecks) + data.responseTime) / newTotal);
          
          return {
            totalChecks: newTotal,
            upChecks: newUp,
            avgResponseTime: newAvg,
            minResponseTime: prev.minResponseTime === 0 ? data.responseTime : Math.min(prev.minResponseTime, data.responseTime),
            maxResponseTime: Math.max(prev.maxResponseTime, data.responseTime),
            uptimePercentage: parseFloat(((newUp / newTotal) * 100).toFixed(4))
          };
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [id]);

  const handleManualCheck = async () => {
    if (!id || checking) return;
    setChecking(true);
    try {
      await api.post(`/api/websites/${id}/check`);
    } catch (error) {
      console.error('[WebsiteDetail] Manual check failed:', error);
    } finally {
      setChecking(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080c14]">
        <div className="flex flex-col items-center">
          <Activity className="h-10 w-10 text-emerald-500 animate-pulse-glow-green" />
          <p className="mt-4 text-slate-400 font-medium">Gathering checkpoint records...</p>
        </div>
      </div>
    );
  }

  if (!website) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080c14]">
        <div className="text-center p-8 glass-panel rounded-2xl max-w-sm">
          <ShieldAlert className="h-10 w-10 text-rose-500 mx-auto mb-3" />
          <p className="text-white text-sm font-bold">Monitored Site Not Found</p>
          <button 
            onClick={() => navigate('/')}
            className="mt-4 px-4 py-2 bg-emerald-500 text-slate-950 font-bold rounded-xl text-xs"
          >
            Go Back Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Pre-process chart items format
  const chartData = history.map(item => {
    const time = new Date(item.checked_at);
    return {
      time: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      latency: item.is_up ? item.response_time : 0, // Plot 0 or skip if down
      statusCode: item.status_code || 'Err'
    };
  });

  return (
    <div className="min-h-screen pb-16 relative">
      {/* Ambients glows */}
      <div className="absolute top-[10%] left-[10%] w-[400px] h-[400px] rounded-full bg-blue-500/5 blur-[120px] pointer-events-none" />

      {/* Navigation Header */}
      <header className="border-b border-white/5 py-4 px-6 md:px-12 flex justify-between items-center relative z-20 glass-panel">
        <button
          onClick={() => navigate('/')}
          className="flex items-center space-x-2 py-1.5 px-3.5 bg-slate-900/40 hover:bg-slate-900 text-slate-300 hover:text-white font-semibold rounded-lg text-xs border border-white/5 hover:border-white/10 cursor-pointer transition-all"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Dashboard</span>
        </button>

        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
            <Activity className="h-4.5 w-4.5 text-emerald-400" />
          </div>
          <span className="font-bold tracking-tight text-white text-sm hidden sm:inline">
            ANTIGRAVITY DETECTOR
          </span>
        </div>
      </header>

      {/* Main Body */}
      <main className="max-w-7xl mx-auto px-4 md:px-8 mt-8 relative z-10">
        
        {/* Info Card Header */}
        <section className="glass-panel p-6 rounded-2xl mb-8 flex flex-col md:flex-row justify-between items-start md:items-center space-y-4 md:space-y-0">
          <div>
            <div className="flex items-center space-x-3">
              <h2 className="text-xl font-extrabold text-white">{website.name}</h2>
              <span className={`text-[10px] font-bold uppercase tracking-wider py-0.5 px-2 rounded-full ${
                website.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-900/60 text-slate-500'
              }`}>
                {website.enabled ? 'Active Monitor' : 'Disabled'}
              </span>
            </div>
            <a 
              href={website.url} 
              target="_blank" 
              rel="noreferrer" 
              className="text-xs text-slate-400 hover:text-emerald-400 transition-colors mt-1 block truncate max-w-sm sm:max-w-md"
            >
              {website.url}
            </a>
          </div>

          <div className="flex items-center space-x-3">
            {/* Range Toggle */}
            <div className="flex bg-slate-950/60 p-1 rounded-lg border border-white/5">
              {(['24h', '7d', '30d'] as const).map(range => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md cursor-pointer transition-all ${
                    timeRange === range 
                      ? 'bg-slate-900 text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>

            {/* Manual Check */}
            <button
              onClick={handleManualCheck}
              disabled={checking || !website.enabled}
              className="flex items-center justify-center space-x-1.5 py-1.5 px-3 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 font-bold rounded-lg text-xs cursor-pointer disabled:opacity-30 transition-all shadow-md shadow-emerald-500/5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
              <span>Ping Node</span>
            </button>
          </div>
        </section>

        {/* Aggregated Performance Statistics Grid */}
        {stats && (
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {/* Uptime % */}
            <div className="p-5 rounded-2xl glass-panel relative overflow-hidden">
              <span className="text-slate-500 text-xs font-semibold block">Uptime Interval Ratio</span>
              <div className="mt-3 flex items-baseline space-x-1">
                <span className="text-2xl font-black text-emerald-400 tracking-tight">
                  {stats.uptimePercentage.toFixed(3)}
                </span>
                <span className="text-[10px] text-slate-500 font-bold">%</span>
              </div>
            </div>

            {/* Avg Latency */}
            <div className="p-5 rounded-2xl glass-panel relative overflow-hidden">
              <span className="text-slate-500 text-xs font-semibold block">Average Latency</span>
              <div className="mt-3 flex items-baseline space-x-1">
                <span className="text-2xl font-black text-blue-400 tracking-tight">
                  {stats.avgResponseTime}
                </span>
                <span className="text-[10px] text-slate-500 font-bold">ms</span>
              </div>
            </div>

            {/* Max Latency */}
            <div className="p-5 rounded-2xl glass-panel relative overflow-hidden">
              <span className="text-slate-500 text-xs font-semibold block">Peak Node latency</span>
              <div className="mt-3 flex items-baseline space-x-1">
                <span className="text-2xl font-black text-slate-300 tracking-tight">
                  {stats.maxResponseTime}
                </span>
                <span className="text-[10px] text-slate-500 font-bold">ms</span>
              </div>
            </div>

            {/* Min Latency */}
            <div className="p-5 rounded-2xl glass-panel relative overflow-hidden">
              <span className="text-slate-500 text-xs font-semibold block">Optimal Response</span>
              <div className="mt-3 flex items-baseline space-x-1">
                <span className="text-2xl font-black text-emerald-500 tracking-tight">
                  {stats.minResponseTime}
                </span>
                <span className="text-[10px] text-slate-500 font-bold">ms</span>
              </div>
            </div>
          </section>
        )}

        {/* Visual Timelines Section (Uptime check grid blocks + Latency line graph) */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Uptime blocks timeline grid (occupies 1 col on desktop) */}
          <div className="p-6 rounded-2xl glass-panel lg:col-span-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <Calendar className="h-4.5 w-4.5 text-slate-500" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Checkpoint Timeline</h3>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed mb-6">
                Recent availability checkpoints. Green blocks represent successful responses; red blocks represent network / protocol incidents.
              </p>
            </div>

            {/* Timelines block grid (up to 40 blocks) */}
            <div className="flex flex-wrap gap-1.5 max-w-[280px]">
              {history.slice(-40).map((item, idx) => (
                <div
                  key={idx}
                  className={`h-4.5 w-4.5 rounded-md cursor-help ${
                    item.is_up 
                      ? 'bg-emerald-500/25 border border-emerald-500/35 hover:bg-emerald-500/50' 
                      : 'bg-rose-500/30 border border-rose-500/40 hover:bg-rose-500/60'
                  }`}
                  title={`Checked: ${new Date(item.checked_at).toLocaleTimeString()}\nStatus: ${item.is_up ? 'UP' : 'DOWN'}\nLatency: ${item.response_time}ms\nError: ${item.error_message || 'None'}`}
                />
              ))}
              {history.length === 0 && (
                <div className="text-[10px] text-slate-600 italic">Timeline loading...</div>
              )}
            </div>

            <div className="mt-8 pt-4 border-t border-white/5 flex items-center justify-between text-[9px] text-slate-500 font-bold uppercase tracking-widest">
              <span className="flex items-center space-x-1">
                <span className="h-2 w-2 rounded bg-emerald-500" />
                <span>UP</span>
              </span>
              <span className="flex items-center space-x-1">
                <span className="h-2 w-2 rounded bg-rose-500 animate-pulse" />
                <span>DOWN</span>
              </span>
            </div>
          </div>

          {/* Detailed Response Latency Line Chart (occupies 2 cols on desktop) */}
          <div className="p-6 rounded-2xl glass-panel lg:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-2">
                <BarChart2 className="h-4.5 w-4.5 text-slate-500" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Response Latency Trend</h3>
              </div>
              <span className="text-[9px] text-slate-500 font-bold tracking-widest uppercase">Last 100 Pings</span>
            </div>

            <div className="h-60 w-full">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" />
                    <XAxis 
                      dataKey="time" 
                      stroke="#475569" 
                      fontSize={9} 
                      tickLine={false} 
                      axisLine={false} 
                    />
                    <YAxis 
                      stroke="#475569" 
                      fontSize={9} 
                      tickLine={false} 
                      axisLine={false} 
                      unit="ms"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0d1423',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '12px',
                        boxShadow: '0 8px 32px 0 rgba(0,0,0,0.3)',
                        color: '#fff',
                        fontSize: '11px'
                      }}
                      labelClassName="text-slate-400 font-bold mb-1"
                    />
                    <Area 
                      type="monotone" 
                      dataKey="latency" 
                      name="Response (ms)"
                      stroke="#3b82f6" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorLatency)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-600 text-xs italic">
                  Plotting telemetry metrics...
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Tabular logs lists */}
        <section className="glass-panel rounded-2xl p-6 overflow-hidden">
          <div className="flex items-center space-x-2 mb-6">
            <Server className="h-4.5 w-4.5 text-slate-500" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Detailed Verification Check logs</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/5 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                  <th className="pb-3 pl-2">Checked At</th>
                  <th className="pb-3">Connection status</th>
                  <th className="pb-3">HTTP Code</th>
                  <th className="pb-3">Latency</th>
                  <th className="pb-3 pr-2">Diagnostics error</th>
                </tr>
              </thead>
              <tbody>
                {history.slice().reverse().map((item, idx) => (
                  <tr key={idx} className="border-b border-white/5 last:border-0 text-slate-300 hover:bg-white/[0.01] transition-colors">
                    <td className="py-3.5 pl-2 text-slate-400">
                      {new Date(item.checked_at).toLocaleString()}
                    </td>
                    <td className="py-3.5">
                      <span className={`inline-flex items-center space-x-1.5 py-0.5 px-2 rounded-full text-[10px] font-bold uppercase ${
                        item.is_up ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${item.is_up ? 'bg-emerald-400' : 'bg-rose-500 animate-pulse'}`} />
                        <span>{item.is_up ? 'SUCCESS' : 'FAILURE'}</span>
                      </span>
                    </td>
                    <td className="py-3.5 font-mono">
                      {item.status_code || '---'}
                    </td>
                    <td className="py-3.5 font-bold">
                      {item.is_up ? `${item.response_time} ms` : '---'}
                    </td>
                    <td className="py-3.5 text-slate-500 max-w-[200px] truncate" title={item.error_message || ''}>
                      {item.error_message || <span className="text-slate-600 font-normal italic">Clean</span>}
                    </td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 italic">
                      No check results recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
};

export default WebsiteDetail;
