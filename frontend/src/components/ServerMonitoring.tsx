import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Server, ArrowLeft, Cpu, HardDrive, RefreshCw, Plus,
  Search, Copy, Check, Trash2, Activity, Layers, X, ChevronRight
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';
import api from '../utils/api';
import io from 'socket.io-client';

export interface ServerItem {
  id: string;
  name: string;
  hostname: string;
  ip_address: string;
  os_name: string;
  os_version: string;
  kernel_version: string;
  architecture: string;
  cpu_cores: number;
  cpu_model: string;
  total_memory_bytes: string | number;
  total_disk_bytes: string | number;
  agent_version: string;
  agent_status: 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'INSTALLING' | 'UPGRADING';
  heartbeat_interval_seconds: number;
  last_heartbeat_at: string;
  docker_enabled: boolean;
  seconds_since_ping?: number;
  latest_cpu_percent?: number | string;
  latest_mem_percent?: number | string;
  latest_disk_percent?: number | string;
  latest_load_1m?: number | string;
  latest_docker_stats?: {
    active_containers?: number;
    total_containers?: number;
    containers?: Array<{
      id: string;
      name: string;
      image: string;
      state: string;
      status: string;
    }>;
  };
}

interface ServerDetailData {
  server: ServerItem;
  metrics: Array<{
    id: string;
    cpu_usage_percent: number;
    memory_usage_percent: number;
    disk_usage_percent: number;
    load_1m: number;
    top_processes: Array<{
      pid: number;
      name: string;
      user: string;
      cpu: number;
      mem: number;
    }>;
    docker_stats: any;
    created_at: string;
  }>;
}

interface ServerMonitoringProps {
  embedded?: boolean;
}

const ServerMonitoring: React.FC<ServerMonitoringProps> = ({ embedded = false }) => {
  const navigate = useNavigate();
  const [servers, setServers] = useState<ServerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Add Server Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [enableDocker, setEnableDocker] = useState(true);
  const [generatedCommand, setGeneratedCommand] = useState('');
  const [generatingToken, setGeneratingToken] = useState(false);
  const [copied, setCopied] = useState(false);

  // Detail Modal State
  const [selectedServer, setSelectedServer] = useState<ServerItem | null>(null);
  const [serverDetail, setServerDetail] = useState<ServerDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'charts' | 'processes' | 'docker' | 'diagnostics'>('charts');

  // Fetch servers from backend
  const fetchServers = async () => {
    try {
      const { data } = await api.get('/api/servers');
      if (data.success && Array.isArray(data.data)) {
        setServers(data.data);
      }
    } catch (err) {
      console.error('Error fetching servers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServers();

    // Socket.io for real-time status updates and telemetry
    const socket = io(import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin, {
      path: '/socket.io',
      transports: ['websocket', 'polling']
    });

    socket.on('server-status-changed', (evt: any) => {
      setServers(prev => prev.map(s => s.id === evt.serverId ? { ...s, agent_status: evt.status } : s));
    });

    socket.on('server-metrics-updated', (evt: any) => {
      setServers(prev => prev.map(s => {
        if (s.id === evt.serverId) {
          return {
            ...s,
            latest_cpu_percent: evt.cpu_usage_percent,
            latest_mem_percent: evt.memory_usage_percent,
            latest_disk_percent: evt.disk_usage_percent,
            latest_load_1m: evt.load_1m,
            latest_docker_stats: evt.docker_stats
          };
        }
        return s;
      }));
    });

    const refreshTimer = setInterval(fetchServers, 15000);

    return () => {
      socket.disconnect();
      clearInterval(refreshTimer);
    };
  }, []);

  // Generate Install Token & Command
  const handleGenerateInstallCommand = async (nameOverride?: string, dockerOverride?: boolean) => {
    setGeneratingToken(true);
    try {
      const nameToSend = nameOverride !== undefined ? nameOverride : newServerName;
      const dockerToSend = dockerOverride !== undefined ? dockerOverride : enableDocker;
      const { data } = await api.post('/api/servers/token', {
        server_name: nameToSend.trim() || undefined,
        enable_docker: dockerToSend
      });
      if (data.success && data.install_command) {
        setGeneratedCommand(data.install_command);
      }
    } catch (err) {
      console.error('Error generating token:', err);
    } finally {
      setGeneratingToken(false);
    }
  };

  // Open Add Modal
  const handleOpenAddModal = () => {
    setNewServerName('');
    setEnableDocker(true);
    setGeneratedCommand('');
    setShowAddModal(true);
    handleGenerateInstallCommand('', true);
  };

  // Immediate sync when typing server name
  const handleNameChange = (val: string) => {
    setNewServerName(val);
    setGeneratedCommand(prev => {
      if (!prev) return prev;
      const cleanVal = val.trim();
      if (cleanVal) {
        if (prev.includes('--name=')) {
          return prev.replace(/--name="[^"]*"/, `--name="${cleanVal}"`);
        } else {
          return prev.replace(/(\s*--disable-docker-monitoring|\s*--enable-docker-monitoring|$)/, ` --name="${cleanVal}"$1`);
        }
      } else {
        return prev.replace(/\s*--name="[^"]*"/, '');
      }
    });
  };

  const handleDockerChange = (val: boolean) => {
    setEnableDocker(val);
    setGeneratedCommand(prev => {
      if (!prev) return prev;
      if (val) {
        return prev.replace('--disable-docker-monitoring', '--enable-docker-monitoring');
      } else {
        return prev.replace('--enable-docker-monitoring', '--disable-docker-monitoring');
      }
    });
  };

  // Debounced token update when user types server name
  useEffect(() => {
    if (!showAddModal) return;
    const timer = setTimeout(() => {
      handleGenerateInstallCommand(newServerName, enableDocker);
    }, 450);
    return () => clearTimeout(timer);
  }, [newServerName, enableDocker, showAddModal]);

  // Copy command to clipboard
  const handleCopyCommand = () => {
    if (!generatedCommand) return;
    navigator.clipboard.writeText(generatedCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Open Server Detail
  const handleOpenDetail = async (server: ServerItem) => {
    setSelectedServer(server);
    setDetailLoading(true);
    setDetailTab('charts');
    try {
      const { data } = await api.get(`/api/servers/${server.id}`);
      if (data.success) {
        setServerDetail(data.data);
      }
    } catch (err) {
      console.error('Error fetching server detail:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  // Delete Server
  const handleDeleteServer = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to decommission and remove server "${name}"?`)) return;
    try {
      await api.delete(`/api/servers/${id}`);
      setServers(prev => prev.filter(s => s.id !== id));
      if (selectedServer?.id === id) {
        setSelectedServer(null);
      }
    } catch (err) {
      console.error('Error deleting server:', err);
    }
  };

  // Format Bytes to GB/MB
  const formatBytes = (bytes: string | number | undefined) => {
    const b = Number(bytes) || 0;
    if (b === 0) return '0 GB';
    const gb = b / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    return `${(b / (1024 * 1024)).toFixed(0)} MB`;
  };

  // Compute fleet statistics
  const totalServers = servers.length;
  const onlineServers = servers.filter(s => s.agent_status === 'ONLINE').length;
  const degradedServers = servers.filter(s => s.agent_status === 'DEGRADED').length;
  const offlineServers = servers.filter(s => s.agent_status === 'OFFLINE').length;

  const validCpuServers = servers.filter(s => s.latest_cpu_percent !== undefined);
  const avgCpu = validCpuServers.length > 0
    ? (validCpuServers.reduce((acc, s) => acc + Number(s.latest_cpu_percent || 0), 0) / validCpuServers.length).toFixed(1)
    : '0';

  const validMemServers = servers.filter(s => s.latest_mem_percent !== undefined);
  const avgMem = validMemServers.length > 0
    ? (validMemServers.reduce((acc, s) => acc + Number(s.latest_mem_percent || 0), 0) / validMemServers.length).toFixed(1)
    : '0';

  // Filter servers
  const filteredServers = servers.filter(s => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.hostname.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.ip_address && s.ip_address.includes(searchQuery));
    const matchesStatus = statusFilter === 'ALL' || s.agent_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className={embedded ? 'space-y-6' : 'min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-mono'}>
      
      {/* Non-embedded Navigation Header */}
      {!embedded && (
        <header className="max-w-7xl mx-auto w-full px-4 md:px-8 py-6 flex items-center justify-between border-b border-zinc-800">
          <button
            onClick={() => navigate('/')}
            className="flex items-center space-x-2 py-1.5 px-3 bg-zinc-900 hover:bg-black text-zinc-200 hover:text-white rounded-xl border border-zinc-700 transition-all text-xs font-semibold cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Dashboard</span>
          </button>

          <div className="flex items-center space-x-2">
            <Server className="h-5 w-5 text-white" />
            <span className="font-bold tracking-tight text-white text-sm uppercase">Antigravity Server Fleet</span>
          </div>
        </header>
      )}

      {/* Main Content Area */}
      <main className={embedded ? 'space-y-6' : 'flex-grow max-w-7xl mx-auto w-full px-4 md:px-8 py-8 space-y-8'}>
        
        {/* Top Header & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">
                Server Fleet Monitoring
              </h1>
              <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-emerald-950 text-emerald-300 rounded-full border border-emerald-800">
                Gravity v0.1
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1 font-normal">
              Hardened infrastructure daemons reporting host telemetry, CPU load, memory, disk, and Docker containers.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={fetchServers}
              className="p-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-xl border border-zinc-700 transition-all cursor-pointer"
              title="Refresh Servers"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleOpenAddModal}
              className="flex items-center space-x-2 px-4 py-2 bg-white hover:bg-zinc-200 text-black font-bold rounded-xl text-xs transition-all cursor-pointer shadow-md"
            >
              <Plus className="h-4 w-4" />
              <span>Add Server</span>
            </button>
          </div>
        </div>

        {/* Fleet Golden Metric Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-4">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Fleet Nodes</div>
            <div className="text-2xl font-extrabold text-white mt-1">{totalServers}</div>
            <div className="text-[10px] text-zinc-400 mt-1">Configured Servers</div>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-4">
            <div className="text-[10px] text-emerald-400 uppercase tracking-wider flex items-center space-x-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Online</span>
            </div>
            <div className="text-2xl font-extrabold text-white mt-1">{onlineServers}</div>
            <div className="text-[10px] text-zinc-400 mt-1">Heartbeat &lt; 30s</div>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-4">
            <div className="text-[10px] text-amber-400 uppercase tracking-wider flex items-center space-x-1">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <span>Degraded</span>
            </div>
            <div className="text-2xl font-extrabold text-white mt-1">{degradedServers}</div>
            <div className="text-[10px] text-zinc-400 mt-1">Delayed Ping (&gt; 30s)</div>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-4">
            <div className="text-[10px] text-red-400 uppercase tracking-wider flex items-center space-x-1">
              <span className="h-2 w-2 rounded-full bg-red-400" />
              <span>Offline</span>
            </div>
            <div className="text-2xl font-extrabold text-white mt-1">{offlineServers}</div>
            <div className="text-[10px] text-zinc-400 mt-1">Silent &gt; 90s</div>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-4">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Fleet Avg CPU</div>
            <div className="text-2xl font-extrabold text-white mt-1">{avgCpu}%</div>
            <div className="text-[10px] text-zinc-400 mt-1">Overall Usage</div>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-4">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Fleet Avg RAM</div>
            <div className="text-2xl font-extrabold text-white mt-1">{avgMem}%</div>
            <div className="text-[10px] text-zinc-400 mt-1">Allocated Memory</div>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-zinc-950/60 p-3 rounded-2xl border border-zinc-800">
          <div className="relative w-full sm:w-80">
            <Search className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search hostname, IP, or name..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl pl-9 pr-4 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 font-mono"
            />
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            {['ALL', 'ONLINE', 'DEGRADED', 'OFFLINE'].map(status => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1 rounded-xl text-[10px] font-bold uppercase transition-all cursor-pointer ${
                  statusFilter === status
                    ? 'bg-white text-black shadow-sm'
                    : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-zinc-800'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Server Cards Fleet Grid */}
        {filteredServers.length === 0 ? (
          <div className="bg-zinc-950/80 border border-zinc-800 rounded-3xl p-12 text-center max-w-xl mx-auto">
            <Server className="h-12 w-12 text-zinc-600 mx-auto mb-4" />
            <h3 className="text-base font-bold text-white">No Monitored Servers Found</h3>
            <p className="text-xs text-zinc-400 mt-2 max-w-md mx-auto leading-relaxed">
              Install the Gravity Agent on your Linux servers to start streaming host metrics, container activity, and load statistics.
            </p>
            <button
              onClick={handleOpenAddModal}
              className="mt-6 px-4 py-2 bg-white text-black font-bold rounded-xl text-xs shadow-md hover:bg-zinc-200 transition-all cursor-pointer"
            >
              + Add First Server
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredServers.map(server => {
              const cpuVal = Number(server.latest_cpu_percent || 0);
              const memVal = Number(server.latest_mem_percent || 0);
              const diskVal = Number(server.latest_disk_percent || 0);
              const isOnline = server.agent_status === 'ONLINE';
              const isDegraded = server.agent_status === 'DEGRADED';

              const statusColor = isOnline
                ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                : isDegraded
                ? 'bg-amber-950 text-amber-300 border-amber-800'
                : 'bg-red-950 text-red-300 border-red-800';

              return (
                <div
                  key={server.id}
                  className="bg-zinc-950/90 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-5 transition-all shadow-md flex flex-col justify-between"
                >
                  <div>
                    {/* Card Header */}
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border flex items-center space-x-1 ${statusColor}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : isDegraded ? 'bg-amber-400' : 'bg-red-400'}`} />
                            <span>{server.agent_status}</span>
                          </span>
                          <span className="text-[10px] text-zinc-500 font-mono">
                            {server.architecture}
                          </span>
                        </div>
                        <h3 className="font-bold text-white text-sm tracking-tight truncate max-w-[200px]" title={server.name}>
                          {server.name}
                        </h3>
                        <div className="text-[11px] text-zinc-400 flex items-center space-x-2">
                          <span className="font-mono text-zinc-300">{server.hostname}</span>
                          <span>·</span>
                          <span className="text-zinc-500">{server.ip_address || '127.0.0.1'}</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] px-2 py-0.5 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded font-mono">
                          {server.agent_version}
                        </span>
                        <div className="text-[9px] text-zinc-500 mt-1">
                          {server.seconds_since_ping !== undefined && server.seconds_since_ping < 60
                            ? `${server.seconds_since_ping}s ago`
                            : 'Heartbeat OK'}
                        </div>
                      </div>
                    </div>

                    {/* OS Specs Pill */}
                    <div className="mt-3 py-1 px-2.5 bg-zinc-900/60 rounded-lg border border-zinc-800/80 text-[10px] text-zinc-400 flex items-center justify-between">
                      <span className="truncate">{server.os_name} {server.os_version}</span>
                      <span className="text-zinc-500 font-mono text-[9px] ml-2 shrink-0">{server.cpu_cores} Cores</span>
                    </div>

                    {/* Gauge Bars */}
                    <div className="mt-4 space-y-3">
                      {/* CPU Gauge */}
                      <div>
                        <div className="flex justify-between text-[10px] mb-1">
                          <span className="text-zinc-400 flex items-center space-x-1">
                            <Cpu className="h-3 w-3 text-zinc-500" />
                            <span>CPU Usage</span>
                          </span>
                          <span className={`font-bold ${cpuVal > 80 ? 'text-red-400' : 'text-zinc-200'}`}>
                            {cpuVal}%
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 ${
                              cpuVal > 80 ? 'bg-red-500' : cpuVal > 50 ? 'bg-amber-400' : 'bg-white'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, cpuVal))}%` }}
                          />
                        </div>
                      </div>

                      {/* Memory Gauge */}
                      <div>
                        <div className="flex justify-between text-[10px] mb-1">
                          <span className="text-zinc-400 flex items-center space-x-1">
                            <Activity className="h-3 w-3 text-zinc-500" />
                            <span>Memory</span>
                          </span>
                          <span className={`font-bold ${memVal > 85 ? 'text-red-400' : 'text-zinc-200'}`}>
                            {memVal}% ({formatBytes(server.total_memory_bytes)})
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 ${
                              memVal > 85 ? 'bg-red-500' : memVal > 60 ? 'bg-amber-400' : 'bg-zinc-300'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, memVal))}%` }}
                          />
                        </div>
                      </div>

                      {/* Disk Gauge */}
                      <div>
                        <div className="flex justify-between text-[10px] mb-1">
                          <span className="text-zinc-400 flex items-center space-x-1">
                            <HardDrive className="h-3 w-3 text-zinc-500" />
                            <span>Storage</span>
                          </span>
                          <span className="text-zinc-300 font-bold">
                            {diskVal}% ({formatBytes(server.total_disk_bytes)})
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-zinc-400 transition-all duration-500"
                            style={{ width: `${Math.min(100, Math.max(0, diskVal))}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Docker Container Indicator */}
                    <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-[11px]">
                      <div className="flex items-center space-x-1.5 text-zinc-400">
                        <Layers className="h-3.5 w-3.5 text-zinc-500" />
                        <span>Docker</span>
                      </div>
                      {server.docker_enabled ? (
                        <span className="text-zinc-200 font-bold text-[10px]">
                          {server.latest_docker_stats?.active_containers ?? 0} active / {server.latest_docker_stats?.total_containers ?? 0} total
                        </span>
                      ) : (
                        <span className="text-zinc-600 text-[10px]">Disabled</span>
                      )}
                    </div>
                  </div>

                  {/* Actions footer */}
                  <div className="mt-5 pt-3 border-t border-zinc-800 flex items-center justify-between gap-2">
                    <button
                      onClick={() => handleOpenDetail(server)}
                      className="flex-grow py-1.5 px-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white rounded-xl text-xs font-semibold border border-zinc-700 transition-all cursor-pointer flex items-center justify-center space-x-1"
                    >
                      <span>Diagnostics & Charts</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>

                    <button
                      onClick={() => handleDeleteServer(server.id, server.name)}
                      className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-red-900"
                      title="Decommission Server"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* =================================================================== */}
      {/* MODAL: ADD SERVER & ONE-LINE INSTALL SCRIPT                        */}
      {/* =================================================================== */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-3xl max-w-2xl w-full p-6 space-y-6 shadow-2xl relative font-mono">
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute top-5 right-5 text-zinc-500 hover:text-white transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <div>
              <div className="flex items-center space-x-2">
                <Server className="h-5 w-5 text-white" />
                <h3 className="text-lg font-bold text-white">Add Monitored Server</h3>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                Deploy the self-contained Gravity Agent daemon on any Ubuntu or Debian node.
              </p>
            </div>

            {/* Configuration Inputs */}
            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-zinc-400 uppercase tracking-wider block mb-1">
                  Server Name (Optional Label)
                </label>
                <input
                  type="text"
                  placeholder="e.g. srv-app-01, db-primary-01"
                  value={newServerName}
                  onChange={e => handleNameChange(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-zinc-900/60 rounded-xl border border-zinc-800">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-white flex items-center space-x-1.5">
                    <Layers className="h-3.5 w-3.5 text-zinc-400" />
                    <span>Enable Docker Container Monitoring</span>
                  </div>
                  <div className="text-[10px] text-zinc-400">
                    Grants agent read access to /var/run/docker.sock for container CPU/RAM stats.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={enableDocker}
                  onChange={e => handleDockerChange(e.target.checked)}
                  className="h-4 w-4 rounded bg-zinc-800 border-zinc-700 text-white cursor-pointer"
                />
              </div>
            </div>

            {/* Generated Command Box */}
            <div>
              <div className="flex items-center justify-between text-[10px] text-zinc-400 uppercase tracking-wider mb-1.5">
                <span>One-Line Quick Install Command (Run as root)</span>
                <button
                  onClick={() => handleGenerateInstallCommand()}
                  className="text-white hover:underline flex items-center space-x-1 cursor-pointer"
                >
                  <RefreshCw className={`h-3 w-3 ${generatingToken ? 'animate-spin' : ''}`} />
                  <span>Regenerate Token</span>
                </button>
              </div>

              <div className="relative bg-black rounded-2xl border border-zinc-800 p-4">
                <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap break-all pr-12 select-all">
                  {generatedCommand || 'Generating secure install token...'}
                </pre>
                <button
                  onClick={handleCopyCommand}
                  className="absolute right-3 top-3 p-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl border border-zinc-700 transition-all cursor-pointer shadow-md"
                  title="Copy command"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Production Hardening Highlights */}
            <div className="bg-zinc-900/40 p-3.5 rounded-xl border border-zinc-800/80 text-[11px] text-zinc-400 space-y-1.5">
              <div className="font-bold text-zinc-200">✓ Production Hardening Guarantees:</div>
              <div>• <b>Zero NVM Dependency:</b> Uses dedicated isolated runtime in <code className="text-zinc-300">/opt/gravity/runtime/node</code>.</div>
              <div>• <b>Systemd Daemon:</b> Auto-restarts on failure (<code className="text-zinc-300">Restart=on-failure</code>) and persists across reboots.</div>
              <div>• <b>Strict Validation:</b> Post-installation check verifies systemd active state before reporting success.</div>
              <div>• <b>Local CLI:</b> Run <code className="text-zinc-300">gravity status</code> or <code className="text-zinc-300">gravity diagnose</code> on the host anytime.</div>
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-xl text-xs font-semibold cursor-pointer border border-zinc-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: SERVER DIAGNOSTICS & TELEMETRY DETAIL                       */}
      {/* =================================================================== */}
      {selectedServer && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-3xl max-w-4xl w-full p-6 space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto font-mono">
            <button
              onClick={() => setSelectedServer(null)}
              className="absolute top-5 right-5 text-zinc-500 hover:text-white transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Modal Header */}
            <div className="flex items-start justify-between pr-8">
              <div>
                <div className="flex items-center space-x-2">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border ${
                    selectedServer.agent_status === 'ONLINE' ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-amber-950 text-amber-300 border-amber-800'
                  }`}>
                    {selectedServer.agent_status}
                  </span>
                  <span className="text-xs text-zinc-500 font-mono">Gravity {selectedServer.agent_version}</span>
                </div>
                <h2 className="text-xl font-bold text-white mt-1">{selectedServer.name}</h2>
                <div className="text-xs text-zinc-400 mt-0.5">
                  Host: <span className="text-white">{selectedServer.hostname}</span> · IP: <span className="text-zinc-300">{selectedServer.ip_address}</span> · OS: <span className="text-zinc-300">{selectedServer.os_name} {selectedServer.os_version}</span>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center space-x-2 border-b border-zinc-800 pb-2">
              <button
                onClick={() => setDetailTab('charts')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  detailTab === 'charts' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Telemetry Graphs
              </button>
              <button
                onClick={() => setDetailTab('processes')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  detailTab === 'processes' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Top Processes
              </button>
              <button
                onClick={() => setDetailTab('docker')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  detailTab === 'docker' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Docker Containers
              </button>
              <button
                onClick={() => setDetailTab('diagnostics')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  detailTab === 'diagnostics' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Host Diagnostics
              </button>
            </div>

            {detailLoading ? (
              <div className="py-12 text-center text-zinc-500">
                <Activity className="h-8 w-8 mx-auto animate-spin mb-2" />
                <span>Loading telemetry timeseries...</span>
              </div>
            ) : (
              <>
                {/* TAB 1: CHARTS */}
                {detailTab === 'charts' && (
                  <div className="space-y-6">
                    {/* CPU & Memory Chart */}
                    <div className="bg-zinc-900/60 p-4 rounded-2xl border border-zinc-800">
                      <div className="text-xs font-bold text-white mb-4 flex items-center justify-between">
                        <span>CPU & Memory Utilization History (Recent Samples)</span>
                        <div className="flex items-center space-x-4 text-[10px]">
                          <span className="flex items-center space-x-1">
                            <span className="h-2 w-2 rounded-full bg-white" />
                            <span>CPU %</span>
                          </span>
                          <span className="flex items-center space-x-1">
                            <span className="h-2 w-2 rounded-full bg-emerald-400" />
                            <span>RAM %</span>
                          </span>
                        </div>
                      </div>
                      <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={serverDetail?.metrics || []}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                            <XAxis
                              dataKey="created_at"
                              tick={{ fill: '#71717a', fontSize: 10 }}
                              tickFormatter={t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            />
                            <YAxis domain={[0, 100]} tick={{ fill: '#71717a', fontSize: 10 }} unit="%" />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '12px' }}
                              labelFormatter={l => new Date(l).toLocaleString()}
                            />
                            <Line type="monotone" dataKey="cpu_usage_percent" name="CPU" stroke="#ffffff" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="memory_usage_percent" name="RAM" stroke="#34d399" strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Hardware Summary Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div className="p-3 bg-zinc-900/40 rounded-xl border border-zinc-800">
                        <div className="text-zinc-500 text-[10px]">CPU Hardware</div>
                        <div className="text-white font-bold mt-0.5">{selectedServer.cpu_cores} Cores</div>
                        <div className="text-[10px] text-zinc-400 truncate">{selectedServer.cpu_model}</div>
                      </div>
                      <div className="p-3 bg-zinc-900/40 rounded-xl border border-zinc-800">
                        <div className="text-zinc-500 text-[10px]">System Memory</div>
                        <div className="text-white font-bold mt-0.5">{formatBytes(selectedServer.total_memory_bytes)}</div>
                        <div className="text-[10px] text-zinc-400">{selectedServer.latest_mem_percent || 0}% active</div>
                      </div>
                      <div className="p-3 bg-zinc-900/40 rounded-xl border border-zinc-800">
                        <div className="text-zinc-500 text-[10px]">Storage Partition</div>
                        <div className="text-white font-bold mt-0.5">{formatBytes(selectedServer.total_disk_bytes)}</div>
                        <div className="text-[10px] text-zinc-400">{selectedServer.latest_disk_percent || 0}% root disk used</div>
                      </div>
                      <div className="p-3 bg-zinc-900/40 rounded-xl border border-zinc-800">
                        <div className="text-zinc-500 text-[10px]">OS Kernel</div>
                        <div className="text-white font-bold mt-0.5">{selectedServer.kernel_version || 'Linux standard'}</div>
                        <div className="text-[10px] text-zinc-400">{selectedServer.architecture}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 2: TOP PROCESSES */}
                {detailTab === 'processes' && (
                  <div className="bg-zinc-900/60 rounded-2xl border border-zinc-800 overflow-hidden">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-zinc-900 text-zinc-400 text-[10px] uppercase border-b border-zinc-800">
                        <tr>
                          <th className="p-3">PID</th>
                          <th className="p-3">Command</th>
                          <th className="p-3">User</th>
                          <th className="p-3">CPU %</th>
                          <th className="p-3">RAM %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/60">
                        {(serverDetail?.metrics[serverDetail.metrics.length - 1]?.top_processes || []).map((p, idx) => (
                          <tr key={idx} className="hover:bg-zinc-800/40">
                            <td className="p-3 font-mono text-zinc-500">{p.pid}</td>
                            <td className="p-3 font-bold text-white font-mono">{p.name}</td>
                            <td className="p-3 text-zinc-400">{p.user}</td>
                            <td className="p-3 font-bold text-zinc-200">{p.cpu}%</td>
                            <td className="p-3 font-bold text-zinc-200">{p.mem}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* TAB 3: DOCKER CONTAINERS */}
                {detailTab === 'docker' && (
                  <div className="space-y-4">
                    {selectedServer.docker_enabled ? (
                      <div className="bg-zinc-900/60 rounded-2xl border border-zinc-800 overflow-hidden">
                        <table className="w-full text-left text-xs font-mono">
                          <thead className="bg-zinc-900 text-zinc-400 text-[10px] uppercase border-b border-zinc-800">
                            <tr>
                              <th className="p-3">Container</th>
                              <th className="p-3">Image</th>
                              <th className="p-3">State</th>
                              <th className="p-3">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-800/60">
                            {(selectedServer.latest_docker_stats?.containers || []).map((c: any, idx: number) => (
                              <tr key={idx} className="hover:bg-zinc-800/40">
                                <td className="p-3 font-bold text-white">{c.name}</td>
                                <td className="p-3 text-zinc-400 font-mono text-[11px]">{c.image}</td>
                                <td className="p-3">
                                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                                    c.state === 'running' ? 'bg-emerald-950 text-emerald-300' : 'bg-zinc-800 text-zinc-400'
                                  }`}>
                                    {c.state}
                                  </span>
                                </td>
                                <td className="p-3 text-zinc-400 text-[10px]">{c.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="p-8 text-center text-zinc-500 bg-zinc-900/40 rounded-2xl border border-zinc-800">
                        <Layers className="h-8 w-8 mx-auto mb-2 text-zinc-600" />
                        <p className="text-xs font-bold text-zinc-300">Docker Monitoring is Disabled on this Host</p>
                        <p className="text-[11px] text-zinc-500 mt-1">Reinstall with <code className="text-zinc-400">--enable-docker-monitoring</code> to inspect container metrics.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 4: HOST DIAGNOSTICS */}
                {detailTab === 'diagnostics' && (
                  <div className="space-y-4">
                    <div className="bg-zinc-900/40 p-4 rounded-2xl border border-zinc-800 space-y-3">
                      <div className="text-xs font-bold text-white">Production Host Diagnostic Checklist</div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                        <div className="flex items-center space-x-2 text-emerald-400">
                          <Check className="h-4 w-4" />
                          <span>Dedicated Node Runtime: /opt/gravity/runtime/node</span>
                        </div>
                        <div className="flex items-center space-x-2 text-emerald-400">
                          <Check className="h-4 w-4" />
                          <span>Systemd Service: gravity-agent.service (Active)</span>
                        </div>
                        <div className="flex items-center space-x-2 text-emerald-400">
                          <Check className="h-4 w-4" />
                          <span>NVM Independence: Decoupled from user shell</span>
                        </div>
                        <div className="flex items-center space-x-2 text-emerald-400">
                          <Check className="h-4 w-4" />
                          <span>Protected Credentials: /etc/gravity/agent.env (0600)</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-black p-4 rounded-2xl border border-zinc-800">
                      <div className="text-xs font-bold text-zinc-300 mb-2">CLI Management Quick Reference</div>
                      <div className="space-y-2 text-xs text-zinc-400 font-mono">
                        <div><code className="text-white">gravity status</code> - Inspect systemd unit and process health</div>
                        <div><code className="text-white">gravity health</code> - Run end-to-end subsystem verification</div>
                        <div><code className="text-white">gravity diagnose</code> - Check runtime, permissions, and network</div>
                        <div><code className="text-white">gravity logs -n 50</code> - View recent redacted telemetry logs</div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end pt-2 border-t border-zinc-800">
              <button
                onClick={() => setSelectedServer(null)}
                className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-xl text-xs font-semibold cursor-pointer border border-zinc-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ServerMonitoring;
