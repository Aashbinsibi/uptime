import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import io from 'socket.io-client';
import { 
  Activity, LayoutGrid, Globe, Server, Bell, Settings as SettingsIcon, 
  Users, LogOut, CheckCircle2, ChevronRight, Search, Plus, RefreshCw, 
  Trash2, Edit3, Power, ExternalLink, ShieldAlert, Cpu, HardDrive, 
  Boxes, X, ShieldCheck, Mail, Slack, Terminal, Eye
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

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

interface AlertChannel {
  id?: string;
  type: 'slack' | 'email' | 'teams';
  config: {
    webhookUrl?: string;
  };
  enabled: boolean;
}

interface ConsoleUser {
  id: string;
  email: string;
  role: 'admin' | 'user' | 'viewer';
  created_at: string;
}

interface MicroserviceItem {
  id: string;
  name: string;
  endpoint: string;
  protocol: string;
  uptime: string;
  latency: number;
}

const previewMicroservices: MicroserviceItem[] = [
  { id: '1', name: 'Auth & Session Cluster', endpoint: 'grpc://auth.internal:50051', protocol: 'gRPC', uptime: '99.98%', latency: 12 },
  { id: '2', name: 'Telemetry Collector & Influx', endpoint: 'tcp://collector.internal:8086', protocol: 'TCP', uptime: '100%', latency: 6 },
  { id: '3', name: 'Redis Cache & Event Bus', endpoint: 'redis://cache.internal:6379', protocol: 'Redis', uptime: '99.95%', latency: 3 },
];

export type TabType = 'home' | 'websites' | 'servers' | 'microservices' | 'alerts' | 'settings' | 'users';

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Active navigation tab
  const tabParam = searchParams.get('tab') as any;
  const [activeTab, setActiveTab] = useState<TabType>(
    ['home', 'websites', 'servers', 'microservices', 'alerts', 'settings', 'users'].includes(tabParam) ? tabParam : 'home'
  );

  // Sync tab with URL
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setSearchParams(tab === 'home' ? {} : { tab });
  };

  // Data states
  const [websites, setWebsites] = useState<Website[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [channels, setChannels] = useState<AlertChannel[]>([]);
  const [usersList, setUsersList] = useState<ConsoleUser[]>([]);
  const [publicStatusEnabled, setPublicStatusEnabled] = useState(false);
  
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [websiteFilter, setWebsiteFilter] = useState<'all' | 'up' | 'down' | 'disabled'>('all');
  const [alertFilter, setAlertFilter] = useState<'all' | 'active' | 'acknowledged' | 'resolved'>('all');

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<Website | null>(null);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);

  // Website Form
  const [siteName, setSiteName] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [siteInterval, setSiteInterval] = useState(60);
  const [siteTimeout, setSiteTimeout] = useState(10);
  const [formError, setFormError] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [manualCheckingIds, setManualCheckingIds] = useState<Record<string, boolean>>({});

  // User Form
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'user' | 'viewer'>('user');
  const [userFormError, setUserFormError] = useState('');
  const [userFormSubmitting, setUserFormSubmitting] = useState(false);

  // Alert Action state
  const [actioningAlertIds, setActioningAlertIds] = useState<Record<string, boolean>>({});
  const [testAlertSending, setTestAlertSending] = useState(false);
  const [testAlertFeedback, setTestAlertFeedback] = useState<string | null>(null);

  // 1. Fetch initial system resources
  const fetchAllData = async () => {
    try {
      // Websites
      const { data: webRes } = await api.get('/api/websites');
      if (webRes.success) {
        setWebsites(webRes.data);
      }

      // Alerts
      const { data: alertRes } = await api.get('/api/alerts');
      if (alertRes.success) {
        setAlerts(alertRes.data);
      }

      // Channels
      try {
        const { data: chanRes } = await api.get('/api/settings/channels');
        if (chanRes.success) {
          setChannels(chanRes.data);
        }
      } catch (err) {
        // channel config optional for non-admins
      }

      // Public status
      try {
        const { data: pubRes } = await api.get('/api/settings/public-status');
        if (pubRes.success) {
          setPublicStatusEnabled(pubRes.enabled);
        }
      } catch (err) {
        // ignore
      }

      // Users (if admin)
      try {
        const { data: userRes } = await api.get('/api/users');
        if (userRes.success) {
          setUsersList(userRes.data);
        }
      } catch (err) {
        // non-admin might receive 403
      }
    } catch (error) {
      console.error('[Dashboard] Error fetching resources:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();

    // 2. Real-time live status updates via Socket.io
    const socketUrl = import.meta.env.VITE_API_URL !== undefined
      ? (import.meta.env.VITE_API_URL || undefined)
      : (import.meta.env.DEV ? 'http://localhost:3000' : undefined);
    
    const socket = io(socketUrl as any, {
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

      // Refresh alerts when status changes
      api.get('/api/alerts').then(({ data: res }) => {
        if (res.success) setAlerts(res.data);
      }).catch(() => {});
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Form Reset
  const resetWebsiteForm = () => {
    setSiteName('');
    setSiteUrl('');
    setSiteInterval(60);
    setSiteTimeout(10);
    setFormError('');
    setEditingSite(null);
  };

  const handleOpenAddWebsite = () => {
    resetWebsiteForm();
    setIsModalOpen(true);
  };

  const handleOpenEditWebsite = (site: Website) => {
    setEditingSite(site);
    setSiteName(site.name);
    setSiteUrl(site.url);
    setSiteInterval(site.check_interval);
    setSiteTimeout(site.timeout);
    setFormError('');
    setIsModalOpen(true);
  };

  const handleWebsiteSubmit = async (e: React.FormEvent) => {
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
        const { data } = await api.put(`/api/websites/${editingSite.id}`, payload);
        if (data.success) {
          setWebsites(prev => prev.map(w => w.id === editingSite.id ? { ...w, ...data.data } : w));
          setIsModalOpen(false);
        }
      } else {
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

  const handleToggleWebsiteEnabled = async (site: Website) => {
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

  const handleManualCheck = async (siteId: string) => {
    setManualCheckingIds(prev => ({ ...prev, [siteId]: true }));
    try {
      await api.post(`/api/websites/${siteId}/check`);
    } catch (error) {
      console.error('[Dashboard] Manual check error:', error);
    } finally {
      setTimeout(() => {
        setManualCheckingIds(prev => ({ ...prev, [siteId]: false }));
      }, 1200);
    }
  };

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

  // Alert Actions
  const handleAcknowledgeAlert = async (alertId: string) => {
    setActioningAlertIds(prev => ({ ...prev, [alertId]: true }));
    try {
      const { data } = await api.put(`/api/alerts/${alertId}/acknowledge`);
      if (data.success) {
        setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: 'acknowledged' } : a));
      }
    } catch (error) {
      console.error('[Dashboard] Acknowledge error:', error);
    } finally {
      setActioningAlertIds(prev => ({ ...prev, [alertId]: false }));
    }
  };

  const handleResolveAlert = async (alertId: string) => {
    setActioningAlertIds(prev => ({ ...prev, [alertId]: true }));
    try {
      const { data } = await api.put(`/api/alerts/${alertId}/resolve`);
      if (data.success) {
        setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: 'resolved', resolved_at: new Date().toISOString() } : a));
      }
    } catch (error) {
      console.error('[Dashboard] Resolve error:', error);
    } finally {
      setActioningAlertIds(prev => ({ ...prev, [alertId]: false }));
    }
  };

  // User Actions
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserFormError('');
    setUserFormSubmitting(true);

    try {
      const { data } = await api.post('/api/users', {
        email: newUserEmail,
        password: newUserPassword,
        role: newUserRole
      });

      if (data.success) {
        setUsersList(prev => [data.data, ...prev]);
        setNewUserEmail('');
        setNewUserPassword('');
        setNewUserRole('user');
        setIsUserModalOpen(false);
      }
    } catch (err: any) {
      setUserFormError(err.response?.data?.error || 'Failed to create user');
    } finally {
      setUserFormSubmitting(false);
    }
  };

  const handleDeleteUser = async (userId: string, email: string) => {
    if (!window.confirm(`Delete user account "${email}"?`)) return;
    try {
      const { data } = await api.delete(`/api/users/${userId}`);
      if (data.success) {
        setUsersList(prev => prev.filter(u => u.id !== userId));
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete user');
    }
  };

  // Test Notification Alert
  const handleSendTestAlert = async (type: 'slack' | 'email' | 'teams') => {
    setTestAlertSending(true);
    setTestAlertFeedback(null);
    try {
      const { data } = await api.post('/api/settings/channels/test', {
        type,
        message: `Antigravity Uptime Test Ping: System dispatch operational at ${new Date().toLocaleTimeString()}`
      });
      if (data.success) {
        setTestAlertFeedback(`Test notification dispatched successfully via ${type}!`);
      }
    } catch (err: any) {
      setTestAlertFeedback(err.response?.data?.error || `Failed to dispatch test notification via ${type}.`);
    } finally {
      setTestAlertSending(false);
      setTimeout(() => setTestAlertFeedback(null), 4000);
    }
  };

  // Calculated Metrics
  const totalWebsites = websites.length;
  const onlineWebsites = websites.filter(w => w.enabled && w.last_is_up === true).length;
  const offlineWebsites = websites.filter(w => w.enabled && w.last_is_up === false).length;

  const activeAlerts = alerts.filter(a => a.status === 'active');
  const resolved24hAlerts = alerts.filter(a => {
    if (a.status !== 'resolved' || !a.resolved_at) return false;
    const diffHours = (Date.now() - new Date(a.resolved_at).getTime()) / (1000 * 60 * 60);
    return diffHours <= 24;
  }).length;

  const isAllHealthy = offlineWebsites === 0 && activeAlerts.length === 0;

  // Filtered lists
  const filteredWebsites = websites.filter(w => {
    const matchesSearch = w.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          w.url.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (websiteFilter === 'up') return w.enabled && w.last_is_up === true;
    if (websiteFilter === 'down') return w.enabled && w.last_is_up === false;
    if (websiteFilter === 'disabled') return !w.enabled;
    return true;
  });

  const filteredAlerts = alerts.filter(a => {
    if (alertFilter === 'all') return true;
    return a.status === alertFilter;
  });

  return (
    <div className="min-h-screen text-zinc-100 flex flex-col font-sans relative selection:bg-white selection:text-black">
      
      {/* TOP NAVIGATION BAR */}
      <header className="sticky top-0 z-40 bg-black/90 backdrop-blur-md border-b border-zinc-800 px-4 md:px-8 py-3 transition-colors">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          
          {/* Logo & Brand */}
          <div 
            onClick={() => handleTabChange('home')}
            className="flex items-center space-x-2.5 cursor-pointer group select-none"
          >
            <div className="p-1.5 bg-zinc-900 rounded-lg border border-zinc-700 group-hover:border-zinc-500 transition-all flex items-center justify-center shadow-sm">
              <Activity className="h-4.5 w-4.5 text-white" />
            </div>
            <div className="flex items-baseline space-x-1.5">
              <span className="font-bold tracking-tight text-white text-base md:text-lg font-mono">
                Antigravity Uptime
              </span>
              <span className="text-[11px] text-zinc-500 font-mono tracking-normal">
                v1.4.0
              </span>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="flex items-center space-x-1 md:space-x-2 text-xs font-medium font-mono">
            {/* Home */}
            <button
              onClick={() => handleTabChange('home')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeTab === 'home'
                  ? 'bg-white text-black font-bold shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent'
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="hidden sm:inline">Home</span>
            </button>

            {/* Websites */}
            <button
              onClick={() => handleTabChange('websites')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeTab === 'websites'
                  ? 'bg-white text-black font-bold shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent'
              }`}
            >
              <Globe className="h-4 w-4" />
              <span className="hidden sm:inline">Websites</span>
            </button>

            {/* Servers */}
            <button
              onClick={() => handleTabChange('servers')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeTab === 'servers'
                  ? 'bg-white text-black font-bold shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent'
              }`}
            >
              <Server className="h-4 w-4" />
              <span className="hidden sm:inline">Servers</span>
              <span className="text-[9px] font-mono font-bold bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded ml-1 uppercase">
                Soon
              </span>
            </button>

            {/* Microservices */}
            <button
              onClick={() => handleTabChange('microservices')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeTab === 'microservices'
                  ? 'bg-white text-black font-bold shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent'
              }`}
            >
              <Boxes className="h-4 w-4" />
              <span className="hidden sm:inline">Services</span>
              <span className="text-[9px] font-mono font-bold bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded ml-1 uppercase">
                Soon
              </span>
            </button>

            {/* Alerts Log */}
            <button
              onClick={() => handleTabChange('alerts')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer relative ${
                activeTab === 'alerts'
                  ? 'bg-white text-black font-bold shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent'
              }`}
            >
              <Bell className="h-4 w-4" />
              <span className="hidden sm:inline">Alerts Log</span>
              {activeAlerts.length > 0 && (
                <span className="h-2 w-2 rounded-full bg-white animate-pulse absolute top-1.5 right-1" />
              )}
            </button>

            {/* Settings */}
            <button
              onClick={() => handleTabChange('settings')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeTab === 'settings'
                  ? 'bg-white text-black font-bold shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent'
              }`}
            >
              <SettingsIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Settings</span>
            </button>

            {/* Users */}
            <button
              onClick={() => handleTabChange('users')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeTab === 'users'
                  ? 'bg-white text-black font-bold shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent'
              }`}
            >
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Users</span>
            </button>

            {/* Log Out */}
            <button
              onClick={logout}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent transition-all cursor-pointer ml-1"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Log Out</span>
            </button>
          </nav>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="flex-grow max-w-7xl w-full mx-auto px-4 md:px-8 py-8 relative z-10">
        
        {/* ======================================================== */}
        {/* TAB: HOME (OVERVIEW + ALL RESOURCES ACCESSIBLE ON HOMEPAGE) */}
        {/* ======================================================== */}
        {activeTab === 'home' && (
          <div className="space-y-8 animate-fadeIn">
            
            {/* OVERVIEW HERO SECTION */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-black tracking-tight font-mono">
                  Overview
                </h1>
                <p className="text-xs text-zinc-600 mt-1 font-normal font-mono">
                  Everything Antigravity is monitoring for you, at a glance.
                </p>
              </div>

              {/* Status Badge Pill */}
              <div>
                {isAllHealthy ? (
                  <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full border border-zinc-700 bg-zinc-900 text-white text-xs font-mono font-semibold shadow-sm">
                    <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                    <span>ALL SYSTEMS HEALTHY</span>
                  </div>
                ) : (
                  <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full border-2 border-white bg-black text-white text-xs font-mono font-semibold animate-pulse shadow-sm">
                    <span className="h-2 w-2 rounded-full bg-white" />
                    <span>
                      {offlineWebsites + activeAlerts.length} SYSTEM{offlineWebsites + activeAlerts.length > 1 ? 'S' : ''} EXPERIENCING ISSUES
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* 4 METRIC CARDS GRID */}
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              
              {/* Card 1: WEBSITES */}
              <div 
                onClick={() => handleTabChange('websites')}
                className="bg-zinc-950/90 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-5 cursor-pointer transition-all duration-200 group relative shadow-sm hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Globe className="h-4 w-4 text-white" />
                    <span className="text-[11px] font-mono font-semibold tracking-wider text-zinc-400 uppercase">
                      WEBSITES
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-zinc-600 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all" />
                </div>
                
                <div className="text-3xl font-extrabold text-white font-mono mt-3">
                  {totalWebsites}
                </div>

                <div className="text-xs text-zinc-400 font-mono mt-2 flex items-center space-x-1.5">
                  <span className="text-white font-medium">{onlineWebsites} up</span>
                  <span>·</span>
                  <span>{offlineWebsites > 0 ? `${offlineWebsites} down` : totalWebsites === 0 ? 'none yet' : 'all healthy'}</span>
                </div>
              </div>

              {/* Card 2: SERVERS */}
              <div 
                onClick={() => handleTabChange('servers')}
                className="bg-zinc-950/90 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-5 cursor-pointer transition-all duration-200 group relative shadow-sm hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Server className="h-4 w-4 text-white" />
                    <span className="text-[11px] font-mono font-semibold tracking-wider text-zinc-400 uppercase">
                      SERVERS
                    </span>
                  </div>
                  <span className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider bg-zinc-900 text-zinc-300 rounded-full border border-zinc-800">
                    Soon
                  </span>
                </div>
                
                <div className="text-2xl font-extrabold text-white font-mono mt-3">
                  Agent
                </div>

                <div className="text-xs text-zinc-400 font-mono mt-2 flex items-center space-x-1.5">
                  <span className="text-zinc-300 font-medium">Available Soon</span>
                </div>
              </div>

              {/* Card 3: MICROSERVICES */}
              <div 
                onClick={() => handleTabChange('microservices')}
                className="bg-zinc-950/90 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-5 cursor-pointer transition-all duration-200 group relative shadow-sm hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Boxes className="h-4 w-4 text-white" />
                    <span className="text-[11px] font-mono font-semibold tracking-wider text-zinc-400 uppercase">
                      MICROSERVICES
                    </span>
                  </div>
                  <span className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider bg-zinc-900 text-zinc-300 rounded-full border border-zinc-800">
                    Soon
                  </span>
                </div>
                
                <div className="text-2xl font-extrabold text-white font-mono mt-3">
                  Mesh
                </div>

                <div className="text-xs text-zinc-400 font-mono mt-2 flex items-center space-x-1.5">
                  <span className="text-zinc-300 font-medium">Available Soon</span>
                </div>
              </div>

              {/* Card 4: OPEN ALERTS */}
              <div 
                onClick={() => handleTabChange('alerts')}
                className="bg-zinc-950/90 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-5 cursor-pointer transition-all duration-200 group relative shadow-sm hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Bell className="h-4 w-4 text-white" />
                    <span className="text-[11px] font-mono font-semibold tracking-wider text-zinc-400 uppercase">
                      OPEN ALERTS
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-zinc-600 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all" />
                </div>
                
                <div className={`text-3xl font-extrabold font-mono mt-3 ${activeAlerts.length > 0 ? 'text-white animate-pulse' : 'text-white'}`}>
                  {activeAlerts.length}
                </div>

                <div className="text-xs text-zinc-400 font-mono mt-2 flex items-center space-x-1.5">
                  <span>{resolved24hAlerts} resolved 24h</span>
                  <span>·</span>
                  <span>{activeAlerts.length === 0 ? 'none yet' : `${activeAlerts.length} active`}</span>
                </div>
              </div>

            </section>

            {/* OPEN ALERTS SECTION */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-400 uppercase">
                  OPEN ALERTS
                </h2>
                <button
                  onClick={() => handleTabChange('alerts')}
                  className="text-xs font-mono text-zinc-400 hover:text-white cursor-pointer transition-colors"
                >
                  View all
                </button>
              </div>

              <div className="bg-zinc-950/90 border border-zinc-800 rounded-2xl p-8 transition-all shadow-sm">
                {activeAlerts.length === 0 ? (
                  /* Empty state */
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <div className="h-10 w-10 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center mb-3">
                      <CheckCircle2 className="h-6 w-6 text-white" />
                    </div>
                    <p className="text-sm font-semibold text-white font-mono">
                      No open alerts
                    </p>
                    <p className="text-xs text-zinc-400 mt-1 font-mono">
                      Everything is reporting healthy.
                    </p>
                  </div>
                ) : (
                  /* Active alerts list */
                  <div className="space-y-3">
                    {activeAlerts.map(alert => (
                      <div 
                        key={alert.id}
                        className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-700 flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div className="flex items-start space-x-3">
                          <div className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white mt-0.5">
                            <ShieldAlert className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-bold text-white font-mono">{alert.website_name}</span>
                              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-zinc-800 text-zinc-200 border border-zinc-600 rounded uppercase font-bold">
                                {alert.type}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-300 font-mono mt-1">{alert.message}</p>
                            <span className="text-[10px] text-zinc-500 font-mono mt-1 block">
                              Triggered: {new Date(alert.triggered_at).toLocaleString()}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 shrink-0">
                          <button
                            onClick={() => handleAcknowledgeAlert(alert.id)}
                            disabled={actioningAlertIds[alert.id]}
                            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono font-medium rounded-lg border border-zinc-700 transition-all cursor-pointer flex items-center space-x-1"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>Acknowledge</span>
                          </button>
                          <button
                            onClick={() => handleResolveAlert(alert.id)}
                            disabled={actioningAlertIds[alert.id]}
                            className="px-3 py-1.5 bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black text-xs font-mono font-bold rounded-lg transition-all cursor-pointer flex items-center space-x-1 shadow-sm"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Resolve</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* MONITORED WEBSITES & ENDPOINTS (Accessible directly on Homepage) */}
            <section className="pt-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-400 uppercase flex items-center space-x-2">
                    <Globe className="h-4 w-4 text-white" />
                    <span>MONITORED WEBSITES & ENDPOINTS</span>
                  </h2>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    Real-time HTTP availability checks and SSL certificate expiry monitors.
                  </p>
                </div>

                <div className="flex items-center space-x-3">
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search website or url..."
                      className="bg-zinc-900/90 border border-zinc-800 focus:border-zinc-700 rounded-xl py-1.5 pl-8 pr-3 text-xs text-white placeholder-zinc-500 focus:outline-none transition-all w-48 md:w-64 font-mono"
                    />
                  </div>

                  <button
                    onClick={handleOpenAddWebsite}
                    className="flex items-center space-x-1.5 py-1.5 px-3.5 bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-bold rounded-xl text-xs font-mono cursor-pointer transition-all shadow-sm"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Website</span>
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-36 rounded-2xl bg-zinc-900/60 border border-zinc-800 animate-pulse" />
                  ))}
                </div>
              ) : filteredWebsites.length === 0 ? (
                <div className="p-8 text-center bg-zinc-900/70 border border-zinc-800 rounded-2xl">
                  <Globe className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-zinc-300 font-mono">No monitored websites registered.</p>
                  <p className="text-[11px] text-zinc-500 mt-1">Click "Add Website" above to configure your first HTTP checkpoint.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredWebsites.map(site => {
                    const isUp = site.last_is_up;
                    const isChecking = manualCheckingIds[site.id];

                    return (
                      <div
                        key={site.id}
                        className={`bg-zinc-900/90 border rounded-2xl p-4 transition-all duration-200 flex flex-col justify-between group shadow-md hover:shadow-xl ${
                          !site.enabled
                            ? 'border-zinc-800/60 opacity-60'
                            : isUp === true
                            ? 'border-zinc-700 hover:border-zinc-500'
                            : isUp === false
                            ? 'border-white hover:border-zinc-300'
                            : 'border-zinc-800 hover:border-zinc-700'
                        }`}
                      >
                        <div>
                          {/* Card Header: Name & Status Pill */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <h3 
                                onClick={() => navigate(`/websites/${site.id}`)}
                                className="text-sm font-bold text-white truncate cursor-pointer hover:text-zinc-300 transition-colors"
                              >
                                {site.name}
                              </h3>
                              <a
                                href={site.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-zinc-500 hover:text-zinc-300 font-mono truncate flex items-center space-x-1 mt-0.5"
                              >
                                <span className="truncate">{site.url}</span>
                                <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
                              </a>
                            </div>

                            {/* Status badge */}
                            <div className="shrink-0">
                              {!site.enabled ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-zinc-800 text-zinc-400 border border-zinc-700">
                                  Disabled
                                </span>
                              ) : isUp === true ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-zinc-800 text-white border border-zinc-600 flex items-center space-x-1">
                                  <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                                  <span>Online</span>
                                </span>
                              ) : isUp === false ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-black text-white border border-white flex items-center space-x-1">
                                  <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
                                  <span>Down</span>
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-zinc-900 text-zinc-400 border border-zinc-700">
                                  Pending
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Quick Telemetry Info */}
                          <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-zinc-800/80 text-[10px] font-mono">
                            <div>
                              <span className="text-zinc-500 block">Latency</span>
                              <span className="font-semibold text-zinc-200">
                                {site.last_response_time !== null ? `${site.last_response_time}ms` : '—'}
                              </span>
                            </div>
                            <div>
                              <span className="text-zinc-500 block">SSL Cert</span>
                              <span className="font-semibold text-zinc-200">
                                {site.last_ssl_days_remaining !== null 
                                  ? `${site.last_ssl_days_remaining}d` 
                                  : '—'}
                              </span>
                            </div>
                            <div>
                              <span className="text-zinc-500 block">Interval</span>
                              <span className="font-semibold text-zinc-200">{site.check_interval}s</span>
                            </div>
                          </div>
                        </div>

                        {/* Card Actions Footer */}
                        <div className="flex items-center justify-between pt-3 mt-3 border-t border-zinc-800/80">
                          <button
                            onClick={() => handleManualCheck(site.id)}
                            disabled={isChecking}
                            title="Trigger Check Now"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-all cursor-pointer border border-zinc-700"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${isChecking ? 'animate-spin text-white' : ''}`} />
                          </button>

                          <div className="flex items-center space-x-1">
                            <button
                              onClick={() => handleToggleWebsiteEnabled(site)}
                              title={site.enabled ? 'Pause monitoring' : 'Resume monitoring'}
                              className={`p-1.5 rounded-lg transition-all cursor-pointer border ${
                                site.enabled 
                                  ? 'bg-zinc-800 text-white hover:bg-zinc-700 border-zinc-600' 
                                  : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300 border-zinc-800'
                              }`}
                            >
                              <Power className="h-3.5 w-3.5" />
                            </button>
                            
                            <button
                              onClick={() => handleOpenEditWebsite(site)}
                              title="Edit config"
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-all cursor-pointer border border-zinc-700"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>

                            <button
                              onClick={() => handleDeleteWebsite(site.id, site.name)}
                              title="Delete site"
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all cursor-pointer border border-zinc-700"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>

                            <button
                              onClick={() => navigate(`/websites/${site.id}`)}
                              title="View performance metrics"
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-all cursor-pointer ml-1 border border-zinc-700"
                            >
                              <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ANTIGRAVITY SERVER AGENT PREVIEW BANNER */}
            <section className="pt-2">
              <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-md">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="flex items-start space-x-4">
                    <div className="p-3 bg-black border border-zinc-800 rounded-xl text-white flex-shrink-0">
                      <Terminal className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2.5">
                        <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">
                          Antigravity Server Agent
                        </h2>
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-widest bg-zinc-800 text-zinc-300 border border-zinc-700">
                          Available Soon
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 font-mono mt-1.5 max-w-2xl leading-relaxed">
                        Host infrastructure telemetry, per-core CPU metrics, RAM pressure checks, and disk capacity tracking will be available soon with the native Antigravity Server Agent daemon.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleTabChange('servers')}
                    className="self-start md:self-center px-4 py-2 bg-white hover:bg-zinc-200 text-black font-mono font-bold text-xs rounded-xl transition-all cursor-pointer whitespace-nowrap shadow-sm border border-zinc-300"
                  >
                    View Agent Details &rarr;
                  </button>
                </div>
              </div>
            </section>

            {/* MICROSERVICES & SERVICE MESH PREVIEW BANNER */}
            <section className="pt-2">
              <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-md">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="flex items-start space-x-4">
                    <div className="p-3 bg-black border border-zinc-800 rounded-xl text-white flex-shrink-0">
                      <Boxes className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2.5">
                        <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">
                          Internal Microservices & Workers
                        </h2>
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-widest bg-zinc-800 text-zinc-300 border border-zinc-700">
                          Available Soon
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 font-mono mt-1.5 max-w-2xl leading-relaxed">
                        Distributed service mesh telemetry, inter-service gRPC latency monitoring, Redis bus health, and worker queue tracing will be available soon in the Antigravity Microservices Suite.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleTabChange('microservices')}
                    className="self-start md:self-center px-4 py-2 bg-white hover:bg-zinc-200 text-black font-mono font-bold text-xs rounded-xl transition-all cursor-pointer whitespace-nowrap shadow-sm border border-zinc-300"
                  >
                    View Mesh Details &rarr;
                  </button>
                </div>
              </div>
            </section>

            {/* ALERT CHANNELS & TEAM USERS QUICK STRIP */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              
              {/* Alert Integrations Summary */}
              <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 shadow-md">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-mono font-bold tracking-wider text-zinc-400 uppercase flex items-center space-x-2">
                    <Bell className="h-4 w-4 text-white" />
                    <span>ALERT NOTIFICATION CHANNELS</span>
                    {channels.length > 0 && (
                      <span className="text-[10px] text-zinc-400 font-normal">
                        ({channels.filter(c => c.enabled).length} active)
                      </span>
                    )}
                  </h3>
                  <button 
                    onClick={() => handleTabChange('settings')}
                    className="text-xs font-mono text-zinc-400 hover:text-white cursor-pointer"
                  >
                    Configure
                  </button>
                </div>

                <div className="space-y-2.5 font-mono text-xs">
                  {/* Slack */}
                  <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800/80 flex items-center justify-between">
                    <div className="flex items-center space-x-2.5">
                      <Slack className="h-4 w-4 text-white" />
                      <span className="text-white font-medium">Slack Webhook</span>
                    </div>
                    <button
                      onClick={() => handleSendTestAlert('slack')}
                      disabled={testAlertSending}
                      className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg text-[10px] font-semibold border border-zinc-700 transition-all cursor-pointer"
                    >
                      Test Ping
                    </button>
                  </div>

                  {/* Email */}
                  <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800/80 flex items-center justify-between">
                    <div className="flex items-center space-x-2.5">
                      <Mail className="h-4 w-4 text-white" />
                      <span className="text-white font-medium">Email Dispatcher</span>
                    </div>
                    <button
                      onClick={() => handleSendTestAlert('email')}
                      disabled={testAlertSending}
                      className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg text-[10px] font-semibold border border-zinc-700 transition-all cursor-pointer"
                    >
                      Test Ping
                    </button>
                  </div>
                </div>

                {testAlertFeedback && (
                  <div className="mt-3 p-2 bg-zinc-800/80 border border-zinc-700 rounded-lg text-[11px] font-mono text-zinc-200">
                    {testAlertFeedback}
                  </div>
                )}
              </div>

              {/* Public Status & Team Access */}
              <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 shadow-md flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-mono font-bold tracking-wider text-zinc-400 uppercase flex items-center space-x-2">
                      <ShieldCheck className="h-4 w-4 text-white" />
                      <span>PUBLIC STATUS & TEAM</span>
                    </h3>
                    <button 
                      onClick={() => handleTabChange('users')}
                      className="text-xs font-mono text-zinc-400 hover:text-white cursor-pointer"
                    >
                      Manage Users
                    </button>
                  </div>

                  <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800/80 mb-3">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-zinc-300">Public Status Page</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${publicStatusEnabled ? 'bg-zinc-800 text-white border border-zinc-600' : 'bg-zinc-900 text-zinc-500 border border-zinc-800'}`}>
                        {publicStatusEnabled ? 'Enabled' : 'Private'}
                      </span>
                    </div>
                    <a
                      href="/status"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] font-mono text-zinc-400 hover:text-white flex items-center space-x-1 mt-1.5 truncate"
                    >
                      <span>View public URL /status</span>
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-zinc-800/80 text-[11px] font-mono text-zinc-400">
                  <span>Registered Console Users</span>
                  <span className="font-bold text-white">{usersList.length > 0 ? usersList.length : '1'}</span>
                </div>
              </div>

            </div>

          </div>
        )}

        {/* ======================================================== */}
        {/* TAB: WEBSITES (DETAILED WEBSITES MANAGER) */}
        {/* ======================================================== */}
        {activeTab === 'websites' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-300 pb-6">
              <div>
                <h1 className="text-2xl font-bold text-black tracking-tight font-mono">Monitored Websites</h1>
                <p className="text-xs text-zinc-600 mt-1 font-mono">
                  Manage HTTP endpoints, healthcheck frequencies, and SSL certificate monitors.
                </p>
              </div>

              <div className="flex items-center space-x-3">
                {/* Search */}
                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search name or url..."
                    className="bg-zinc-900 border border-zinc-800 rounded-xl py-1.5 pl-8 pr-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-700 font-mono w-44 sm:w-60"
                  />
                </div>

                <button
                  onClick={handleOpenAddWebsite}
                  className="flex items-center space-x-1.5 py-1.5 px-4 bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-bold rounded-xl text-xs font-mono cursor-pointer transition-all shadow-sm"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add Website</span>
                </button>
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center space-x-2 font-mono text-xs">
              {(['all', 'up', 'down', 'disabled'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setWebsiteFilter(f)}
                  className={`px-3 py-1 rounded-lg transition-all cursor-pointer capitalize ${
                    websiteFilter === f 
                      ? 'bg-zinc-800 text-white font-bold border border-zinc-700' 
                      : 'text-zinc-400 hover:text-white border border-transparent'
                  }`}
                >
                  {f === 'all' ? `All (${websites.length})` : f}
                </button>
              ))}
            </div>

            {/* Websites Table */}
            <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl overflow-hidden shadow-md">
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="bg-zinc-950/60 text-zinc-400 border-b border-zinc-800 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="p-4">Target Name & URL</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Response Time</th>
                      <th className="p-4">SSL Certificate</th>
                      <th className="p-4">Check Interval</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {filteredWebsites.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-zinc-500">
                          No websites matching current query.
                        </td>
                      </tr>
                    ) : (
                      filteredWebsites.map(site => (
                        <tr key={site.id} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="p-4">
                            <div className="font-bold text-white">{site.name}</div>
                            <a 
                              href={site.url} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="text-[11px] text-zinc-500 hover:text-white flex items-center space-x-1 mt-0.5"
                            >
                              <span>{site.url}</span>
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          </td>
                          <td className="p-4">
                            {!site.enabled ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] bg-zinc-900 text-zinc-400 border border-zinc-800">
                                Disabled
                              </span>
                            ) : site.last_is_up === true ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-800 text-white border border-zinc-600 flex items-center space-x-1.5 w-max">
                                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                                <span>Online {site.last_status_code ? `(${site.last_status_code})` : ''}</span>
                              </span>
                            ) : site.last_is_up === false ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black text-white border border-white flex items-center space-x-1.5 w-max">
                                <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
                                <span>Down {site.last_status_code ? `(${site.last_status_code})` : ''}</span>
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] bg-zinc-900 text-zinc-400 border border-zinc-700">
                                Pending
                              </span>
                            )}
                          </td>
                          <td className="p-4 font-semibold text-zinc-200">
                            {site.last_response_time !== null ? `${site.last_response_time} ms` : '—'}
                          </td>
                          <td className="p-4 text-zinc-300">
                            {site.last_ssl_days_remaining !== null 
                              ? `${site.last_ssl_days_remaining} days valid`
                              : '—'}
                          </td>
                          <td className="p-4 text-zinc-300">
                            Every {site.check_interval}s
                          </td>
                          <td className="p-4 text-right">
                            <div className="flex items-center justify-end space-x-1.5">
                              <button
                                onClick={() => handleManualCheck(site.id)}
                                disabled={manualCheckingIds[site.id]}
                                title="Check Now"
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-all cursor-pointer border border-zinc-700"
                              >
                                <RefreshCw className={`h-3.5 w-3.5 ${manualCheckingIds[site.id] ? 'animate-spin text-white' : ''}`} />
                              </button>

                              <button
                                onClick={() => handleToggleWebsiteEnabled(site)}
                                title={site.enabled ? 'Pause' : 'Resume'}
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-all cursor-pointer border border-zinc-700"
                              >
                                <Power className="h-3.5 w-3.5" />
                              </button>

                              <button
                                onClick={() => handleOpenEditWebsite(site)}
                                title="Edit"
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-all cursor-pointer border border-zinc-700"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>

                              <button
                                onClick={() => handleDeleteWebsite(site.id, site.name)}
                                title="Delete"
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all cursor-pointer border border-zinc-700"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>

                              <button
                                onClick={() => navigate(`/websites/${site.id}`)}
                                title="View History"
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-all cursor-pointer border border-zinc-700"
                              >
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* ======================================================== */}
        {/* TAB: SERVERS (ANTIGRAVITY SERVER AGENT - AVAILABLE SOON) */}
        {/* ======================================================== */}
        {activeTab === 'servers' && (
          <div className="space-y-8 animate-fadeIn max-w-5xl mx-auto">
            {/* Header / Intro */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-300 pb-6">
              <div>
                <div className="flex items-center space-x-3">
                  <h1 className="text-2xl font-bold text-black tracking-tight font-mono">
                    Antigravity Server Agent
                  </h1>
                  <span className="px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest bg-zinc-800 text-zinc-200 rounded-full border border-zinc-700">
                    Available Soon
                  </span>
                </div>
                <p className="text-xs text-zinc-600 mt-1 font-mono">
                  Lightweight, single-binary daemon for real-time host and infrastructure diagnostics.
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleTabChange('websites')}
                  className="px-3.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-xl text-xs font-mono font-semibold border border-zinc-800 transition-all cursor-pointer"
                >
                  View Monitored Websites
                </button>
              </div>
            </div>

            {/* Hero Card */}
            <div className="bg-zinc-950/90 border border-zinc-800 rounded-3xl p-8 md:p-12 text-center relative overflow-hidden shadow-xl">
              {/* Central Graphic */}
              <div className="relative inline-flex items-center justify-center mb-6">
                <div className="p-5 bg-black rounded-2xl border border-zinc-700 shadow-2xl">
                  <Server className="h-12 w-12 text-white animate-pulse" />
                </div>
                <span className="absolute -bottom-2 px-3 py-0.5 bg-zinc-900 text-zinc-300 text-[9px] font-mono font-bold uppercase rounded-full tracking-widest border border-zinc-700 shadow-md">
                  In Active Development
                </span>
              </div>

              <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight font-mono max-w-xl mx-auto">
                Antigravity Server Agent will be available soon
              </h2>

              <p className="text-zinc-400 text-xs md:text-sm mt-3 max-w-2xl mx-auto leading-relaxed font-mono">
                The native Antigravity Server Agent is currently in active development. Once released, you will be able to install the daemon with a single command on any Linux node, cloud instance, or Docker container to stream live CPU, memory, disk, and load metrics directly to this console.
              </p>

              {/* Install Preview Snippet */}
              <div className="mt-8 max-w-xl mx-auto bg-black border border-zinc-800 rounded-2xl p-4 text-left font-mono shadow-inner">
                <div className="flex items-center justify-between text-[10px] text-zinc-500 border-b border-zinc-800 pb-2 mb-3">
                  <span className="flex items-center space-x-1.5">
                    <Terminal className="h-3 w-3 text-zinc-400" />
                    <span>Upcoming Agent One-Line Install</span>
                  </span>
                  <span className="text-[9px] uppercase tracking-wider text-zinc-500">Preview</span>
                </div>
                <div className="text-xs text-zinc-300 flex items-center justify-between overflow-x-auto">
                  <code className="text-zinc-300 select-all font-mono">
                    curl -sSL https://agent.antigravity.io/install.sh | sudo bash
                  </code>
                  <span className="ml-2 text-[10px] text-zinc-500 font-bold uppercase tracking-wider whitespace-nowrap">
                    Soon
                  </span>
                </div>
              </div>

              {/* Platforms */}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[10px] font-mono text-zinc-400">
                <span className="text-zinc-500">Supported Platforms:</span>
                {['Ubuntu', 'Debian', 'Alpine', 'RHEL / CentOS', 'Docker', 'Kubernetes'].map(os => (
                  <span key={os} className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 rounded-md text-zinc-300">
                    {os}
                  </span>
                ))}
              </div>
            </div>

            {/* Feature Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-md text-left">
                <div className="p-2.5 rounded-xl bg-black border border-zinc-800 w-fit mb-4 text-white">
                  <Cpu className="h-5 w-5" />
                </div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  CPU & Multicore Metrics
                </h3>
                <p className="text-[11px] text-zinc-400 font-mono leading-relaxed mt-2">
                  Per-core processor tracking, load averages (1m, 5m, 15m), and high-utilization process alarms to detect spikes before performance degrades.
                </p>
              </div>

              <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-md text-left">
                <div className="p-2.5 rounded-xl bg-black border border-zinc-800 w-fit mb-4 text-white">
                  <Activity className="h-5 w-5" />
                </div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Memory & RAM Exhaustion
                </h3>
                <p className="text-[11px] text-zinc-400 font-mono leading-relaxed mt-2">
                  Continuous tracking of physical RAM and swap allocations to prevent Out Of Memory (OOM) killer terminations from bringing down critical services.
                </p>
              </div>

              <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-md text-left">
                <div className="p-2.5 rounded-xl bg-black border border-zinc-800 w-fit mb-4 text-white">
                  <HardDrive className="h-5 w-5" />
                </div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Disk & Storage Diagnostics
                </h3>
                <p className="text-[11px] text-zinc-400 font-mono leading-relaxed mt-2">
                  Filesystem mount allocations, storage growth trend projections, and instant alerts when disk partitions approach capacity thresholds.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* ======================================================== */}
        {/* TAB: MICROSERVICES (INTERNAL MICROSERVICES - AVAILABLE SOON) */}
        {/* ======================================================== */}
        {activeTab === 'microservices' && (
          <div className="space-y-8 animate-fadeIn max-w-5xl mx-auto">
            {/* Header / Intro */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-300 pb-6">
              <div>
                <div className="flex items-center space-x-3">
                  <h1 className="text-2xl font-bold text-black tracking-tight font-mono">
                    Microservices & Service Mesh
                  </h1>
                  <span className="px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest bg-zinc-800 text-zinc-200 rounded-full border border-zinc-700">
                    Available Soon
                  </span>
                </div>
                <p className="text-xs text-zinc-600 mt-1 font-mono">
                  Distributed tracing, inter-service RPC latency, and cluster mesh telemetry.
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleTabChange('websites')}
                  className="px-3.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-xl text-xs font-mono font-semibold border border-zinc-800 transition-all cursor-pointer"
                >
                  View Monitored Websites
                </button>
              </div>
            </div>

            {/* Hero Card */}
            <div className="bg-zinc-950/90 border border-zinc-800 rounded-3xl p-8 md:p-12 text-center relative overflow-hidden shadow-xl">
              {/* Central Graphic */}
              <div className="relative inline-flex items-center justify-center mb-6">
                <div className="p-5 bg-black rounded-2xl border border-zinc-700 shadow-2xl">
                  <Boxes className="h-12 w-12 text-white animate-pulse" />
                </div>
                <span className="absolute -bottom-2 px-3 py-0.5 bg-zinc-900 text-zinc-300 text-[9px] font-mono font-bold uppercase rounded-full tracking-widest border border-zinc-700 shadow-md">
                  In Active Development
                </span>
              </div>

              <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight font-mono max-w-xl mx-auto">
                Microservices & Worker Telemetry will be available soon
              </h2>

              <p className="text-zinc-400 text-xs md:text-sm mt-3 max-w-2xl mx-auto leading-relaxed font-mono">
                The native Microservices Suite is currently in active development. Monitor distributed service meshes, gRPC/TCP microservices, Redis queues, and background workers with per-service latency percentiles and real-time failure alerts.
              </p>

              {/* Mesh Probe Snippet Preview */}
              <div className="mt-8 max-w-xl mx-auto bg-black border border-zinc-800 rounded-2xl p-4 text-left font-mono shadow-inner">
                <div className="flex items-center justify-between text-[10px] text-zinc-500 border-b border-zinc-800 pb-2 mb-3">
                  <span className="flex items-center space-x-1.5">
                    <Boxes className="h-3 w-3 text-zinc-400" />
                    <span>Upcoming Mesh Endpoint Protocol</span>
                  </span>
                  <span className="text-[9px] uppercase tracking-wider text-zinc-500">Preview</span>
                </div>
                <div className="text-xs text-zinc-300 flex items-center justify-between overflow-x-auto">
                  <code className="text-zinc-300 select-all font-mono">
                    antigravity mesh probe --target grpc://auth.internal:50051
                  </code>
                  <span className="ml-2 text-[10px] text-zinc-500 font-bold uppercase tracking-wider whitespace-nowrap">
                    Soon
                  </span>
                </div>
              </div>
            </div>

            {/* Feature Teasers Columns */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-md text-left">
                <div className="p-2.5 rounded-xl bg-black border border-zinc-800 w-fit mb-4 text-white">
                  <Boxes className="h-5 w-5" />
                </div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  gRPC & HTTP/2 Probes
                </h3>
                <p className="text-[11px] text-zinc-400 font-mono leading-relaxed mt-2">
                  Real-time health checking across internal Protobuf endpoints with latency distribution tracing.
                </p>
              </div>

              <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-md text-left">
                <div className="p-2.5 rounded-xl bg-black border border-zinc-800 w-fit mb-4 text-white">
                  <Cpu className="h-5 w-5" />
                </div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Worker Queue Tracing
                </h3>
                <p className="text-[11px] text-zinc-400 font-mono leading-relaxed mt-2">
                  Consumer lag checks, queue depth alerts, and job processing throughput across Redis, Kafka, and RabbitMQ.
                </p>
              </div>

              <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-md text-left">
                <div className="p-2.5 rounded-xl bg-black border border-zinc-800 w-fit mb-4 text-white">
                  <Terminal className="h-5 w-5" />
                </div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Mesh Topology Map
                </h3>
                <p className="text-[11px] text-zinc-400 font-mono leading-relaxed mt-2">
                  Visual relationship mapping of upstream and downstream service dependencies with error budget tracking.
                </p>
              </div>
            </div>

            {/* Telemetry Preview Table */}
            <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl overflow-hidden shadow-md">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                <div className="flex items-center space-x-2 font-mono text-xs text-zinc-400 font-bold uppercase tracking-wider">
                  <Boxes className="h-4 w-4 text-white" />
                  <span>Internal Microservices Schema</span>
                </div>
                <span className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-widest bg-zinc-800 text-zinc-300 rounded border border-zinc-700">
                  Schema Preview
                </span>
              </div>
              <div className="divide-y divide-zinc-800/80 font-mono text-xs">
                {previewMicroservices.map(ms => (
                  <div key={ms.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white">
                        <Boxes className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="font-bold text-white">{ms.name}</div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">{ms.endpoint}</div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-6 text-[11px]">
                      <div>
                        <span className="text-zinc-500 block text-[9px]">TYPE</span>
                        <span className="text-zinc-300 font-semibold">{ms.protocol}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block text-[9px]">TARGET SLA</span>
                        <span className="text-zinc-200 font-semibold">{ms.uptime}</span>
                      </div>
                      <div>
                        <span className="px-2 py-0.5 bg-zinc-800 text-zinc-300 border border-zinc-700 rounded-full text-[10px] font-bold">
                          AVAILABLE SOON
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB: ALERTS LOG (AUDIT TRAIL & INCIDENTS) */}
        {/* ======================================================== */}
        {activeTab === 'alerts' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-300 pb-6">
              <div>
                <h1 className="text-2xl font-bold text-black tracking-tight font-mono">Incidents & Alerts Log</h1>
                <p className="text-xs text-zinc-600 mt-1 font-mono">
                  Audit log of automated healthcheck failures, acknowledgment traces, and resolution timestamps.
                </p>
              </div>

              {/* Status Filter Tabs */}
              <div className="flex items-center space-x-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800 font-mono text-xs">
                {(['all', 'active', 'acknowledged', 'resolved'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setAlertFilter(tab)}
                    className={`px-3 py-1 rounded-lg capitalize transition-all cursor-pointer ${
                      alertFilter === tab
                        ? 'bg-zinc-800 text-white font-bold border border-zinc-700'
                        : 'text-zinc-400 hover:text-white border border-transparent'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* Alerts List */}
            <div className="space-y-3">
              {filteredAlerts.length === 0 ? (
                <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-12 text-center">
                  <CheckCircle2 className="h-10 w-10 text-white mx-auto mb-3" />
                  <p className="text-sm font-semibold text-white font-mono">No incidents found in this filter.</p>
                  <p className="text-xs text-zinc-500 mt-1">All monitored resources are operating properly.</p>
                </div>
              ) : (
                filteredAlerts.map(alert => (
                  <div
                    key={alert.id}
                    className={`bg-zinc-900/90 border rounded-2xl p-4 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-md ${
                      alert.status === 'active'
                        ? 'border-white bg-zinc-900/95'
                        : alert.status === 'acknowledged'
                        ? 'border-zinc-600 bg-zinc-900/80'
                        : 'border-zinc-800 opacity-80 bg-zinc-900/50'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <div className={`p-2 rounded-lg border text-xs mt-0.5 ${
                        alert.status === 'active' 
                          ? 'bg-zinc-800 border-zinc-500 text-white' 
                          : alert.status === 'acknowledged'
                          ? 'bg-zinc-800 border-zinc-600 text-zinc-300'
                          : 'bg-zinc-900 border-zinc-700 text-zinc-400'
                      }`}>
                        {alert.status === 'resolved' ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
                      </div>

                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-white text-sm">{alert.website_name}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-semibold ${
                            alert.status === 'active'
                              ? 'bg-black text-white border border-white'
                              : alert.status === 'acknowledged'
                              ? 'bg-zinc-800 text-zinc-300 border border-zinc-600'
                              : 'bg-zinc-900 text-zinc-400 border border-zinc-700'
                          }`}>
                            {alert.status}
                          </span>
                        </div>

                        <p className="text-xs text-zinc-300 font-mono mt-1">{alert.message}</p>
                        
                        <div className="flex items-center space-x-3 text-[10px] font-mono text-zinc-500 mt-1.5">
                          <span>Triggered: {new Date(alert.triggered_at).toLocaleString()}</span>
                          {alert.resolved_at && (
                            <>
                              <span>·</span>
                              <span className="text-zinc-300 font-medium">Resolved: {new Date(alert.resolved_at).toLocaleString()}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center space-x-2 shrink-0">
                      {alert.status === 'active' && (
                        <button
                          onClick={() => handleAcknowledgeAlert(alert.id)}
                          disabled={actioningAlertIds[alert.id]}
                          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white font-mono text-xs font-medium rounded-lg border border-zinc-700 transition-all cursor-pointer flex items-center space-x-1"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>Acknowledge</span>
                        </button>
                      )}

                      {alert.status !== 'resolved' && (
                        <button
                          onClick={() => handleResolveAlert(alert.id)}
                          disabled={actioningAlertIds[alert.id]}
                          className="px-3 py-1.5 bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-mono text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center space-x-1 shadow-sm"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Resolve</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB: SETTINGS (ALERT CHANNELS & SYSTEM CONFIG) */}
        {/* ======================================================== */}
        {activeTab === 'settings' && (
          <div className="space-y-6 animate-fadeIn max-w-4xl">
            <div className="border-b border-zinc-300 pb-6">
              <h1 className="text-2xl font-bold text-black tracking-tight font-mono">System Settings & Integrations</h1>
              <p className="text-xs text-zinc-600 mt-1 font-mono">
                Configure webhook channels, public status availability, and system parameters.
              </p>
            </div>

            {/* Notification Integrations */}
            <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-md space-y-5">
              <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider flex items-center space-x-2">
                <Bell className="h-4 w-4 text-white" />
                <span>Alert Webhook Integrations</span>
              </h3>

              {/* Slack */}
              <div className="p-4 bg-zinc-950/60 rounded-xl border border-zinc-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <Slack className="h-5 w-5 text-white" />
                    <div>
                      <span className="font-bold text-white text-xs font-mono">Slack Incoming Webhook</span>
                      <p className="text-[11px] text-zinc-500">Post instant incident messages to your ops channel.</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleSendTestAlert('slack')}
                    disabled={testAlertSending}
                    className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg text-xs font-mono font-medium border border-zinc-700 transition-all cursor-pointer"
                  >
                    Send Test
                  </button>
                </div>
              </div>

              {/* Teams */}
              <div className="p-4 bg-zinc-950/60 rounded-xl border border-zinc-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <Activity className="h-5 w-5 text-white" />
                    <div>
                      <span className="font-bold text-white text-xs font-mono">Microsoft Teams Webhook</span>
                      <p className="text-[11px] text-zinc-500">Adaptive Card notifications for incident dispatch.</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleSendTestAlert('teams')}
                    disabled={testAlertSending}
                    className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg text-xs font-mono font-medium border border-zinc-700 transition-all cursor-pointer"
                  >
                    Send Test
                  </button>
                </div>
              </div>

              {/* Email */}
              <div className="p-4 bg-zinc-950/60 rounded-xl border border-zinc-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <Mail className="h-5 w-5 text-white" />
                    <div>
                      <span className="font-bold text-white text-xs font-mono">SMTP Email Alerts</span>
                      <p className="text-[11px] text-zinc-500">Dispatches urgent incident emails to registered admins.</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleSendTestAlert('email')}
                    disabled={testAlertSending}
                    className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg text-xs font-mono font-medium border border-zinc-700 transition-all cursor-pointer"
                  >
                    Send Test
                  </button>
                </div>
              </div>

              {testAlertFeedback && (
                <div className="p-3 bg-zinc-800/80 border border-zinc-700 rounded-xl text-xs font-mono text-zinc-200">
                  {testAlertFeedback}
                </div>
              )}
            </div>

            {/* Public Status Page */}
            <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-md flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider flex items-center space-x-2">
                  <ShieldCheck className="h-4 w-4 text-white" />
                  <span>Public Status Page</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-1 font-mono">
                  Allow your end users and customers to view live operational status without logging in.
                </p>
                <a
                  href="/status"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-mono text-zinc-300 hover:text-white underline flex items-center space-x-1 mt-2"
                >
                  <span>Open /status page</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-zinc-800 text-white border border-zinc-600">
                ACTIVE
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB: USERS (TEAM & ACCESS MANAGEMENT) */}
        {/* ======================================================== */}
        {activeTab === 'users' && (
          <div className="space-y-6 animate-fadeIn max-w-5xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-300 pb-6">
              <div>
                <h1 className="text-2xl font-bold text-black tracking-tight font-mono">Console Users & Team</h1>
                <p className="text-xs text-zinc-600 mt-1 font-mono">
                  Manage administrator accounts, engineers, and viewer roles.
                </p>
              </div>

              <button
                onClick={() => setIsUserModalOpen(true)}
                className="flex items-center space-x-1.5 py-2 px-4 bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-bold rounded-xl text-xs font-mono cursor-pointer transition-all shadow-sm"
              >
                <Plus className="h-4 w-4" />
                <span>Add Console User</span>
              </button>
            </div>

            {/* Users Table */}
            <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl overflow-hidden shadow-md">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-zinc-950/60 text-zinc-400 border-b border-zinc-800 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="p-4">Email</th>
                    <th className="p-4">Role</th>
                    <th className="p-4">Member Since</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {usersList.length === 0 ? (
                    <tr>
                      <td className="p-4 text-white font-semibold">{user?.email} (You)</td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-white border border-zinc-600">
                          {user?.role || 'admin'}
                        </span>
                      </td>
                      <td className="p-4 text-zinc-400">Active session</td>
                      <td className="p-4 text-right text-zinc-500">—</td>
                    </tr>
                  ) : (
                    usersList.map(u => (
                      <tr key={u.id} className="hover:bg-zinc-800/30 transition-colors">
                        <td className="p-4 font-semibold text-white">
                          {u.email} {u.email === user?.email && <span className="text-zinc-500 font-normal">(You)</span>}
                        </td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            u.role === 'admin' 
                              ? 'bg-zinc-800 text-white border border-zinc-600' 
                              : u.role === 'user'
                              ? 'bg-zinc-900 text-zinc-300 border border-zinc-700'
                              : 'bg-zinc-950 text-zinc-400 border border-zinc-800'
                          }`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="p-4 text-zinc-400">
                          {new Date(u.created_at).toLocaleDateString()}
                        </td>
                        <td className="p-4 text-right">
                          {u.email !== user?.email && (
                            <button
                              onClick={() => handleDeleteUser(u.id, u.email)}
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all cursor-pointer border border-zinc-700"
                              title="Delete user"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>

      {/* ======================================================== */}
      {/* MODAL: ADD / EDIT WEBSITE */}
      {/* ======================================================== */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative font-mono">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-5 right-5 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center space-x-2.5 mb-5">
              <div className="p-2 bg-zinc-900 rounded-lg border border-zinc-700 text-white">
                <Globe className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-white font-sans">
                {editingSite ? 'Edit Monitored Website' : 'Add Monitored Website'}
              </h3>
            </div>

            {formError && (
              <div className="p-3 mb-4 rounded-xl bg-zinc-900 border border-white text-white text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleWebsiteSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-zinc-400 mb-1 font-medium">Friendly Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Production API Gateway"
                  value={siteName}
                  onChange={e => setSiteName(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-500 rounded-xl py-2 px-3 text-white placeholder-zinc-600 focus:outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1 font-medium">Target URL</label>
                <input
                  type="url"
                  required
                  placeholder="https://example.com/healthz"
                  value={siteUrl}
                  onChange={e => setSiteUrl(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-500 rounded-xl py-2 px-3 text-white placeholder-zinc-600 focus:outline-none transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 mb-1 font-medium">Check Interval</label>
                  <select
                    value={siteInterval}
                    onChange={e => setSiteInterval(Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-500 rounded-xl py-2 px-3 text-white focus:outline-none transition-all"
                  >
                    <option value={30}>Every 30 seconds</option>
                    <option value={60}>Every 1 minute</option>
                    <option value={300}>Every 5 minutes</option>
                    <option value={600}>Every 10 minutes</option>
                  </select>
                </div>

                <div>
                  <label className="block text-zinc-400 mb-1 font-medium">Timeout Limit</label>
                  <select
                    value={siteTimeout}
                    onChange={e => setSiteTimeout(Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-500 rounded-xl py-2 px-3 text-white focus:outline-none transition-all"
                  >
                    <option value={5}>5 seconds</option>
                    <option value={10}>10 seconds</option>
                    <option value={20}>20 seconds</option>
                    <option value={30}>30 seconds</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-900 transition-all cursor-pointer font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 rounded-xl bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-bold transition-all cursor-pointer shadow-sm"
                >
                  {formSubmitting ? 'Saving...' : editingSite ? 'Update Checkpoint' : 'Save Checkpoint'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: ADD CONSOLE USER */}
      {/* ======================================================== */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative font-mono">
            <button
              onClick={() => setIsUserModalOpen(false)}
              className="absolute top-5 right-5 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center space-x-2.5 mb-5">
              <div className="p-2 bg-zinc-900 rounded-lg border border-zinc-700 text-white">
                <Users className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-white font-sans">
                Add Console User
              </h3>
            </div>

            {userFormError && (
              <div className="p-3 mb-4 rounded-xl bg-zinc-900 border border-white text-white text-xs">
                {userFormError}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-4 text-xs">
              <div>
                <label className="block text-zinc-400 mb-1 font-medium">Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="engineer@company.com"
                  value={newUserEmail}
                  onChange={e => setNewUserEmail(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-500 rounded-xl py-2 px-3 text-white placeholder-zinc-600 focus:outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1 font-medium">Initial Password</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={newUserPassword}
                  onChange={e => setNewUserPassword(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-500 rounded-xl py-2 px-3 text-white placeholder-zinc-600 focus:outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1 font-medium">Role Assignment</label>
                <select
                  value={newUserRole}
                  onChange={e => setNewUserRole(e.target.value as any)}
                  className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-500 rounded-xl py-2 px-3 text-white focus:outline-none transition-all"
                >
                  <option value="user">User (Manage Websites & Alerts)</option>
                  <option value="admin">Admin (Full System Permissions)</option>
                  <option value="viewer">Viewer (Read Only)</option>
                </select>
              </div>

              <div className="pt-4 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-900 transition-all cursor-pointer font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={userFormSubmitting}
                  className="px-5 py-2 rounded-xl bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-bold transition-all cursor-pointer shadow-sm"
                >
                  {userFormSubmitting ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="border-t border-zinc-800 py-6 px-4 md:px-8 mt-12 text-center text-[11px] font-mono text-zinc-500 relative z-10">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Antigravity Uptime Engine v1.4.0 — High Availability Monitor</span>
          <span>Status: All dispatch queues operational</span>
        </div>
      </footer>

    </div>
  );
};

export default Dashboard;
