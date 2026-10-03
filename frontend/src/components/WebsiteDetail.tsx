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
    const socketUrl = import.meta.env.VITE_API_URL !== undefined
      ? (import.meta.env.VITE_API_URL || undefined)
      : (import.meta.env.DEV ? 'http://localhost:3000' : undefined);
    const socket = io(socketUrl as any, {
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center glass-panel p-8 rounded-3xl shadow-2xl border border-white/10">
          <Activity className="h-10 w-10 text-white animate-spin" />
          <p className="mt-4 text-zinc-400 font-medium text-xs font-mono">Gathering checkpoint records...</p>
        </div>
      </div>
    );
  }

  if (!website) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center p-8 glass-panel rounded-2xl max-w-sm shadow-2xl border border-white/10">
          <ShieldAlert className="h-10 w-10 text-white mx-auto mb-3" />
          <p className="text-white text-sm font-bold">Monitored Site Not Found</p>
          <button 
            onClick={() => navigate('/')}
            className="mt-4 px-4 py-2 bg-white hover:bg-zinc-200 text-black font-bold rounded-xl text-xs cursor-pointer transition-all"
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
      {/* Navigation Header */}
      <header className="border-b border-zinc-800 py-4 px-6 md:px-12 flex justify-between items-center relative z-20 glass-panel">
        <button
          onClick={() => navigate('/')}
          className="flex items-center space-x-2 py-1.5 px-3.5 bg-zinc-900 hover:bg-black text-zinc-300 hover:text-white font-semibold rounded-lg text-xs border border-zinc-700 cursor-pointer transition-all"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Dashboard</span>
        </button>

        <div className="flex items-center space-x-3">
          <div className="p-2 bg-zinc-900 rounded-lg border border-zinc-700">
            <Activity className="h-4.5 w-4.5 text-white" />
          </div>
          <span className="font-bold tracking-tight text-white text-sm hidden sm:inline font-mono">
            ANTIGRAVITY DETECTOR
          </span>
        </div>
      </header>

      {/* Main Body */}
      <main className="max-w-7xl mx-auto px-4 md:px-8 mt-8 relative z-10">
        
        {/* Info Card Header */}
        <section className="glass-panel p-6 rounded-2xl mb-8 flex flex-col md:flex-row justify-between items-start md:items-center space-y-4 md:space-y-0 border border-zinc-800">
          <div>
            <div className="flex items-center space-x-3">
              <h2 className="text-xl font-extrabold text-white font-mono">{website.name}</h2>
              <span className={`text-[10px] font-bold uppercase tracking-wider py-0.5 px-2.5 rounded-full font-mono border ${
                website.enabled ? 'bg-zinc-800 text-white border-zinc-600' : 'bg-zinc-900 text-zinc-500 border-zinc-800'
              }`}>
                {website.enabled ? 'Active Monitor' : 'Disabled'}
              </span>
            </div>
            <a 
              href={website.url} 
              target="_blank" 
              rel="noreferrer" 
              className="text-xs text-zinc-400 hover:text-white transition-colors mt-1 block truncate max-w-sm sm:max-w-md font-mono"
            >
              {website.url}
            </a>
          </div>

          <div className="flex items-center space-x-3">
            {/* Range Toggle */}
            <div className="flex bg-zinc-950 p-1 rounded-lg border border-zinc-800">
              {(['24h', '7d', '30d'] as const).map(range => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md cursor-pointer transition-all ${
                    timeRange === range 
                      ? 'bg-white text-black font-bold shadow-sm' 
                      : 'text-zinc-400 hover:text-zinc-200'
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
              className="flex items-center justify-center space-x-1.5 py-1.5 px-3 bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-bold rounded-lg text-xs cursor-pointer disabled:opacity-30 transition-all shadow-sm"
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
            <div className="p-5 rounded-2xl glass-panel relative overflow-hidden border border-zinc-800">
              <span className="text-zinc-400 text-xs font-semibold block">Uptime Interval Ratio</span>
              <div className="mt-3 flex items-baseline space-x-1">
                <span className="text-2xl font-black text-white tracking-tight font-mono">
                  {stats.uptimePercentage.toFixed(3)}
                </span>
                <span className="text-[10px] text-zinc-400 font-bold">%</span>
              </div>
            </div>

            {/* Avg Latency */}
            <div className="p-5 rounded-2xl glass-panel relative overflow-hidden border border-zinc-800">
              <span className="text-zinc-400 text-xs font-semibold block">Average Latency</span>
              <div className="mt-3 flex items-baseline space-x-1">
                <span className="text-2xl font-black text-white tracking-tight font-mono">
                  {stats.avgResponseTime}
                </span>
                <span className="text-[10px] text-zinc-400 font-bold">ms</span>
              </div>
            </div>

            {/* Max Latency */}
            <div className="p-5 rounded-2xl glass-panel relative overflow-hidden border border-zinc-800">
              <span className="text-zinc-400 text-xs font-semibold block">Peak Node latency</span>
              <div className="mt-3 flex items-baseline space-x-1">
                <span className="text-2xl font-black text-white tracking-tight font-mono">
                  {stats.maxResponseTime}
                </span>
                <span className="text-[10px] text-zinc-400 font-bold">ms</span>
              </div>
            </div>

            {/* Min Latency */}
            <div className="p-5 rounded-2xl glass-panel relative overflow-hidden border border-zinc-800">
              <span className="text-zinc-400 text-xs font-semibold block">Optimal Response</span>
              <div className="mt-3 flex items-baseline space-x-1">
                <span className="text-2xl font-black text-white tracking-tight font-mono">
                  {stats.minResponseTime}
                </span>
                <span className="text-[10px] text-zinc-400 font-bold">ms</span>
              </div>
            </div>
          </section>
        )}

        {/* Visual Timelines Section (Uptime check grid blocks + Latency line graph) */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Uptime blocks timeline grid (occupies 1 col on desktop) */}
          <div className="p-6 rounded-2xl glass-panel lg:col-span-1 flex flex-col justify-between border border-zinc-800">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <Calendar className="h-4.5 w-4.5 text-zinc-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">Checkpoint Timeline</h3>
              </div>
              <p className="text-[10px] text-zinc-400 leading-relaxed mb-6 font-mono">
                Recent availability checkpoints. Solid white blocks represent successful responses; outlined blocks represent network / protocol incidents.
              </p>
            </div>

            {/* Timelines block grid (up to 40 blocks) */}
            <div className="flex flex-wrap gap-1.5 max-w-[280px]">
              {history.slice(-40).map((item, idx) => (
                <div
                  key={idx}
                  className={`h-4.5 w-4.5 rounded-md cursor-help transition-all ${
                    item.is_up 
                      ? 'bg-white hover:bg-zinc-200 border border-white' 
                      : 'bg-zinc-950 border border-zinc-600 hover:border-white'
                  }`}
                  title={`Checked: ${new Date(item.checked_at).toLocaleTimeString()}\nStatus: ${item.is_up ? 'UP' : 'DOWN'}\nLatency: ${item.response_time}ms\nError: ${item.error_message || 'None'}`}
                />
              ))}
              {history.length === 0 && (
                <div className="text-[10px] text-zinc-500 italic font-mono">Timeline loading...</div>
              )}
            </div>

            <div className="mt-8 pt-4 border-t border-zinc-800 flex items-center justify-between text-[9px] text-zinc-400 font-bold uppercase tracking-widest font-mono">
              <span className="flex items-center space-x-1.5">
                <span className="h-2 w-2 rounded bg-white" />
                <span>UP</span>
              </span>
              <span className="flex items-center space-x-1.5">
                <span className="h-2 w-2 rounded bg-zinc-950 border border-zinc-500" />
                <span>DOWN</span>
              </span>
            </div>
          </div>

          {/* Detailed Response Latency Line Chart (occupies 2 cols on desktop) */}
          <div className="p-6 rounded-2xl glass-panel lg:col-span-2 border border-zinc-800">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-2">
                <BarChart2 className="h-4.5 w-4.5 text-zinc-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">Response Latency Trend</h3>
              </div>
              <span className="text-[9px] text-zinc-400 font-bold tracking-widest uppercase font-mono">Last 100 Pings</span>
            </div>

            <div className="h-60 w-full">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ffffff" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#ffffff" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis 
                      dataKey="time" 
                      stroke="#71717a" 
                      fontSize={9} 
                      tickLine={false} 
                      axisLine={false} 
                    />
                    <YAxis 
                      stroke="#71717a" 
                      fontSize={9} 
                      tickLine={false} 
                      axisLine={false} 
                      unit="ms"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#09090b',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '12px',
                        boxShadow: '0 8px 32px 0 rgba(0,0,0,0.5)',
                        color: '#fff',
                        fontSize: '11px',
                        fontFamily: 'monospace'
                      }}
                      labelClassName="text-zinc-400 font-bold mb-1"
                    />
                    <Area 
                      type="monotone" 
                      dataKey="latency" 
                      name="Response (ms)"
                      stroke="#ffffff" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorLatency)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-zinc-500 text-xs italic font-mono">
                  Plotting telemetry metrics...
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Tabular logs lists */}
        <section className="glass-panel rounded-2xl p-6 overflow-hidden border border-zinc-800">
          <div className="flex items-center space-x-2 mb-6">
            <Server className="h-4.5 w-4.5 text-zinc-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">Detailed Verification Check logs</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400 font-bold uppercase tracking-wider text-[10px] font-mono">
                  <th className="pb-3 pl-2">Checked At</th>
                  <th className="pb-3">Connection status</th>
                  <th className="pb-3">HTTP Code</th>
                  <th className="pb-3">Latency</th>
                  <th className="pb-3 pr-2">Diagnostics error</th>
                </tr>
              </thead>
              <tbody>
                {history.slice().reverse().map((item, idx) => (
                  <tr key={idx} className="border-b border-zinc-800 last:border-0 text-zinc-300 hover:bg-zinc-800/40 transition-colors">
                    <td className="py-3.5 pl-2 text-zinc-400 font-mono">
                      {new Date(item.checked_at).toLocaleString()}
                    </td>
                    <td className="py-3.5">
                      <span className={`inline-flex items-center space-x-1.5 py-0.5 px-2.5 rounded-full text-[10px] font-mono font-bold uppercase border ${
                        item.is_up 
                          ? 'bg-zinc-800 text-white border-zinc-600' 
                          : 'bg-zinc-950 text-zinc-300 border-zinc-700'
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${item.is_up ? 'bg-white' : 'bg-transparent border border-white animate-pulse'}`} />
                        <span>{item.is_up ? 'SUCCESS' : 'FAILURE'}</span>
                      </span>
                    </td>
                    <td className="py-3.5 font-mono text-white">
                      {item.status_code || '---'}
                    </td>
                    <td className="py-3.5 font-mono font-bold text-white">
                      {item.is_up ? `${item.response_time} ms` : '---'}
                    </td>
                    <td className="py-3.5 text-zinc-400 max-w-[200px] truncate font-mono" title={item.error_message || ''}>
                      {item.error_message || <span className="text-zinc-500 font-normal italic">Clean</span>}
                    </td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-zinc-500 italic font-mono">
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
