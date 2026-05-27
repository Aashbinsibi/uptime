import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import io from 'socket.io-client';
import { 
  Activity, Plus, Search, RefreshCw, LogOut, Settings as SettingsIcon, 
  Trash2, Edit3, Power, Globe, Clock, ShieldAlert, CheckCircle2, ChevronRight, X, Bell, Shield 
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Website {
  id: string;
  name: string;
  url: string;
  check_interval: number;
  timeout: number;
  enabled: boolean;
  last_is_up: boolean | null;
  last_status_code: number | null;
  last_response_time: number | null;
  last_checked_at: string | null;
  last_error_message: string | null;
  last_ssl_days_remaining: number | null;
}

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [websites, setWebsites] = useState<Website[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modals state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<Website | null>(null);
  
  // Form fields
  const [siteName, setSiteName] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [siteInterval, setSiteInterval] = useState(60);
  const [siteTimeout, setSiteTimeout] = useState(10);
  
  const [formError, setFormError] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [manualCheckingIds, setManualCheckingIds] = useState<Record<string, boolean>>({});

  const navigate = useNavigate();

  // 1. Fetch initial websites
  const fetchWebsites = async () => {
    try {
      const { data } = await api.get('/api/websites');
      if (data.success) {
        setWebsites(data.data);
      }
    } catch (error) {
      console.error('[Dashboard] Error fetching websites:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWebsites();

    // 2. Establish Socket.io connection for real-time live pings
    const socketUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const socket = io(socketUrl, {
      withCredentials: true
    });

    socket.on('check-completed', (data: any) => {
      setWebsites(prev => 
        prev.map(w => {
          if (w.id === data.websiteId) {
            return {
              ...w,
              last_is_up: data.isUp,
              last_status_code: data.statusCode,
              last_response_time: data.responseTime,
              last_checked_at: data.checkedAt,
              last_error_message: data.errorMessage,
              last_ssl_days_remaining: data.sslDaysRemaining
            };
          }
          return w;
        })
      );
    });

    socket.on('website-status-changed', (data: any) => {
      setWebsites(prev => 
        prev.map(w => {
          if (w.id === data.websiteId) {
            return {
              ...w,
              last_is_up: data.isUp,
              last_status_code: data.statusCode,
              last_response_time: data.responseTime,
              last_checked_at: data.checkedAt,
              last_error_message: data.errorMessage,
              last_ssl_days_remaining: data.sslDaysRemaining
            };
          }
          return w;
        })
      );
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Form Reset
  const resetForm = () => {
    setSiteName('');
    setSiteUrl('');
    setSiteInterval(60);
    setSiteTimeout(10);
    setFormError('');
    setEditingSite(null);
  };

  // Open add modal
  const handleOpenAdd = () => {
    resetForm();
    setIsModalOpen(true);
  };

  // Open edit modal
  const handleOpenEdit = (site: Website) => {
    setEditingSite(site);
    setSiteName(site.name);
    setSiteUrl(site.url);
    setSiteInterval(site.check_interval);
    setSiteTimeout(site.timeout);
    setFormError('');
    setIsModalOpen(true);
  };

  // Form Submit
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSubmitting(true);

    if (!siteName || !siteUrl) {
      setFormError('Please enter site name and URL.');
      setFormSubmitting(false);
      return;
    }

    try {
      const payload = {
        name: siteName,
        url: siteUrl,
        check_interval: Number(siteInterval),
        timeout: Number(siteTimeout)
      };

      if (editingSite) {
        // Update website
        const { data } = await api.put(`/api/websites/${editingSite.id}`, payload);
        if (data.success) {
          setWebsites(prev => prev.map(w => w.id === editingSite.id ? { ...w, ...data.data } : w));
          setIsModalOpen(false);
        }
      } else {
        // Create new website
        const { data } = await api.post('/api/websites', payload);
        if (data.success) {
          setWebsites(prev => [data.data, ...prev]);
          setIsModalOpen(false);
        }
      }
    } catch (error: any) {
      setFormError(error.response?.data?.error || 'Failed to submit form.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Toggle Website Enabled State
  const handleToggleEnabled = async (site: Website) => {
    try {
      const { data } = await api.put(`/api/websites/${site.id}`, { enabled: !site.enabled });
      if (data.success) {
        setWebsites(prev => 
          prev.map(w => w.id === site.id ? { ...w, enabled: data.data.enabled } : w)
        );
      }
    } catch (error) {
      console.error('[Dashboard] Error toggling status:', error);
    }
  };

  // Manual Check Trigger
  const handleManualCheck = async (siteId: string) => {
    setManualCheckingIds(prev => ({ ...prev, [siteId]: true }));
    try {
      await api.post(`/api/websites/${siteId}/check`);
    } catch (error) {
      console.error('[Dashboard] Manual check error:', error);
    } finally {
      setManualCheckingIds(prev => ({ ...prev, [siteId]: false }));
    }
  };

  // Delete website
  const handleDeleteWebsite = async (siteId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to stop monitoring and delete "${name}"?`)) {
      return;
    }

    try {
      const { data } = await api.delete(`/api/websites/${siteId}`);
      if (data.success) {
        setWebsites(prev => prev.filter(w => w.id !== siteId));
      }
    } catch (error) {
      console.error('[Dashboard] Failed to delete website:', error);
    }
  };

  // Metrics Aggregation
  const totalNodes = websites.length;
  const onlineNodes = websites.filter(w => w.enabled && w.last_is_up === true).length;
  const offlineNodes = websites.filter(w => w.enabled && w.last_is_up === false).length;
  
  const enabledWithLatency = websites.filter(w => w.enabled && w.last_is_up && w.last_response_time !== null);
  const avgResponseTime = enabledWithLatency.length > 0
    ? Math.round(enabledWithLatency.reduce((acc, w) => acc + (w.last_response_time || 0), 0) / enabledWithLatency.length)
    : 0;

  // Filter websites
  const filteredWebsites = websites.filter(w => 
    w.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    w.url.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen pb-16 relative">
      {/* Background ambient gradient */}
      <div className="absolute top-[10%] right-[20%] w-[350px] h-[350px] rounded-full bg-emerald-500/5 blur-[120px] pointer-events-none" />
      
      {/* Navigation Header */}
      <header className="border-b border-white/5 py-4 px-6 md:px-12 flex justify-between items-center relative z-20 glass-panel">
        <div className="flex items-center space-x-3 cursor-pointer" onClick={() => navigate('/')}>
          <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
            <Activity className="h-5 w-5 text-emerald-400" />
          </div>
          <span className="font-bold tracking-tight text-white text-base md:text-lg">
            ANTIGRAVITY UPTIME
          </span>
        </div>

        <div className="flex items-center space-x-2 md:space-x-4">
          <button
            onClick={() => navigate('/alerts')}
            className="p-2 bg-slate-900/40 text-slate-400 hover:text-white rounded-lg border border-white/5 hover:border-white/10 transition-all cursor-pointer flex items-center space-x-1.5 text-xs font-semibold"
          >
            <Bell className="h-4.5 w-4.5 text-rose-400" />
            <span className="hidden sm:inline">Alerts Log</span>
          </button>
          
          <button
            onClick={() => navigate('/settings')}
            className="p-2 bg-slate-900/40 text-slate-400 hover:text-white rounded-lg border border-white/5 hover:border-white/10 transition-all cursor-pointer flex items-center space-x-1.5 text-xs font-semibold"
          >
            <SettingsIcon className="h-4.5 w-4.5" />
            <span className="hidden sm:inline">Settings</span>
          </button>
          
          <button
            onClick={logout}
            className="p-2 bg-slate-900/40 text-rose-400 hover:text-rose-300 rounded-lg border border-white/5 hover:border-rose-500/20 transition-all cursor-pointer flex items-center space-x-1.5 text-xs font-semibold"
          >
            <LogOut className="h-4.5 w-4.5" />
            <span className="hidden sm:inline">Log Out</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 md:px-8 mt-8 relative z-10">
        
        {/* User Info Greeting */}
        <div className="mb-8">
          <h2 className="text-xl font-bold text-white tracking-wide">Availability Dashboard</h2>
          <p className="text-xs text-slate-400 mt-1">
            Logged in as <span className="text-slate-200 font-medium">{user?.email}</span>
          </p>
        </div>

        {/* Aggregated Metrics Cards Grid */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {/* Card 1: Total Nodes */}
          <div className="p-5 rounded-2xl glass-panel relative overflow-hidden group hover:border-white/10 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-xs font-medium">Monitored Nodes</span>
              <Globe className="h-4.5 w-4.5 text-slate-500" />
            </div>
            <div className="mt-4 flex items-baseline space-x-2">
              <span className="text-2xl font-extrabold text-white">{totalNodes}</span>
              <span className="text-[10px] text-slate-500 font-medium">sites</span>
            </div>
          </div>

          {/* Card 2: Online Nodes */}
          <div className="p-5 rounded-2xl glass-panel relative overflow-hidden group hover:border-emerald-500/20 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-xs font-medium">Active Online</span>
              <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400" />
            </div>
            <div className="mt-4 flex items-baseline space-x-2">
              <span className="text-2xl font-extrabold text-emerald-400">{onlineNodes}</span>
              <span className="text-[10px] text-slate-500 font-medium">operational</span>
            </div>
          </div>

          {/* Card 3: Down Nodes */}
          <div className="p-5 rounded-2xl glass-panel relative overflow-hidden group hover:border-rose-500/20 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-xs font-medium">Down Nodes</span>
              <ShieldAlert className="h-4.5 w-4.5 text-rose-400" />
            </div>
            <div className="mt-4 flex items-baseline space-x-2">
              <span className={`text-2xl font-extrabold ${offlineNodes > 0 ? 'text-rose-400 animate-pulse' : 'text-slate-300'}`}>
                {offlineNodes}
              </span>
              <span className="text-[10px] text-slate-500 font-medium">incidents</span>
            </div>
          </div>

          {/* Card 4: Avg Response Time */}
          <div className="p-5 rounded-2xl glass-panel relative overflow-hidden group hover:border-blue-500/20 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-xs font-medium">Avg Latency</span>
              <Clock className="h-4.5 w-4.5 text-blue-400" />
            </div>
            <div className="mt-4 flex items-baseline space-x-2">
              <span className="text-2xl font-extrabold text-blue-400">{avgResponseTime}</span>
              <span className="text-[10px] text-slate-500 font-medium">ms</span>
            </div>
          </div>
        </section>

        {/* Action Panel: Search & Add Website */}
        <section className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 mb-6">
          {/* Search bar */}
          <div className="relative flex-grow">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 pointer-events-none">
              <Search className="h-4.5 w-4.5" />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search website items by name or url..."
              className="w-full bg-[#0d1423]/50 border border-white/5 rounded-xl py-2 pl-9 pr-4 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          {/* Add Site Trigger button */}
          <button
            onClick={handleOpenAdd}
            className="flex items-center justify-center space-x-1.5 py-2 px-4 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 font-bold rounded-xl text-xs cursor-pointer shadow-lg shadow-emerald-500/5 transition-all"
          >
            <Plus className="h-4 w-4" />
            <span>Add Monitored Site</span>
          </button>
        </section>

        {/* Websites Grid Loader / Card render */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(n => (
              <div key={n} className="h-40 rounded-2xl glass-panel shimmer" />
            ))}
          </div>
        ) : filteredWebsites.length === 0 ? (
          <div className="py-16 text-center rounded-2xl glass-panel border-dashed border-white/10">
            <Globe className="h-10 w-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 text-xs font-semibold">No monitored websites found.</p>
            <p className="text-slate-600 text-[10px] mt-1">Search for another query or click "Add Monitored Site" to register website checkpoints.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredWebsites.map((site) => {
              const isUp = site.last_is_up;
              const hasCheck = isUp !== null;
              
              let statusText = 'Pending';
              let pulseClass = 'bg-slate-500';
              let containerBorderClass = 'hover:border-white/10';

              if (!site.enabled) {
                statusText = 'Disabled';
                pulseClass = 'bg-slate-700';
                containerBorderClass = 'opacity-55 hover:border-white/5';
              } else if (hasCheck) {
                statusText = isUp ? 'Online' : 'Offline';
                pulseClass = isUp ? 'bg-emerald-400 glow-green-pulse' : 'bg-rose-500 glow-red-pulse';
                containerBorderClass = isUp ? 'glass-panel-glow-green hover:shadow-emerald-500/5' : 'glass-panel-glow-red hover:shadow-rose-500/5';
              }

              return (
                <article
                  key={site.id}
                  className={`rounded-2xl glass-panel p-5 relative overflow-hidden transition-all duration-300 flex flex-col justify-between ${containerBorderClass}`}
                >
                  <div>
                    {/* Header: Name, pulse status badge */}
                    <div className="flex justify-between items-start">
                      <div className="max-w-[70%]">
                        <h3 className="text-sm font-bold text-white truncate" title={site.name}>{site.name}</h3>
                        <a 
                          href={site.url} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="text-[10px] text-slate-500 hover:text-emerald-400 transition-colors truncate block mt-0.5"
                        >
                          {site.url}
                        </a>
                      </div>

                      {/* Status Pulse Node */}
                      <div className="flex items-center space-x-2 bg-slate-950/40 py-1 px-2.5 rounded-full border border-white/5">
                        <span className={`h-2 w-2 rounded-full ${pulseClass}`} />
                        <span className="text-[10px] font-bold text-slate-300 tracking-wide uppercase">
                          {statusText}
                        </span>
                      </div>
                    </div>

                    {/* Middle Latency and check stats */}
                    <div className="my-5 flex flex-col space-y-1.5">
                      <div className="flex items-baseline space-x-3">
                        {hasCheck && site.enabled ? (
                          isUp ? (
                            <>
                              <span className="text-xl font-black text-emerald-400 tracking-tight">
                                {site.last_response_time}
                              </span>
                              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">ms Latency</span>
                            </>
                          ) : (
                            <div className="text-[10px] text-rose-400 font-medium leading-relaxed truncate" title={site.last_error_message || 'Incident detected'}>
                              Error: {site.last_error_message || 'HTTP check failure'}
                            </div>
                          )
                        ) : (
                          <span className="text-sm text-slate-600 font-semibold tracking-wider italic uppercase">
                            {!site.enabled ? 'Inactive' : 'Polling scheduled...'}
                          </span>
                        )}
                      </div>

                      {/* SSL Expiry Telemetry Badge */}
                      {site.enabled && site.last_ssl_days_remaining !== null && (
                        <div className="flex items-center space-x-1.5 text-[9px] font-semibold">
                          <Shield className={`h-3.5 w-3.5 ${
                            site.last_ssl_days_remaining <= 14 ? 'text-amber-400 animate-pulse' : 'text-slate-500'
                          }`} />
                          <span className={site.last_ssl_days_remaining <= 14 ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                            SSL Expiry: {site.last_ssl_days_remaining} {site.last_ssl_days_remaining === 1 ? 'day' : 'days'} left
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer Actions Panel */}
                  <div className="pt-4 border-t border-white/5 flex items-center justify-between mt-auto">
                    {/* Primary inspect detailed graphs button */}
                    <button
                      onClick={() => navigate(`/websites/${site.id}`)}
                      className="flex items-center space-x-1 py-1.5 px-3 bg-slate-900/60 hover:bg-slate-900 text-emerald-400 hover:text-emerald-300 font-bold rounded-lg text-[10px] border border-white/5 hover:border-emerald-500/20 cursor-pointer transition-all"
                    >
                      <span>Analyze</span>
                      <ChevronRight className="h-3 w-3" />
                    </button>

                    {/* Mini CRUD Icon tools panel */}
                    <div className="flex items-center space-x-1.5">
                      {/* Manual check trigger */}
                      <button
                        onClick={() => handleManualCheck(site.id)}
                        disabled={manualCheckingIds[site.id] || !site.enabled}
                        className="p-1.5 bg-slate-900/30 hover:bg-slate-900/80 text-slate-400 hover:text-white rounded-md border border-white/5 cursor-pointer disabled:opacity-30 disabled:pointer-events-none transition-colors"
                        title="Trigger manual availability check"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${manualCheckingIds[site.id] ? 'animate-spin text-emerald-400' : ''}`} />
                      </button>

                      {/* Power toggle */}
                      <button
                        onClick={() => handleToggleEnabled(site)}
                        className={`p-1.5 rounded-md border border-white/5 cursor-pointer transition-colors ${
                          site.enabled 
                            ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' 
                            : 'bg-slate-900/30 text-slate-500 hover:text-white'
                        }`}
                        title={site.enabled ? "Pause monitoring" : "Resume monitoring"}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>

                      {/* Edit */}
                      <button
                        onClick={() => handleOpenEdit(site)}
                        className="p-1.5 bg-slate-900/30 hover:bg-slate-900/80 text-slate-400 hover:text-white rounded-md border border-white/5 cursor-pointer transition-colors"
                        title="Edit checkpoint config"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => handleDeleteWebsite(site.id, site.name)}
                        className="p-1.5 bg-slate-900/30 hover:bg-rose-900/40 text-slate-400 hover:text-rose-400 rounded-md border border-white/5 cursor-pointer transition-colors"
                        title="Remove monitored website"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl glass-panel p-6 md:p-8 animate-in fade-in zoom-in-95 duration-150 border border-white/10 shadow-2xl relative">
            
            {/* Modal Header */}
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-base font-bold text-white">
                {editingSite ? 'Modify Monitored Site' : 'Register Monitoring checkpoint'}
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-500 hover:text-white hover:bg-white/5 rounded-md cursor-pointer transition-colors"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-medium">
                {formError}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleFormSubmit} className="space-y-4">
              {/* Site Name */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-medium block">Site Display Name</label>
                <input
                  type="text"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="e.g. Primary App Gateway"
                  className="w-full bg-[#080c14] border border-white/10 rounded-xl py-2 px-3.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                  disabled={formSubmitting}
                  required
                />
              </div>

              {/* Site URL */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-medium block">Site Endpoint URL</label>
                <input
                  type="url"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  placeholder="e.g. https://api.myproject.com"
                  className="w-full bg-[#080c14] border border-white/10 rounded-xl py-2 px-3.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                  disabled={formSubmitting}
                  required
                />
              </div>

              {/* Row: Check Interval & Timeout */}
              <div className="grid grid-cols-2 gap-4">
                {/* Interval */}
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 font-medium block">Check Interval (sec)</label>
                  <input
                    type="number"
                    value={siteInterval}
                    onChange={(e) => setSiteInterval(Number(e.target.value))}
                    min={10}
                    className="w-full bg-[#080c14] border border-white/10 rounded-xl py-2 px-3.5 text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors"
                    disabled={formSubmitting}
                    required
                  />
                </div>

                {/* Timeout */}
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 font-medium block">Timeout (sec)</label>
                  <input
                    type="number"
                    value={siteTimeout}
                    onChange={(e) => setSiteTimeout(Number(e.target.value))}
                    min={1}
                    max={60}
                    className="w-full bg-[#080c14] border border-white/10 rounded-xl py-2 px-3.5 text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors"
                    disabled={formSubmitting}
                    required
                  />
                </div>
              </div>

              {/* Submit panel */}
              <div className="flex space-x-3 pt-4 justify-end">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="py-2 px-4 bg-slate-900/60 hover:bg-slate-900 text-slate-400 hover:text-white rounded-xl text-xs font-semibold cursor-pointer border border-white/5 hover:border-white/10 transition-colors"
                  disabled={formSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="py-2 px-4 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 font-bold rounded-xl text-xs cursor-pointer disabled:opacity-50 transition-colors"
                >
                  {formSubmitting ? 'Saving...' : editingSite ? 'Update Checkpoint' : 'Create Checkpoint'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
