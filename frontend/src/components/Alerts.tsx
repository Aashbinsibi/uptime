import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { 
  ArrowLeft, Bell, Clock, CheckCircle2, 
  BookMarked, CheckSquare, ShieldCheck
} from 'lucide-react';

interface AlertItem {
  id: string;
  website_id: string;
  website_name: string;
  website_url: string;
  type: string;
  status: 'active' | 'acknowledged' | 'resolved';
  message: string;
  triggered_at: string;
  resolved_at: string | null;
}

const Alerts: React.FC = () => {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'acknowledged' | 'resolved'>('all');
  const [actioningIds, setActioningIds] = useState<Record<string, boolean>>({});

  const fetchAlerts = async () => {
    try {
      const url = statusFilter === 'all' ? '/api/alerts' : `/api/alerts?status=${statusFilter}`;
      const { data } = await api.get(url);
      if (data.success) {
        setAlerts(data.data);
      }
    } catch (error) {
      console.error('[Alerts UI] Failed to fetch alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, [statusFilter]);

  // Acknowledge active alert
  const handleAcknowledge = async (alertId: string) => {
    setActioningIds(prev => ({ ...prev, [alertId]: true }));
    try {
      const { data } = await api.put(`/api/alerts/${alertId}/acknowledge`);
      if (data.success) {
        // Update local state status
        setAlerts(prev => 
          prev.map(a => a.id === alertId ? { ...a, status: 'acknowledged' } : a)
        );
      }
    } catch (error) {
      console.error('[Alerts UI] Acknowledge error:', error);
    } finally {
      setActioningIds(prev => ({ ...prev, [alertId]: false }));
    }
  };

  // Resolve alert
  const handleResolve = async (alertId: string) => {
    setActioningIds(prev => ({ ...prev, [alertId]: true }));
    try {
      const { data } = await api.put(`/api/alerts/${alertId}/resolve`);
      if (data.success) {
        // Update status and resolved_at
        setAlerts(prev => 
          prev.map(a => a.id === alertId ? { ...a, status: 'resolved', resolved_at: new Date().toISOString() } : a)
        );
      }
    } catch (error) {
      console.error('[Alerts UI] Resolve error:', error);
    } finally {
      setActioningIds(prev => ({ ...prev, [alertId]: false }));
    }
  };

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
            <Bell className="h-4.5 w-4.5 text-white" />
          </div>
          <span className="font-bold tracking-tight text-white text-sm hidden sm:inline font-mono">
            CORE DISPATCHER
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 md:px-8 mt-8 relative z-10">
        
        {/* Page Title */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 space-y-4 sm:space-y-0">
          <div>
            <h2 className="text-xl font-bold text-black tracking-wide font-mono">Incidents Logs</h2>
            <p className="text-xs text-zinc-600 mt-1">Audit trail of automated website check failures and manual acknowledgments.</p>
          </div>

          {/* Status Tab Filters */}
          <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800 shadow-sm">
            {(['all', 'active', 'acknowledged', 'resolved'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => {
                  setLoading(true);
                  setStatusFilter(tab);
                }}
                className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg cursor-pointer transition-all ${
                  statusFilter === tab 
                    ? 'bg-white text-black font-bold shadow-sm' 
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Alerts Grid Render */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(n => (
              <div key={n} className="h-28 rounded-2xl glass-panel shimmer border border-zinc-800" />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <div className="py-20 text-center rounded-2xl glass-panel border border-zinc-800">
            <CheckCircle2 className="h-12 w-12 text-white mx-auto mb-4" />
            <p className="text-white text-sm font-bold font-mono">All Channels Operational</p>
            <p className="text-zinc-400 text-xs mt-1.5 max-w-sm mx-auto leading-relaxed">
              No recent alert incidents matched your active filters. Monitoring checkers are reporting healthy responses.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {alerts.map((alert) => {
              const triggeredDate = new Date(alert.triggered_at);
              const resolvedDate = alert.resolved_at ? new Date(alert.resolved_at) : null;
              
              let pulseColor = 'bg-zinc-500';
              let badgeBorder = 'border-zinc-800 text-zinc-400 bg-zinc-900';
              let cardBorder = 'border-zinc-800 hover:border-zinc-700';

              if (alert.status === 'active') {
                pulseColor = 'bg-white animate-pulse';
                badgeBorder = 'border-white text-white bg-zinc-900 font-mono';
                cardBorder = 'border-zinc-700 hover:border-zinc-500';
              } else if (alert.status === 'acknowledged') {
                pulseColor = 'bg-zinc-400';
                badgeBorder = 'border-zinc-600 text-zinc-300 bg-zinc-900 font-mono';
                cardBorder = 'border-zinc-800 hover:border-zinc-700';
              } else if (alert.status === 'resolved') {
                pulseColor = 'bg-zinc-600';
                badgeBorder = 'border-zinc-800 text-zinc-500 bg-zinc-950 font-mono';
                cardBorder = 'border-zinc-900 hover:border-zinc-800';
              }

              return (
                <article
                  key={alert.id}
                  className={`rounded-2xl glass-panel p-5 relative overflow-hidden transition-all duration-300 grid grid-cols-1 md:grid-cols-4 gap-4 items-center border ${cardBorder}`}
                >
                  
                  {/* Col 1: Status Node & Web info */}
                  <div className="md:col-span-1">
                    <div className="flex items-center space-x-2.5 mb-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${pulseColor}`} />
                      <span className={`text-[9px] font-extrabold uppercase tracking-widest py-0.5 px-2 rounded-full border ${badgeBorder}`}>
                        {alert.status}
                      </span>
                    </div>
                    <h3 className="text-xs font-bold text-white truncate font-mono" title={alert.website_name}>
                      {alert.website_name}
                    </h3>
                    <a 
                      href={alert.website_url} 
                      target="_blank" 
                      rel="noreferrer" 
                      className="text-[10px] text-zinc-400 hover:text-white transition-colors truncate block mt-0.5 font-mono"
                    >
                      {alert.website_url}
                    </a>
                  </div>

                  {/* Col 2: Incident Message Details */}
                  <div className="md:col-span-2">
                    <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider block mb-1 font-mono">Alert Diagnosis</span>
                    <p className="text-xs text-zinc-300 font-medium font-mono leading-relaxed" title={alert.message}>
                      {alert.message}
                    </p>
                  </div>

                  {/* Col 3: Timelines / Action panel */}
                  <div className="md:col-span-1 flex flex-col md:items-end justify-between h-full space-y-4 md:space-y-0">
                    {/* Timestamp clocks */}
                    <div className="text-[10px] text-zinc-400 space-y-1 font-mono">
                      <div className="flex items-center space-x-1.5">
                        <Clock className="h-3.5 w-3.5 text-zinc-400" />
                        <span>Triggered: {triggeredDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      {resolvedDate && (
                        <div className="flex items-center space-x-1.5">
                          <ShieldCheck className="h-3.5 w-3.5 text-white" />
                          <span>Resolved: {resolvedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    {alert.status !== 'resolved' && (
                      <div className="flex space-x-2 mt-2">
                        {/* Acknowledge active alerts */}
                        {alert.status === 'active' && (
                          <button
                            onClick={() => handleAcknowledge(alert.id)}
                            disabled={actioningIds[alert.id]}
                            className="flex items-center space-x-1 py-1.5 px-2.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white font-bold rounded-lg text-[10px] border border-zinc-700 cursor-pointer transition-all disabled:opacity-40"
                          >
                            <BookMarked className="h-3.5 w-3.5" />
                            <span>Acknowledge</span>
                          </button>
                        )}
                        
                        {/* Manual resolve alerts */}
                        <button
                          onClick={() => handleResolve(alert.id)}
                          disabled={actioningIds[alert.id]}
                          className="flex items-center space-x-1 py-1.5 px-2.5 bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-bold rounded-lg text-[10px] cursor-pointer transition-all disabled:opacity-40 shadow-sm"
                        >
                          <CheckSquare className="h-3.5 w-3.5" />
                          <span>Resolve</span>
                        </button>
                      </div>
                    )}
                  </div>

                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default Alerts;
