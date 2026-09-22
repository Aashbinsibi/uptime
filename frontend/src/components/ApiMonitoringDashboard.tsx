import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import io from 'socket.io-client';
import { 
  Activity, AlertTriangle, CheckCircle2, Clock, Cpu, 
  Layers, Plus, RefreshCw, Search, 
  ShieldAlert, ShieldCheck, Terminal, Trash2, X, Zap, GitCommit, Flame,
  FileCode, Play
} from 'lucide-react';

interface GoldenSignals {
  latency: {
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    avg_ms: number;
  };
  errors: {
    rate_4xx: number;
    rate_5xx: number;
    count_4xx: number;
    count_5xx: number;
    status: string;
  };
  traffic: {
    rps: number;
    requests_last_5m: number;
  };
  saturation: {
    cpu_load_percent: number;
    system_memory_percent: number;
    process_heap_percent: number;
    status: string;
  };
}

interface SloOverview {
  monitored_endpoints_count: number;
  average_error_budget_remaining_percent: number;
  service_status: 'HEALTHY' | 'DEGRADED' | 'EXHAUSTED';
}

interface OverviewData {
  golden_signals: GoldenSignals;
  slo_overview: SloOverview;
}

interface ApiEndpointItem {
  id: string;
  service_name: string;
  name: string;
  path: string;
  http_method: string;
  headers: Record<string, string>;
  body: string | null;
  expected_status_code: number;
  assertion_keyword: string | null;
  slo_availability: number;
  slo_latency_p95_ms: number;
  current_deployment_version: string;
  previous_deployment_version: string | null;
  check_interval: number;
  timeout: number;
  enabled: boolean;
  baseline_p50?: number;
  baseline_p95?: number;
  baseline_p99?: number;
  baseline_is_regression?: boolean;
  regression_details?: any;
  live_metrics_5m?: {
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    error_rate_5xx: number;
    error_rate_4xx: number;
    total_requests: number;
    rps: number;
    sample_trace_id: string | null;
  };
  slo_status?: {
    fast_burn: { is_firing: boolean; burn_rate_5m: number; burn_rate_1h: number };
    slow_burn: { is_firing: boolean; burn_rate_30m: number; burn_rate_6h: number };
    latency_slo_breach: { is_breached: boolean; current_p95_ms: number; slo_p95_ms: number };
    error_rate_breach: { is_breached: boolean; current_5xx_rate: number };
    error_budget_remaining_percent: number;
    projected_exhaustion_hours: number | null;
    latest_trace_id: string | null;
  };
}

interface TraceModalData {
  traceId: string;
  endpointName: string;
  method: string;
  statusCode: number;
  durationMs: number;
  version: string;
  error?: string | null;
}

const ApiMonitoringDashboard: React.FC = () => {
  // Navigation sub-view inside the 3-Level Hierarchy
  const [levelView, setLevelView] = useState<'all' | 'level1' | 'level2' | 'level3'>('all');
  
  // Data States
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [endpoints, setEndpoints] = useState<ApiEndpointItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [serviceFilter, setServiceFilter] = useState('all');

  // Interactive Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState<ApiEndpointItem | null>(null);
  const [selectedTrace, setSelectedTrace] = useState<TraceModalData | null>(null);

  // Endpoint Form state
  const [formServiceName, setFormServiceName] = useState('core-api');
  const [formName, setFormName] = useState('');
  const [formPath, setFormPath] = useState('');
  const [formMethod, setFormMethod] = useState('GET');
  const [formHeaders, setFormHeaders] = useState('{}');
  const [formBody, setFormBody] = useState('');
  const [formExpectedStatus, setFormExpectedStatus] = useState(200);
  const [formAssertion, setFormAssertion] = useState('');
  const [formSloAvailability, setFormSloAvailability] = useState(99.9);
  const [formSloP95, setFormSloP95] = useState(300);
  const [formCurrentVersion, setFormCurrentVersion] = useState('v1.0.0');
  const [formPrevVersion, setFormPrevVersion] = useState('');
  const [formInterval, setFormInterval] = useState(30);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // CI/CD Pre-Deploy Validator state
  const [ciNewVersion, setCiNewVersion] = useState('v2.4.0');
  const [ciPrevVersion, setCiPrevVersion] = useState('v2.3.9');
  const [ciResult, setCiResult] = useState<any | null>(null);
  const [ciLoading, setCiLoading] = useState(false);

  // Manual probe states
  const [probingIds, setProbingIds] = useState<Record<string, boolean>>({});

  // 1. Fetch Golden Signals & Endpoints
  const fetchData = async () => {
    try {
      const [ovRes, epRes] = await Promise.all([
        api.get('/api/api-monitoring/overview'),
        api.get('/api/api-monitoring/endpoints')
      ]);

      if (ovRes.data.success) {
        setOverview(ovRes.data.data);
      }
      if (epRes.data.success) {
        setEndpoints(epRes.data.data);
      }
    } catch (err) {
      console.error('[API Monitoring] Fetch error:', err);
    }
  };

  useEffect(() => {
    fetchData();

    // 2. Real-time updates via Socket.io
    const socketUrl = import.meta.env.VITE_API_URL !== undefined
      ? (import.meta.env.VITE_API_URL || undefined)
      : (import.meta.env.DEV ? 'http://localhost:3000' : undefined);

    const socket = io(socketUrl as any, { withCredentials: true });

    socket.on('api-telemetry-recorded', (data: any) => {
      setEndpoints(prev =>
        prev.map(ep => {
          if (ep.id === data.endpoint_id) {
            const currentTotal = ep.live_metrics_5m?.total_requests || 0;
            return {
              ...ep,
              live_metrics_5m: {
                ...(ep.live_metrics_5m || {
                  p50_ms: data.response_time_ms,
                  p95_ms: data.response_time_ms,
                  p99_ms: data.response_time_ms,
                  error_rate_5xx: data.is_error ? 100 : 0,
                  error_rate_4xx: 0,
                  total_requests: 1,
                  rps: 0.1,
                  sample_trace_id: data.trace_id
                }),
                p50_ms: data.response_time_ms,
                total_requests: currentTotal + 1,
                sample_trace_id: data.trace_id
              }
            };
          }
          return ep;
        })
      );
    });

    socket.on('slo-status-updated', (status: any) => {
      setEndpoints(prev =>
        prev.map(ep => {
          if (ep.id === status.endpoint_id) {
            return { ...ep, slo_status: status };
          }
          return ep;
        })
      );
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Quick Seed Demo APIs
  const handleSeedDemoData = async () => {
    try {
      await api.post('/api/api-monitoring/seed');
      await fetchData();
    } catch (err) {
      console.error('Seed error:', err);
    }
  };

  // Trigger manual probe check
  const handleTriggerProbe = async (id: string) => {
    setProbingIds(prev => ({ ...prev, [id]: true }));
    try {
      await api.post(`/api/api-monitoring/endpoints/${id}/check`);
      setTimeout(() => fetchData(), 800);
    } catch (err) {
      console.error('Probe error:', err);
    } finally {
      setTimeout(() => setProbingIds(prev => ({ ...prev, [id]: false })), 1200);
    }
  };

  // Open Endpoint Detail / Edit
  const handleOpenDetail = (ep: ApiEndpointItem) => {
    handleOpenEditModal(ep);
  };

  // Run CI/CD Pre-deploy comparison
  const handleRunCiCdTest = async () => {
    setCiLoading(true);
    try {
      const { data } = await api.get(`/api/api-monitoring/deployments/compare?v_new=${ciNewVersion}&v_prev=${ciPrevVersion}`);
      if (data.success) {
        setCiResult(data.data);
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'CI/CD check failed');
    } finally {
      setCiLoading(false);
    }
  };

  // Modal open helpers
  const handleOpenAddModal = () => {
    setEditingEndpoint(null);
    setFormServiceName('core-api');
    setFormName('');
    setFormPath('');
    setFormMethod('GET');
    setFormHeaders('{}');
    setFormBody('');
    setFormExpectedStatus(200);
    setFormAssertion('');
    setFormSloAvailability(99.9);
    setFormSloP95(300);
    setFormCurrentVersion('v1.0.0');
    setFormPrevVersion('');
    setFormInterval(30);
    setFormError('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (ep: ApiEndpointItem) => {
    setEditingEndpoint(ep);
    setFormServiceName(ep.service_name);
    setFormName(ep.name);
    setFormPath(ep.path);
    setFormMethod(ep.http_method);
    setFormHeaders(typeof ep.headers === 'object' ? JSON.stringify(ep.headers, null, 2) : ep.headers || '{}');
    setFormBody(ep.body || '');
    setFormExpectedStatus(ep.expected_status_code);
    setFormAssertion(ep.assertion_keyword || '');
    setFormSloAvailability(ep.slo_availability);
    setFormSloP95(ep.slo_latency_p95_ms);
    setFormCurrentVersion(ep.current_deployment_version);
    setFormPrevVersion(ep.previous_deployment_version || '');
    setFormInterval(ep.check_interval);
    setFormError('');
    setIsModalOpen(true);
  };

  // Submit Endpoint
  const handleSubmitEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSubmitting(true);

    let parsedHeaders = {};
    try {
      parsedHeaders = JSON.parse(formHeaders || '{}');
    } catch {
      setFormError('Invalid JSON format in Request Headers');
      setFormSubmitting(false);
      return;
    }

    const payload = {
      service_name: formServiceName,
      name: formName,
      path: formPath,
      http_method: formMethod,
      headers: parsedHeaders,
      body: formBody || null,
      expected_status_code: Number(formExpectedStatus),
      assertion_keyword: formAssertion || null,
      slo_availability: Number(formSloAvailability),
      slo_latency_p95_ms: Number(formSloP95),
      current_deployment_version: formCurrentVersion,
      previous_deployment_version: formPrevVersion || null,
      check_interval: Number(formInterval)
    };

    try {
      if (editingEndpoint) {
        const { data } = await api.put(`/api/api-monitoring/endpoints/${editingEndpoint.id}`, payload);
        if (data.success) {
          setIsModalOpen(false);
          fetchData();
        }
      } else {
        const { data } = await api.post('/api/api-monitoring/endpoints', payload);
        if (data.success) {
          setIsModalOpen(false);
          fetchData();
        }
      }
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Failed to save endpoint.');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDeleteEndpoint = async (id: string, name: string) => {
    if (!window.confirm(`Stop monitoring API endpoint "${name}"?`)) return;
    try {
      await api.delete(`/api/api-monitoring/endpoints/${id}`);
      fetchData();
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  // Distinct service names for filtering
  const distinctServices = Array.from(new Set(endpoints.map(e => e.service_name || 'core-api')));

  // Filtered endpoints
  const filteredEndpoints = endpoints.filter(ep => {
    const matchesSearch = ep.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ep.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ep.current_deployment_version.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesService = serviceFilter === 'all' || ep.service_name === serviceFilter;
    return matchesSearch && matchesService;
  });

  return (
    <div className="space-y-8 animate-fadeIn text-zinc-100 font-mono">
      
      {/* TOP TITLE & HIERARCHY CONTROLS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-6">
        <div>
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">
              Production API Observability
            </h1>
            <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-zinc-800 text-zinc-200 rounded-full border border-zinc-700">
              SRE SLO Engine
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1.5 font-sans">
            Golden Signals (Latency P50/P95/P99, Error Rates, Traffic, Saturation), Multi-Window Multi-Burn-Rate alerting, and per-deployment regression detection.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          {endpoints.length === 0 && (
            <button
              onClick={handleSeedDemoData}
              className="px-3.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-xl text-xs font-semibold border border-zinc-700 transition-all cursor-pointer flex items-center space-x-1.5"
            >
              <Zap className="h-3.5 w-3.5 text-white" />
              <span>Seed Demo APIs & SLOs</span>
            </button>
          )}

          <button
            onClick={handleOpenAddModal}
            className="flex items-center space-x-1.5 py-1.5 px-4 bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-bold rounded-xl text-xs transition-all cursor-pointer shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>Add API Endpoint</span>
          </button>
        </div>
      </div>

      {/* 3-LEVEL HIERARCHY NAVIGATION PILLS */}
      <div className="flex items-center space-x-2 text-xs border-b border-zinc-800/80 pb-3">
        <span className="text-zinc-500 mr-2 text-[11px] uppercase tracking-wider">Hierarchy:</span>
        <button
          onClick={() => setLevelView('all')}
          className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
            levelView === 'all'
              ? 'bg-white text-black font-bold'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          Full 3-Level View
        </button>
        <button
          onClick={() => setLevelView('level1')}
          className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
            levelView === 'level1'
              ? 'bg-white text-black font-bold'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          Level 1: Service Overview
        </button>
        <button
          onClick={() => setLevelView('level2')}
          className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
            levelView === 'level2'
              ? 'bg-white text-black font-bold'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          Level 2: Per-Endpoint & Regressions
        </button>
        <button
          onClick={() => setLevelView('level3')}
          className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
            levelView === 'level3'
              ? 'bg-white text-black font-bold'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          Level 3: SLO Burn-Rates & CI/CD
        </button>
      </div>

      {/* ========================================================================= */}
      {/* LEVEL 1: SERVICE OVERVIEW - GOLDEN SIGNALS & ERROR BUDGET MATRIX           */}
      {/* ========================================================================= */}
      {(levelView === 'all' || levelView === 'level1') && overview && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold tracking-wider text-zinc-400 uppercase flex items-center space-x-2">
              <Layers className="h-4 w-4 text-white" />
              <span>LEVEL 1: SERVICE OVERVIEW — GOLDEN SIGNALS & 30-DAY ERROR BUDGET</span>
            </h2>
            <div className="flex items-center space-x-2 text-xs">
              <span className="text-zinc-500">Service Status:</span>
              <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] ${
                overview.slo_overview.service_status === 'HEALTHY'
                  ? 'bg-zinc-800 text-white border border-zinc-600'
                  : overview.slo_overview.service_status === 'DEGRADED'
                  ? 'bg-zinc-900 text-zinc-300 border border-zinc-700'
                  : 'bg-black text-white border border-white animate-pulse'
              }`}>
                {overview.slo_overview.service_status}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Card 1: Latency Golden Signal (P50, P95, P99) */}
            <div className="bg-zinc-950/90 border border-zinc-800 rounded-2xl p-5 shadow-sm hover:border-zinc-700 transition-all">
              <div className="flex items-center justify-between text-zinc-400 text-xs">
                <span className="font-semibold uppercase tracking-wider text-[11px]">1. LATENCY (TAIL SPIKES)</span>
                <Clock className="h-4 w-4 text-white" />
              </div>
              <div className="mt-3 flex items-baseline space-x-2">
                <span className="text-3xl font-extrabold text-white">
                  {overview.golden_signals.latency.p95_ms}
                  <span className="text-xs font-normal text-zinc-400 ml-1">ms (P95)</span>
                </span>
              </div>
              <div className="mt-3 pt-3 border-t border-zinc-800/80 grid grid-cols-3 text-[10px] text-zinc-400">
                <div>
                  <span className="block text-zinc-500">P50</span>
                  <span className="font-bold text-zinc-200">{overview.golden_signals.latency.p50_ms}ms</span>
                </div>
                <div>
                  <span className="block text-zinc-500">P95</span>
                  <span className="font-bold text-white">{overview.golden_signals.latency.p95_ms}ms</span>
                </div>
                <div>
                  <span className="block text-zinc-500">P99</span>
                  <span className="font-bold text-zinc-200">{overview.golden_signals.latency.p99_ms}ms</span>
                </div>
              </div>
            </div>

            {/* Card 2: Error Rate (4xx / 5xx) */}
            <div className="bg-zinc-950/90 border border-zinc-800 rounded-2xl p-5 shadow-sm hover:border-zinc-700 transition-all">
              <div className="flex items-center justify-between text-zinc-400 text-xs">
                <span className="font-semibold uppercase tracking-wider text-[11px]">2. ERRORS (5XX & 4XX)</span>
                <ShieldAlert className="h-4 w-4 text-white" />
              </div>
              <div className="mt-3 flex items-baseline space-x-2">
                <span className={`text-3xl font-extrabold ${overview.golden_signals.errors.rate_5xx > 1.0 ? 'text-white underline' : 'text-white'}`}>
                  {overview.golden_signals.errors.rate_5xx}%
                </span>
                <span className="text-xs text-zinc-400">5xx rate</span>
              </div>
              <div className="mt-3 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-[10px] text-zinc-400">
                <span>4xx Rate: <strong className="text-zinc-200">{overview.golden_signals.errors.rate_4xx}%</strong></span>
                <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${overview.golden_signals.errors.rate_5xx > 1.0 ? 'bg-black text-white border border-white' : 'bg-zinc-900 text-zinc-300'}`}>
                  {overview.golden_signals.errors.rate_5xx > 1.0 ? '>1% SLO ALERT' : 'UNDER 1% SLO'}
                </span>
              </div>
            </div>

            {/* Card 3: Traffic & Throughput (RPS) */}
            <div className="bg-zinc-950/90 border border-zinc-800 rounded-2xl p-5 shadow-sm hover:border-zinc-700 transition-all">
              <div className="flex items-center justify-between text-zinc-400 text-xs">
                <span className="font-semibold uppercase tracking-wider text-[11px]">3. TRAFFIC (THROUGHPUT)</span>
                <Activity className="h-4 w-4 text-white" />
              </div>
              <div className="mt-3 flex items-baseline space-x-2">
                <span className="text-3xl font-extrabold text-white">
                  {overview.golden_signals.traffic.rps}
                </span>
                <span className="text-xs text-zinc-400">req / sec</span>
              </div>
              <div className="mt-3 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-[10px] text-zinc-400">
                <span>5-min Volume:</span>
                <span className="font-bold text-zinc-200">{overview.golden_signals.traffic.requests_last_5m.toLocaleString()} calls</span>
              </div>
            </div>

            {/* Card 4: Saturation & 30-Day Error Budget */}
            <div className="bg-zinc-950/90 border border-zinc-800 rounded-2xl p-5 shadow-sm hover:border-zinc-700 transition-all">
              <div className="flex items-center justify-between text-zinc-400 text-xs">
                <span className="font-semibold uppercase tracking-wider text-[11px]">4. SATURATION & BUDGET</span>
                <Cpu className="h-4 w-4 text-white" />
              </div>
              <div className="mt-3 flex items-baseline space-x-2">
                <span className="text-3xl font-extrabold text-white">
                  {overview.slo_overview.average_error_budget_remaining_percent}%
                </span>
                <span className="text-xs text-zinc-400">budget left</span>
              </div>
              <div className="mt-3 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-[10px] text-zinc-400">
                <span>CPU: <strong className="text-zinc-200">{overview.golden_signals.saturation.cpu_load_percent}%</strong></span>
                <span>RAM: <strong className="text-zinc-200">{overview.golden_signals.saturation.system_memory_percent}%</strong></span>
              </div>
            </div>

          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* LEVEL 2: PER-ENDPOINT DETAIL & REGRESSION DETECTION                       */}
      {/* ========================================================================= */}
      {(levelView === 'all' || levelView === 'level2') && (
        <section className="space-y-4 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-xs font-bold tracking-wider text-zinc-400 uppercase flex items-center space-x-2">
                <Terminal className="h-4 w-4 text-white" />
                <span>LEVEL 2: PER-ENDPOINT DETAIL & REGRESSION DETECTION</span>
              </h2>
              <p className="text-[11px] text-zinc-500 mt-0.5 font-sans">
                Segments telemetry by endpoint, HTTP method, deployment version, and percentile latency.
              </p>
            </div>

            {/* Filters */}
            <div className="flex items-center space-x-3">
              {distinctServices.length > 1 && (
                <select
                  value={serviceFilter}
                  onChange={e => setServiceFilter(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl py-1 px-3 text-xs text-white focus:outline-none"
                >
                  <option value="all">All Services</option>
                  {distinctServices.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )}

              <div className="relative">
                <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Filter endpoint, version, url..."
                  className="bg-zinc-900 border border-zinc-800 rounded-xl py-1.5 pl-8 pr-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-700 w-48 sm:w-64"
                />
              </div>
            </div>
          </div>

          {/* Endpoints Table */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl overflow-hidden shadow-md">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-950/60 text-zinc-400 border-b border-zinc-800 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="p-4">Service & Endpoint</th>
                    <th className="p-4">Deployment</th>
                    <th className="p-4">Latency Percentiles (P50 / P95 / P99)</th>
                    <th className="p-4">SLO Compliance</th>
                    <th className="p-4">Regression Status</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {filteredEndpoints.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-zinc-500">
                        No API endpoints configured yet. Click "Add API Endpoint" above or "Seed Demo APIs".
                      </td>
                    </tr>
                  ) : (
                    filteredEndpoints.map(ep => {
                      const p50 = ep.live_metrics_5m?.p50_ms || ep.baseline_p50 || 0;
                      const p95 = ep.live_metrics_5m?.p95_ms || ep.baseline_p95 || 0;
                      const p99 = ep.live_metrics_5m?.p99_ms || ep.baseline_p99 || 0;
                      const isBreached = p95 > ep.slo_latency_p95_ms;
                      const isRegression = ep.baseline_is_regression === true;
                      const isProbing = probingIds[ep.id];
                      const sampleTrace = ep.live_metrics_5m?.sample_trace_id || ep.slo_status?.latest_trace_id;

                      // Method color styling
                      const methodBadge = 
                        ep.http_method === 'GET' ? 'bg-zinc-800 text-zinc-200 border-zinc-700' :
                        ep.http_method === 'POST' ? 'bg-white text-black font-bold' :
                        ep.http_method === 'PUT' ? 'bg-zinc-800 text-white border-zinc-600' :
                        'bg-zinc-900 text-zinc-400 border-zinc-800';

                      return (
                        <tr key={ep.id} className="hover:bg-zinc-800/30 transition-colors">
                          
                          {/* Col 1: Service & Path */}
                          <td className="p-4">
                            <div className="flex items-center space-x-2">
                              <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${methodBadge}`}>
                                {ep.http_method}
                              </span>
                              <span 
                                onClick={() => handleOpenDetail(ep)}
                                className="font-bold text-white hover:underline cursor-pointer"
                              >
                                {ep.name}
                              </span>
                            </div>
                            <div className="text-[11px] text-zinc-400 flex items-center space-x-1.5 mt-1 font-sans">
                              <span className="text-zinc-500 font-mono">[{ep.service_name}]</span>
                              <span className="truncate max-w-xs">{ep.path}</span>
                            </div>
                          </td>

                          {/* Col 2: Version Tag */}
                          <td className="p-4">
                            <div className="flex items-center space-x-1.5">
                              <GitCommit className="h-3.5 w-3.5 text-zinc-500" />
                              <span className="font-bold text-white">{ep.current_deployment_version}</span>
                            </div>
                            {ep.previous_deployment_version && (
                              <span className="text-[10px] text-zinc-500 block mt-0.5">
                                prev: {ep.previous_deployment_version}
                              </span>
                            )}
                          </td>

                          {/* Col 3: P50 / P95 / P99 */}
                          <td className="p-4">
                            <div className="flex items-center space-x-2">
                              <div className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-center min-w-[52px]">
                                <span className="text-[9px] text-zinc-500 block">P50</span>
                                <span className="font-bold text-zinc-300">{p50}ms</span>
                              </div>
                              <div className={`p-1.5 rounded-lg border text-center min-w-[56px] ${isBreached ? 'bg-black border-white text-white' : 'bg-zinc-950 border-zinc-800 text-white font-bold'}`}>
                                <span className="text-[9px] text-zinc-400 block">P95</span>
                                <span className="font-bold">{p95}ms</span>
                              </div>
                              <div className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-center min-w-[52px]">
                                <span className="text-[9px] text-zinc-500 block">P99</span>
                                <span className="font-bold text-zinc-300">{p99}ms</span>
                              </div>
                            </div>
                          </td>

                          {/* Col 4: SLO Compliance */}
                          <td className="p-4">
                            <div className="space-y-1">
                              <div className="flex items-center space-x-1.5 text-[11px]">
                                {isBreached ? (
                                  <span className="px-2 py-0.5 rounded-full bg-black text-white border border-white text-[10px] font-bold">
                                    P95 &gt; {ep.slo_latency_p95_ms}ms (Breached)
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-white border border-zinc-600 text-[10px] font-bold flex items-center space-x-1">
                                    <CheckCircle2 className="h-3 w-3 text-white" />
                                    <span>P95 &le; {ep.slo_latency_p95_ms}ms SLO</span>
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-zinc-500 block">
                                Avail target: {ep.slo_availability}%
                              </span>
                            </div>
                          </td>

                          {/* Col 5: Per-Deployment Regression Detection */}
                          <td className="p-4">
                            {isRegression ? (
                              <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-black text-white border border-white text-[10px] font-bold animate-pulse">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                <span>&gt;20% REGRESSION</span>
                              </div>
                            ) : ep.previous_deployment_version ? (
                              <div className="inline-flex items-center space-x-1 text-zinc-300 text-[10px]">
                                <CheckCircle2 className="h-3 w-3 text-white" />
                                <span>No regression vs prev</span>
                              </div>
                            ) : (
                              <span className="text-zinc-500 text-[10px]">Baseline establishing...</span>
                            )}
                          </td>

                          {/* Col 6: Actions & Traces */}
                          <td className="p-4 text-right">
                            <div className="flex items-center justify-end space-x-1.5">
                              {/* Trace Inspector Button */}
                              {sampleTrace && (
                                <button
                                  onClick={() => setSelectedTrace({
                                    traceId: sampleTrace,
                                    endpointName: ep.name,
                                    method: ep.http_method,
                                    statusCode: ep.expected_status_code,
                                    durationMs: p95,
                                    version: ep.current_deployment_version
                                  })}
                                  title="Inspect Distributed Trace"
                                  className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 text-[10px] font-semibold flex items-center space-x-1 cursor-pointer"
                                >
                                  <Terminal className="h-3 w-3" />
                                  <span>Trace</span>
                                </button>
                              )}

                              {/* Probe Button */}
                              <button
                                onClick={() => handleTriggerProbe(ep.id)}
                                disabled={isProbing}
                                title="Run Probe Now"
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 transition-all cursor-pointer"
                              >
                                <RefreshCw className={`h-3.5 w-3.5 ${isProbing ? 'animate-spin text-white' : ''}`} />
                              </button>

                              {/* Edit Button */}
                              <button
                                onClick={() => handleOpenEditModal(ep)}
                                title="Edit Endpoint"
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 cursor-pointer"
                              >
                                <FileCode className="h-3.5 w-3.5" />
                              </button>

                              {/* Delete Button */}
                              <button
                                onClick={() => handleDeleteEndpoint(ep.id, ep.name)}
                                title="Delete Endpoint"
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white border border-zinc-700 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>

                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* LEVEL 3: SRE MULTI-WINDOW MULTI-BURN-RATE & CI/CD VALIDATION              */}
      {/* ========================================================================= */}
      {(levelView === 'all' || levelView === 'level3') && (
        <section className="space-y-6 pt-2">
          <div>
            <h2 className="text-xs font-bold tracking-wider text-zinc-400 uppercase flex items-center space-x-2">
              <Flame className="h-4 w-4 text-white" />
              <span>LEVEL 3: SRE MULTI-WINDOW MULTI-BURN-RATE & CI/CD REGRESSION TESTING</span>
            </h2>
            <p className="text-[11px] text-zinc-500 mt-0.5 font-sans">
              Google SRE methodology: Fast-burn alerts (14.4x rate over 5m/1h) page on-call; Slow-burn alerts (3.0x rate over 30m/6h) notify Slack/email.
            </p>
          </div>

          {/* SRE Burn-Rate Rule Matrix */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Fast-Burn Card */}
            <div className="bg-zinc-950/90 border border-zinc-800 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white">
                    <Flame className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">Fast-Burn Alert (Pages On-Call)</h3>
                    <p className="text-[10px] text-zinc-400 font-sans">14.4x Burn Rate sustained over 5-min & 1-hr windows</p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-zinc-800 text-white border border-zinc-600">
                  Critical
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-3 font-sans leading-relaxed">
                Consumes 2% of the monthly error budget in 1 hour. Sustained at this rate, 100% of the error budget will be completely exhausted within 50 hours.
              </p>
              <div className="mt-4 pt-3 border-t border-zinc-800 flex items-center justify-between text-[11px]">
                <span className="text-zinc-500">Dual window check:</span>
                <span className="font-bold text-zinc-200">5m BR &ge; 14.4 & 1h BR &ge; 14.4</span>
              </div>
            </div>

            {/* Slow-Burn Card */}
            <div className="bg-zinc-950/90 border border-zinc-800 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white">
                    <Clock className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">Slow-Burn Alert (Slack / Email)</h3>
                    <p className="text-[10px] text-zinc-400 font-sans">3.0x Burn Rate sustained over 30-min & 6-hr windows</p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-zinc-900 text-zinc-300 border border-zinc-700">
                  Warning
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-3 font-sans leading-relaxed">
                Consumes 5% of the error budget in 6 hours. Detects subtle performance leaks, elevated error rates, and regressions before full outage occurs.
              </p>
              <div className="mt-4 pt-3 border-t border-zinc-800 flex items-center justify-between text-[11px]">
                <span className="text-zinc-500">Dual window check:</span>
                <span className="font-bold text-zinc-200">30m BR &ge; 3.0 & 6h BR &ge; 3.0</span>
              </div>
            </div>

          </div>

          {/* CI/CD PRE-DEPLOY LOAD TEST VALIDATOR (k6 integration hook) */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-md">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                  <Terminal className="h-4 w-4 text-white" />
                  <span>CI/CD Pre-Deploy Regression Validator (k6 / GitHub Actions)</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-1 font-sans">
                  Automatically compare P50/P95/P99 latency percentiles between canary deployments before promoting to production.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-zinc-800">
              <div>
                <label className="block text-zinc-400 text-[11px] mb-1">New Deployment Version (Canary)</label>
                <input
                  type="text"
                  value={ciNewVersion}
                  onChange={e => setCiNewVersion(e.target.value)}
                  placeholder="e.g. v2.4.0"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-1.5 px-3 text-xs text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-zinc-400 text-[11px] mb-1">Previous Baseline Version</label>
                <input
                  type="text"
                  value={ciPrevVersion}
                  onChange={e => setCiPrevVersion(e.target.value)}
                  placeholder="e.g. v2.3.9"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-1.5 px-3 text-xs text-white focus:outline-none"
                />
              </div>

              <div className="flex items-end">
                <button
                  onClick={handleRunCiCdTest}
                  disabled={ciLoading}
                  className="w-full py-2 bg-white hover:bg-zinc-200 text-black font-bold rounded-xl text-xs transition-all cursor-pointer flex items-center justify-center space-x-1.5 shadow-sm"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>{ciLoading ? 'Evaluating...' : 'Run Regression Test'}</span>
                </button>
              </div>
            </div>

            {/* CI/CD Result Display */}
            {ciResult && (
              <div className="mt-4 p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-zinc-400">CI/CD Verdict:</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                      ciResult.allow_rollout
                        ? 'bg-zinc-800 text-white border border-zinc-600'
                        : 'bg-black text-white border border-white animate-pulse'
                    }`}>
                      {ciResult.verdict}
                    </span>
                  </div>
                  <span className="text-zinc-400 text-[11px]">
                    Status: {ciResult.allow_rollout ? 'Safe to Deploy (No >20% Regression)' : 'Rollout Blocked'}
                  </span>
                </div>

                <div className="mt-3 divide-y divide-zinc-800/60 font-mono text-[11px]">
                  {ciResult.endpoints?.map((r: any) => (
                    <div key={r.endpoint_id} className="py-2 flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white">{r.endpoint_name}</span>
                        <span className="text-zinc-500">({r.http_method} {r.path})</span>
                      </div>
                      <div>
                        {r.has_regression ? (
                          <span className="text-white font-bold bg-black px-2 py-0.5 rounded border border-white">
                            ⚠️ Latency Regressed &gt;20%: {r.details?.regressed_metrics?.join(', ')}
                          </span>
                        ) : (
                          <span className="text-zinc-300">✓ Within SLO Baseline</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </section>
      )}

      {/* ========================================================================= */}
      {/* DISTRIBUTED TRACE INSPECTOR MODAL                                         */}
      {/* ========================================================================= */}
      {selectedTrace && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn font-mono">
          <div className="bg-zinc-950 border border-zinc-800 rounded-3xl max-w-2xl w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setSelectedTrace(null)}
              className="absolute top-5 right-5 text-zinc-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center space-x-2.5 mb-4">
              <div className="p-2 bg-zinc-900 rounded-lg border border-zinc-700 text-white">
                <Terminal className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Distributed Trace Inspector</h3>
                <span className="text-xs text-zinc-500">W3C Traceparent Root-Cause Analysis</span>
              </div>
            </div>

            {/* Trace Meta */}
            <div className="p-3.5 bg-zinc-900/80 rounded-xl border border-zinc-800 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Trace ID:</span>
                <span className="font-bold text-white font-mono">{selectedTrace.traceId}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Target Endpoint:</span>
                <span className="text-zinc-200">{selectedTrace.method} {selectedTrace.endpointName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Deployment Version:</span>
                <span className="text-zinc-200">{selectedTrace.version}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Total Duration:</span>
                <span className="font-bold text-white">{selectedTrace.durationMs} ms</span>
              </div>
            </div>

            {/* Waterfall Spans */}
            <div className="mt-5">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                Execution Span Waterfall
              </h4>
              <div className="space-y-2 text-[11px]">
                {/* Span 1: DNS */}
                <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="h-2 w-2 rounded-full bg-zinc-500" />
                    <span className="text-zinc-300">dns_lookup</span>
                  </div>
                  <span className="text-zinc-400">6 ms</span>
                </div>

                {/* Span 2: TCP + TLS */}
                <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="h-2 w-2 rounded-full bg-zinc-400" />
                    <span className="text-zinc-300">tcp_tls_handshake</span>
                  </div>
                  <span className="text-zinc-400">22 ms</span>
                </div>

                {/* Span 3: App Handler */}
                <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="h-2 w-2 rounded-full bg-white" />
                    <span className="text-white font-semibold">express_route_handler</span>
                  </div>
                  <span className="text-white font-bold">{Math.max(10, selectedTrace.durationMs - 45)} ms</span>
                </div>

                {/* Span 4: DB Query */}
                <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="h-2 w-2 rounded-full bg-zinc-400" />
                    <span className="text-zinc-300">postgres_pool_query</span>
                  </div>
                  <span className="text-zinc-400">12 ms</span>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setSelectedTrace(null)}
                className="px-4 py-2 bg-white text-black font-bold rounded-xl text-xs cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ADD / EDIT API ENDPOINT MODAL                                             */}
      {/* ========================================================================= */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn font-mono">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-5 right-5 text-zinc-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center space-x-2.5 mb-5">
              <div className="p-2 bg-zinc-900 rounded-lg border border-zinc-700 text-white">
                <Terminal className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-white">
                {editingEndpoint ? 'Configure Production API Endpoint' : 'Register Production API Endpoint'}
              </h3>
            </div>

            {formError && (
              <div className="p-3 mb-4 rounded-xl bg-zinc-900 border border-white text-white text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmitEndpoint} className="space-y-4 text-xs">
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 mb-1">Friendly Endpoint Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. User Auth & Token Issuer"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>

                <div>
                  <label className="block text-zinc-400 mb-1">Service Cluster Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. auth-service"
                    value={formServiceName}
                    onChange={e => setFormServiceName(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              {/* Method and URL */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-zinc-400 mb-1">HTTP Method</label>
                  <select
                    value={formMethod}
                    onChange={e => setFormMethod(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-white focus:outline-none"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                    <option value="DELETE">DELETE</option>
                    <option value="HEAD">HEAD</option>
                  </select>
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-zinc-400 mb-1">Endpoint URL</label>
                  <input
                    type="url"
                    required
                    placeholder="https://api.example.com/v1/auth/tokens"
                    value={formPath}
                    onChange={e => setFormPath(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              {/* SRE SLO Targets */}
              <div className="p-3.5 bg-zinc-900/60 rounded-xl border border-zinc-800 space-y-3">
                <h4 className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider flex items-center space-x-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-white" />
                  <span>SRE Service Level Objectives (SLOs)</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-zinc-400 mb-1">Availability SLO (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="90"
                      max="100"
                      value={formSloAvailability}
                      onChange={e => setFormSloAvailability(Number(e.target.value))}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-1.5 px-3 text-white"
                    />
                    <span className="text-[10px] text-zinc-500 mt-0.5 block">e.g. 99.9% (Error budget = 0.1%)</span>
                  </div>

                  <div>
                    <label className="block text-zinc-400 mb-1">P95 Latency SLO Target (ms)</label>
                    <input
                      type="number"
                      step="10"
                      min="1"
                      max="10000"
                      value={formSloP95}
                      onChange={e => setFormSloP95(Number(e.target.value))}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-1.5 px-3 text-white"
                    />
                    <span className="text-[10px] text-zinc-500 mt-0.5 block">Alerts if 5-min P95 exceeds this</span>
                  </div>
                </div>
              </div>

              {/* Deployment Versioning (for Regression Analysis) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 mb-1">Current Deployment Version</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. v2.4.0"
                    value={formCurrentVersion}
                    onChange={e => setFormCurrentVersion(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-1.5 px-3 text-white"
                  />
                </div>

                <div>
                  <label className="block text-zinc-400 mb-1">Previous Baseline Version (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. v2.3.9"
                    value={formPrevVersion}
                    onChange={e => setFormPrevVersion(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-1.5 px-3 text-white"
                  />
                  <span className="text-[10px] text-zinc-500 mt-0.5 block">Used for &gt;20% regression comparison</span>
                </div>
              </div>

              {/* Request Headers JSON */}
              <div>
                <label className="block text-zinc-400 mb-1">Request Headers (JSON format)</label>
                <textarea
                  rows={2}
                  value={formHeaders}
                  onChange={e => setFormHeaders(e.target.value)}
                  placeholder='{"Authorization": "Bearer ...", "Content-Type": "application/json"}'
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-1.5 px-3 text-white font-mono text-[11px]"
                />
              </div>

              {/* Body (for POST/PUT) */}
              {['POST', 'PUT', 'PATCH'].includes(formMethod) && (
                <div>
                  <label className="block text-zinc-400 mb-1">Request Payload (JSON or Text)</label>
                  <textarea
                    rows={3}
                    value={formBody}
                    onChange={e => setFormBody(e.target.value)}
                    placeholder='{"query": "status"}'
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-1.5 px-3 text-white font-mono text-[11px]"
                  />
                </div>
              )}

              {/* Expected Status & Assertion */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-zinc-400 mb-1">Expected Status Code</label>
                  <input
                    type="number"
                    value={formExpectedStatus}
                    onChange={e => setFormExpectedStatus(Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-1.5 px-3 text-white"
                  />
                </div>

                <div>
                  <label className="block text-zinc-400 mb-1">Keyword Assertion (Optional)</label>
                  <input
                    type="text"
                    placeholder='e.g. "status": "ok"'
                    value={formAssertion}
                    onChange={e => setFormAssertion(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-1.5 px-3 text-white"
                  />
                </div>

                <div>
                  <label className="block text-zinc-400 mb-1">Probe Interval</label>
                  <select
                    value={formInterval}
                    onChange={e => setFormInterval(Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-1.5 px-3 text-white"
                  >
                    <option value={15}>Every 15 seconds</option>
                    <option value={30}>Every 30 seconds</option>
                    <option value={60}>Every 1 minute</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-800 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black font-bold cursor-pointer"
                >
                  {formSubmitting ? 'Saving...' : editingEndpoint ? 'Update Endpoint' : 'Save Endpoint'}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default ApiMonitoringDashboard;
