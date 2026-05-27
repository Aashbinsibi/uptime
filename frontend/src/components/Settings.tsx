import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { 
  ArrowLeft, Bell, Slack, Mail, Save, Server, ShieldCheck, 
  Clock, ToggleLeft, ToggleRight, HelpCircle, CheckCircle2 
} from 'lucide-react';

interface AlertChannel {
  id?: string;
  type: 'slack' | 'email';
  config: {
    webhookUrl?: string;
  };
  enabled: boolean;
}

interface AuditLog {
  id: string;
  action: string;
  resource: string;
  old_value: any;
  new_value: any;
  ip_address: string | null;
  created_at: string;
}

const Settings: React.FC = () => {
  const navigate = useNavigate();

  // Settings state
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackUrl, setSlackUrl] = useState('');
  
  const [emailEnabled, setEmailEnabled] = useState(false);

  // Status state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');
  const [saveErrorMsg, setSaveErrorMsg] = useState('');

  // Audit Logs state
  const [logs, setLogs] = useState<AuditLog[]>([]);

  // Fetch configs and logs
  const fetchSettingsData = async () => {
    try {
      // 1. Fetch channel configs
      const { data: channelsRes } = await api.get('/api/settings/channels');
      if (channelsRes.success) {
        const channels: AlertChannel[] = channelsRes.data;
        
        const slack = channels.find(c => c.type === 'slack');
        if (slack) {
          setSlackEnabled(slack.enabled);
          setSlackUrl(slack.config.webhookUrl || '');
        }

        const email = channels.find(c => c.type === 'email');
        if (email) {
          setEmailEnabled(email.enabled);
        }
      }

      // 2. Fetch audit logs
      const { data: logsRes } = await api.get('/api/settings/logs');
      if (logsRes.success) {
        setLogs(logsRes.data);
      }
    } catch (error) {
      console.error('[Settings] Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettingsData();
  }, []);

  // Save Channel Configurations
  const handleSaveChannel = async (type: 'slack' | 'email') => {
    setSaving(true);
    setSaveSuccessMsg('');
    setSaveErrorMsg('');

    try {
      const payload = {
        type,
        enabled: type === 'slack' ? slackEnabled : emailEnabled,
        config: type === 'slack' ? { webhookUrl: slackUrl } : {}
      };

      const { data } = await api.post('/api/settings/channels', payload);
      if (data.success) {
        setSaveSuccessMsg(`${type === 'slack' ? 'Slack Webhook' : 'Email channel'} saved successfully!`);
        // Refresh logs to show updated settings log item
        const { data: logsRes } = await api.get('/api/settings/logs');
        if (logsRes.success) {
          setLogs(logsRes.data);
        }
      }
    } catch (error: any) {
      setSaveErrorMsg(error.response?.data?.error || 'Failed to update alert channel.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080c14]">
        <div className="flex flex-col items-center">
          <Bell className="h-10 w-10 text-emerald-500 animate-bounce" />
          <p className="mt-4 text-slate-400 font-medium">Synching notification nodes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-16 relative">
      {/* Ambients glows */}
      <div className="absolute top-[20%] right-[10%] w-[350px] h-[350px] rounded-full bg-emerald-500/5 blur-[120px] pointer-events-none" />

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
            <Bell className="h-4.5 w-4.5 text-emerald-400" />
          </div>
          <span className="font-bold tracking-tight text-white text-sm hidden sm:inline">
            CORE DISPATCHER
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 md:px-8 mt-8 relative z-10 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Side: Alert Channels Configuration (2 cols) */}
        <section className="lg:col-span-2 space-y-6">
          
          <div className="mb-4">
            <h2 className="text-xl font-bold text-white tracking-wide">Alert Notification Settings</h2>
            <p className="text-xs text-slate-400 mt-1">Configure communication channels to dispatch immediate UP/DOWN alert signals.</p>
          </div>

          {saveSuccessMsg && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 font-semibold flex items-center space-x-2">
              <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500" />
              <span>{saveSuccessMsg}</span>
            </div>
          )}

          {saveErrorMsg && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-medium">
              {saveErrorMsg}
            </div>
          )}

          {/* 1. Slack Webhook configuration card */}
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden">
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-[#e01e5a]/10 rounded-xl border border-[#e01e5a]/20">
                  <Slack className="h-5.5 w-5.5 text-[#e01e5a]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Slack Webhook alerts</h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">Sends formatted message cards directly into a Slack workspace channel.</p>
                </div>
              </div>

              {/* Toggle switch */}
              <button
                onClick={() => setSlackEnabled(prev => !prev)}
                className="text-slate-400 hover:text-white cursor-pointer transition-colors"
              >
                {slackEnabled ? (
                  <ToggleRight className="h-7 w-7 text-emerald-500" />
                ) : (
                  <ToggleLeft className="h-7 w-7 text-slate-600" />
                )}
              </button>
            </div>

            {/* Config inputs (shows only when toggled) */}
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-medium block">Incoming Webhook URL</label>
                <input
                  type="url"
                  value={slackUrl}
                  onChange={(e) => setSlackUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/YOUR_WORKSPACE_ID/CHANNEL_ID/SECRET_TOKEN"
                  className="w-full bg-[#080c14] border border-white/5 rounded-xl py-2 px-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                  disabled={!slackEnabled || saving}
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => handleSaveChannel('slack')}
                  disabled={saving || (slackEnabled && !slackUrl)}
                  className="flex items-center space-x-1.5 py-1.5 px-4 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 font-bold rounded-xl text-xs cursor-pointer disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>Save Slack Config</span>
                </button>
              </div>
            </div>
          </div>

          {/* 2. Email alert channels configuration card */}
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden">
            <div className="flex justify-between items-start">
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20">
                  <Mail className="h-5.5 w-5.5 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">SMTP Email reports</h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">Sends diagnostic HTML alert tables directly to the configured SMTP account.</p>
                </div>
              </div>

              {/* Toggle switch */}
              <button
                onClick={() => setEmailEnabled(prev => !prev)}
                className="text-slate-400 hover:text-white cursor-pointer transition-colors"
              >
                {emailEnabled ? (
                  <ToggleRight className="h-7 w-7 text-emerald-500" />
                ) : (
                  <ToggleLeft className="h-7 w-7 text-slate-600" />
                )}
              </button>
            </div>

            {/* Email note explanation */}
            <div className="mt-4 p-3 bg-slate-950/40 border border-white/5 rounded-xl text-[10px] text-slate-500 leading-relaxed">
              Emails will be dispatched to your environment account address: <span className="text-slate-300 font-semibold">{import.meta.env.VITE_SMTP_USER || 'configured in backend .env'}</span>. Change the SMTP login values inside the backend configurations to adjust this routing.
            </div>

            <div className="flex justify-end pt-4 mt-2 border-t border-white/5">
              <button
                onClick={() => handleSaveChannel('email')}
                disabled={saving}
                className="flex items-center space-x-1.5 py-1.5 px-4 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 font-bold rounded-xl text-xs cursor-pointer disabled:opacity-40 transition-colors"
              >
                <Save className="h-3.5 w-3.5" />
                <span>Save Email Status</span>
              </button>
            </div>
          </div>
        </section>

        {/* Right Side: Security Audit Logs (1 col) */}
        <section className="glass-panel p-6 rounded-2xl flex flex-col h-[520px] overflow-hidden">
          <div className="flex items-center space-x-2.5 mb-2">
            <Server className="h-4.5 w-4.5 text-slate-500" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Console Audit Logs</h3>
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed mb-6 border-b border-white/5 pb-3">
            Tracks user interactions, deletions, logins, and configurations for self-hosted security compliance.
          </p>

          {/* Scrollable logs list */}
          <div className="flex-grow overflow-y-auto space-y-4 pr-1">
            {logs.map((log) => {
              let actionTitle = log.action;
              let actionColor = 'text-slate-300';
              let iconClass = 'bg-slate-900/60 text-slate-400 border-slate-800';

              if (log.action.includes('register')) {
                actionTitle = 'System Bootstrapped';
                actionColor = 'text-emerald-400';
                iconClass = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
              } else if (log.action.includes('create')) {
                actionTitle = 'Created Checkpoint';
                actionColor = 'text-emerald-300';
                iconClass = 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
              } else if (log.action.includes('delete')) {
                actionTitle = 'Deleted Checkpoint';
                actionColor = 'text-rose-400';
                iconClass = 'bg-rose-500/10 text-rose-400 border-rose-500/20';
              } else if (log.action.includes('login')) {
                actionTitle = 'Terminal Sign In';
                actionColor = 'text-blue-400';
                iconClass = 'bg-blue-500/10 text-blue-400 border-blue-500/20';
              } else if (log.action.includes('update')) {
                actionTitle = 'Updated Config';
                actionColor = 'text-blue-300';
                iconClass = 'bg-blue-500/10 text-blue-300 border-blue-500/20';
              }

              return (
                <div key={log.id} className="flex space-x-3 text-[11px] leading-relaxed">
                  <div className={`p-1.5 rounded-lg border flex-shrink-0 flex items-center justify-center h-7 w-7 ${iconClass}`}>
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className={`font-bold ${actionColor}`}>{actionTitle}</span>
                      <span className="text-[9px] text-slate-500">•</span>
                      <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">{log.resource}</span>
                    </div>
                    
                    {log.ip_address && (
                      <div className="text-[9px] text-slate-500 mt-0.5">IP Address: {log.ip_address}</div>
                    )}
                    
                    <div className="flex items-center space-x-1.5 text-[9px] text-slate-500 mt-1">
                      <Clock className="h-3 w-3" />
                      <span>{new Date(log.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            
            {logs.length === 0 && (
              <div className="text-center py-12 text-slate-600 italic text-[10px]">
                No security logs recorded.
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default Settings;
