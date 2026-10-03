import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { 
  ArrowLeft, Bell, Slack, Mail, Save, Server, ShieldCheck, 
  Clock, ToggleLeft, ToggleRight, CheckCircle2, MessageSquare,
  Users, UserPlus, Trash2, X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface AlertChannel {
  id?: string;
  type: 'slack' | 'email' | 'teams';
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

interface ConsoleUser {
  id: string;
  email: string;
  role: 'admin' | 'user' | 'viewer';
  created_at: string;
}

const Settings: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // User Management State
  const [usersList, setUsersList] = useState<ConsoleUser[]>([]);
  const [userLoading, setUserLoading] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user' | 'viewer'>('user');
  const [userFormError, setUserFormError] = useState('');

  // Settings state
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackUrl, setSlackUrl] = useState('');
  
  const [teamsEnabled, setTeamsEnabled] = useState(false);
  const [teamsUrl, setTeamsUrl] = useState('');
  
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [publicStatusEnabled, setPublicStatusEnabled] = useState(false);

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

        const teams = channels.find(c => c.type === 'teams');
        if (teams) {
          setTeamsEnabled(teams.enabled);
          setTeamsUrl(teams.config.webhookUrl || '');
        }

        const email = channels.find(c => c.type === 'email');
        if (email) {
          setEmailEnabled(email.enabled);
        }
      }

      // Fetch public status config
      const { data: publicStatusRes } = await api.get('/api/settings/public-status');
      if (publicStatusRes.success) {
        setPublicStatusEnabled(publicStatusRes.enabled);
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

  const fetchUsers = async () => {
    if (user?.role !== 'admin') return;
    setUserLoading(true);
    try {
      const { data } = await api.get('/api/users');
      if (data.success) {
        setUsersList(data.data);
      }
    } catch (err: any) {
      console.error('[Settings] Failed to fetch users:', err);
    } finally {
      setUserLoading(false);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserFormError('');
    try {
      const { data } = await api.post('/api/users', {
        email: newEmail,
        password: newPassword,
        role: newRole
      });
      if (data.success) {
        setUsersList(prev => [data.data, ...prev]);
        setShowAddUserModal(false);
        setNewEmail('');
        setNewPassword('');
        setNewRole('user');
      }
    } catch (err: any) {
      setUserFormError(err.response?.data?.error || 'Failed to create user');
    }
  };

  const handleChangeRole = async (userId: string, targetRole: 'admin' | 'user' | 'viewer') => {
    try {
      const { data } = await api.put(`/api/users/${userId}`, {
        role: targetRole
      });
      if (data.success) {
        setUsersList(prev => prev.map(u => u.id === userId ? { ...u, role: data.data.role } : u));
        // Refresh settings/logs to reflect audit logging
        const { data: logsRes } = await api.get('/api/settings/logs');
        if (logsRes.success) {
          setLogs(logsRes.data);
        }
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update user role');
    }
  };

  const handleDeleteUser = async (userId: string, email: string) => {
    if (!window.confirm(`Are you sure you want to delete user "${email}"?`)) return;
    try {
      const { data } = await api.delete(`/api/users/${userId}`);
      if (data.success) {
        setUsersList(prev => prev.filter(u => u.id !== userId));
        // Refresh logs
        const { data: logsRes } = await api.get('/api/settings/logs');
        if (logsRes.success) {
          setLogs(logsRes.data);
        }
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete user');
    }
  };

  useEffect(() => {
    fetchSettingsData();
    fetchUsers();
  }, [user]);

  // Save Channel Configurations
  const handleSaveChannel = async (type: 'slack' | 'email' | 'teams') => {
    setSaving(true);
    setSaveSuccessMsg('');
    setSaveErrorMsg('');

    try {
      const payload = {
        type,
        enabled: type === 'slack' ? slackEnabled : type === 'teams' ? teamsEnabled : emailEnabled,
        config: (type === 'slack' || type === 'teams') ? { webhookUrl: type === 'slack' ? slackUrl : teamsUrl } : {}
      };

      const { data } = await api.post('/api/settings/channels', payload);
      if (data.success) {
        setSaveSuccessMsg(
          type === 'slack' 
            ? 'Slack Webhook saved successfully!' 
            : type === 'teams' 
              ? 'Microsoft Teams Webhook saved successfully!' 
              : 'Email channel saved successfully!'
        );
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

  // Test Channel Configurations
  const handleTestChannel = async (type: 'slack' | 'email' | 'teams') => {
    setSaving(true);
    setSaveSuccessMsg('');
    setSaveErrorMsg('');

    try {
      const config = (type === 'slack' || type === 'teams') ? { webhookUrl: type === 'slack' ? slackUrl : teamsUrl } : {};

      const { data } = await api.post('/api/settings/channels/test', {
        type,
        config
      });

      if (data.success) {
        setSaveSuccessMsg(data.message || `Test alert sent successfully for ${type}!`);
      }
    } catch (error: any) {
      setSaveErrorMsg(error.response?.data?.error || `Failed to send test alert for ${type}.`);
    } finally {
      setSaving(false);
    }
  };

  // Save Public Status Configuration
  const handleSavePublicStatus = async () => {
    setSaving(true);
    setSaveSuccessMsg('');
    setSaveErrorMsg('');

    try {
      const { data } = await api.post('/api/settings/public-status', { enabled: publicStatusEnabled });
      if (data.success) {
        setSaveSuccessMsg('Public status page visibility updated successfully!');
        // Refresh logs
        const { data: logsRes } = await api.get('/api/settings/logs');
        if (logsRes.success) {
          setLogs(logsRes.data);
        }
      }
    } catch (error: any) {
      setSaveErrorMsg(error.response?.data?.error || 'Failed to update public status setting.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center glass-panel p-8 rounded-3xl shadow-2xl border border-zinc-800">
          <Bell className="h-10 w-10 text-white animate-spin" />
          <p className="mt-4 text-zinc-400 font-medium text-xs font-mono">Synching notification nodes...</p>
        </div>
      </div>
    );
  }

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

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 md:px-8 mt-8 relative z-10 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Side: Alert Channels Configuration (2 cols) */}
        <section className="lg:col-span-2 space-y-6">
          
          <div className="mb-4">
            <h2 className="text-xl font-bold text-black tracking-wide font-mono">Alert Notification Settings</h2>
            <p className="text-xs text-zinc-600 mt-1">Configure communication channels to dispatch immediate UP/DOWN alert signals.</p>
          </div>

          {saveSuccessMsg && (
            <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-100 font-semibold font-mono flex items-center space-x-2">
              <CheckCircle2 className="h-4.5 w-4.5 text-white" />
              <span>{saveSuccessMsg}</span>
            </div>
          )}

          {saveErrorMsg && (
            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-700 text-xs text-white font-mono">
              {saveErrorMsg}
            </div>
          )}

          {/* 1. Slack Webhook configuration card */}
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden border border-zinc-800">
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-zinc-900 rounded-xl border border-zinc-700">
                  <Slack className="h-5.5 w-5.5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white font-mono">Slack Webhook alerts</h3>
                  <p className="text-[10px] text-zinc-400 mt-0.5">Sends formatted message cards directly into a Slack workspace channel.</p>
                </div>
              </div>

              {/* Toggle switch */}
              <button
                onClick={() => setSlackEnabled(prev => !prev)}
                className="text-zinc-400 hover:text-white cursor-pointer transition-colors"
              >
                {slackEnabled ? (
                  <ToggleRight className="h-7 w-7 text-white" />
                ) : (
                  <ToggleLeft className="h-7 w-7 text-zinc-600" />
                )}
              </button>
            </div>

            {/* Config inputs (shows only when toggled) */}
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400 font-medium block font-mono">Incoming Webhook URL</label>
                <input
                  type="url"
                  value={slackUrl}
                  onChange={(e) => setSlackUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/YOUR_WORKSPACE_ID/CHANNEL_ID/SECRET_TOKEN"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 px-3 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-white transition-colors font-mono"
                  disabled={!slackEnabled || saving}
                />
              </div>

              <div className="flex justify-end pt-2 space-x-3">
                <button
                  type="button"
                  onClick={() => handleTestChannel('slack')}
                  disabled={saving || !slackUrl}
                  className="flex items-center space-x-1.5 py-1.5 px-4 bg-zinc-900 hover:bg-zinc-800 active:bg-black text-zinc-300 font-semibold rounded-xl text-xs cursor-pointer border border-zinc-700 disabled:opacity-40 transition-colors"
                >
                  <span>Test Channel</span>
                </button>
                <button
                  onClick={() => handleSaveChannel('slack')}
                  disabled={saving || (slackEnabled && !slackUrl)}
                  className="flex items-center space-x-1.5 py-1.5 px-4 bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-bold rounded-xl text-xs cursor-pointer disabled:opacity-40 disabled:pointer-events-none transition-colors shadow-sm"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>Save Slack Config</span>
                </button>
              </div>
            </div>
          </div>

          {/* Teams Webhook configuration card */}
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden border border-zinc-800">
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-zinc-900 rounded-xl border border-zinc-700">
                  <MessageSquare className="h-5.5 w-5.5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white font-mono">Microsoft Teams Webhook alerts</h3>
                  <p className="text-[10px] text-zinc-400 mt-0.5">Sends formatted Message Cards directly into a Microsoft Teams channel.</p>
                </div>
              </div>

              {/* Toggle switch */}
              <button
                onClick={() => setTeamsEnabled(prev => !prev)}
                className="text-zinc-400 hover:text-white cursor-pointer transition-colors"
              >
                {teamsEnabled ? (
                  <ToggleRight className="h-7 w-7 text-white" />
                ) : (
                  <ToggleLeft className="h-7 w-7 text-zinc-600" />
                )}
              </button>
            </div>

            {/* Config inputs (shows only when toggled) */}
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400 font-medium block font-mono">Incoming Webhook URL</label>
                <input
                  type="url"
                  value={teamsUrl}
                  onChange={(e) => setTeamsUrl(e.target.value)}
                  placeholder="https://YOUR_ORGANIZATION.webhook.office.com/webhookb2/YOUR_WEBHOOK_DETAILS"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 px-3 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-white transition-colors font-mono"
                  disabled={!teamsEnabled || saving}
                />
              </div>

              <div className="flex justify-end pt-2 space-x-3">
                <button
                  type="button"
                  onClick={() => handleTestChannel('teams')}
                  disabled={saving || !teamsUrl}
                  className="flex items-center space-x-1.5 py-1.5 px-4 bg-zinc-900 hover:bg-zinc-800 active:bg-black text-zinc-300 font-semibold rounded-xl text-xs cursor-pointer border border-zinc-700 disabled:opacity-40 transition-colors"
                >
                  <span>Test Channel</span>
                </button>
                <button
                  onClick={() => handleSaveChannel('teams')}
                  disabled={saving || (teamsEnabled && !teamsUrl)}
                  className="flex items-center space-x-1.5 py-1.5 px-4 bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-bold rounded-xl text-xs cursor-pointer disabled:opacity-40 disabled:pointer-events-none transition-colors shadow-sm"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>Save Teams Config</span>
                </button>
              </div>
            </div>
          </div>

          {/* 2. Email alert channels configuration card */}
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden border border-zinc-800">
            <div className="flex justify-between items-start">
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-zinc-900 rounded-xl border border-zinc-700">
                  <Mail className="h-5.5 w-5.5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white font-mono">SMTP Email reports</h3>
                  <p className="text-[10px] text-zinc-400 mt-0.5">Sends diagnostic HTML alert tables directly to the configured SMTP account.</p>
                </div>
              </div>

              {/* Toggle switch */}
              <button
                onClick={() => setEmailEnabled(prev => !prev)}
                className="text-zinc-400 hover:text-white cursor-pointer transition-colors"
              >
                {emailEnabled ? (
                  <ToggleRight className="h-7 w-7 text-white" />
                ) : (
                  <ToggleLeft className="h-7 w-7 text-zinc-600" />
                )}
              </button>
            </div>

            {/* Email note explanation */}
            <div className="mt-4 p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl text-[10px] text-zinc-400 leading-relaxed font-mono">
              Emails will be dispatched to your environment account address: <span className="text-zinc-200 font-semibold">{import.meta.env.VITE_SMTP_USER || 'configured in backend .env'}</span>. Change the SMTP login values inside the backend configurations to adjust this routing.
            </div>

            <div className="flex justify-end pt-4 mt-2 border-t border-zinc-800 space-x-3">
              <button
                type="button"
                onClick={() => handleTestChannel('email')}
                disabled={saving}
                className="flex items-center space-x-1.5 py-1.5 px-4 bg-zinc-900 hover:bg-zinc-800 active:bg-black text-zinc-300 font-semibold rounded-xl text-xs cursor-pointer border border-zinc-700 disabled:opacity-40 transition-colors"
              >
                <span>Test Channel</span>
              </button>
              <button
                onClick={() => handleSaveChannel('email')}
                disabled={saving}
                className="flex items-center space-x-1.5 py-1.5 px-4 bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-bold rounded-xl text-xs cursor-pointer disabled:opacity-40 transition-colors shadow-sm"
              >
                <Save className="h-3.5 w-3.5" />
                <span>Save Email Status</span>
              </button>
            </div>
          </div>

          {/* 3. Public Uptime Sharing configuration card */}
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden border border-zinc-800">
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-zinc-900 rounded-xl border border-zinc-700">
                  <Server className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">Public Uptime Sharing</h3>
                  <p className="text-[10px] text-zinc-400 mt-0.5">Allows non-authenticated users to view website status on the login page.</p>
                </div>
              </div>
              <button
                onClick={() => setPublicStatusEnabled(!publicStatusEnabled)}
                className="flex items-center focus:outline-none cursor-pointer"
              >
                {publicStatusEnabled ? (
                  <ToggleRight className="h-9 w-9 text-white" />
                ) : (
                  <ToggleLeft className="h-9 w-9 text-zinc-600" />
                )}
              </button>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/40 leading-relaxed text-xs">
                <p className="text-zinc-200 font-semibold mb-1 font-mono">Status: {publicStatusEnabled ? 'Publicly Enabled' : 'Privately Restricted'}</p>
                <p className="text-zinc-400 text-[10px]">
                  {publicStatusEnabled 
                    ? "Anyone visiting the sign-in page will be able to see the names and current status (ONLINE/OFFLINE) of all active monitored websites. No detailed metrics or history will be shared."
                    : "Guest users will see a standard login portal. The list of websites is private and requires authentication to view."}
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-4 mt-4 border-t border-zinc-800">
              <button
                onClick={handleSavePublicStatus}
                disabled={saving}
                className="flex items-center space-x-1.5 py-1.5 px-4 bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-bold rounded-xl text-xs cursor-pointer disabled:opacity-40 transition-colors shadow-sm"
              >
                <Save className="h-3.5 w-3.5" />
                <span>Save Public Share Settings</span>
              </button>
            </div>
          </div>

          {/* 4. User Management configuration card (Admin only) */}
          {user?.role === 'admin' && (
            <div className="glass-panel rounded-2xl p-6 relative overflow-hidden border border-zinc-800">
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center space-x-3">
                  <div className="p-3 bg-zinc-900 rounded-xl border border-zinc-700">
                    <Users className="h-5.5 w-5.5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">Console User Accounts</h3>
                    <p className="text-[10px] text-zinc-400 mt-0.5">Manage console administrator, writer, and read-only viewer accounts.</p>
                  </div>
                </div>

                <button
                  onClick={() => setShowAddUserModal(true)}
                  className="flex items-center space-x-1.5 py-1.5 px-3 bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-bold rounded-xl text-[10px] cursor-pointer transition-colors shadow-sm"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>Add Account</span>
                </button>
              </div>

              {/* User list */}
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                {userLoading ? (
                  <p className="text-xs text-zinc-500 italic font-mono">Syncing user nodes...</p>
                ) : usersList.length === 0 ? (
                  <p className="text-xs text-zinc-500 italic font-mono">No user accounts found.</p>
                ) : (
                  usersList.map((usr) => (
                    <div key={usr.id} className="flex justify-between items-center p-3 rounded-xl bg-zinc-950/60 border border-zinc-800 text-xs">
                      <div className="truncate max-w-[55%] font-mono">
                        <p className="text-zinc-200 font-medium truncate" title={usr.email}>{usr.email}</p>
                        <p className="text-[9px] text-zinc-500 mt-0.5">Registered: {new Date(usr.created_at).toLocaleDateString()}</p>
                      </div>

                      <div className="flex items-center space-x-3">
                        {/* Role selection dropdown */}
                        <select
                          value={usr.role}
                          onChange={(e) => handleChangeRole(usr.id, e.target.value as any)}
                          disabled={usr.id === user.id}
                          className="bg-zinc-950 border border-zinc-700 rounded-lg py-1 px-2 text-[10px] text-zinc-300 focus:outline-none focus:border-white font-mono"
                        >
                          <option value="admin">Admin</option>
                          <option value="user">User</option>
                          <option value="viewer">Viewer</option>
                        </select>

                        {/* Delete account */}
                        <button
                          onClick={() => handleDeleteUser(usr.id, usr.email)}
                          disabled={usr.id === user.id}
                          className="p-1.5 bg-zinc-900 hover:bg-black text-zinc-400 hover:text-white rounded-lg border border-zinc-700 cursor-pointer disabled:opacity-20 disabled:pointer-events-none transition-colors"
                          title="Remove user account"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </section>

        {/* Right Side: Security Audit Logs (1 col) */}
        <section className="glass-panel p-6 rounded-2xl flex flex-col h-[520px] overflow-hidden border border-zinc-800">
          <div className="flex items-center space-x-2.5 mb-2">
            <Server className="h-4.5 w-4.5 text-zinc-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">Console Audit Logs</h3>
          </div>
          <p className="text-[10px] text-zinc-400 leading-relaxed mb-6 border-b border-zinc-800 pb-3 font-mono">
            Tracks user interactions, deletions, logins, and configurations for self-hosted security compliance.
          </p>

          {/* Scrollable logs list */}
          <div className="flex-grow overflow-y-auto space-y-4 pr-1">
            {logs.map((log) => {
              let actionTitle = log.action;

              if (log.action.includes('register')) {
                actionTitle = 'System Bootstrapped';
              } else if (log.action.includes('create')) {
                actionTitle = 'Created Checkpoint';
              } else if (log.action.includes('delete')) {
                actionTitle = 'Deleted Checkpoint';
              } else if (log.action.includes('login')) {
                actionTitle = 'Terminal Sign In';
              } else if (log.action.includes('update')) {
                actionTitle = 'Updated Config';
              }

              return (
                <div key={log.id} className="flex space-x-3 text-[11px] leading-relaxed">
                  <div className="p-1.5 rounded-lg border border-zinc-700 bg-zinc-900 text-white flex-shrink-0 flex items-center justify-center h-7 w-7">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2 font-mono">
                      <span className="font-bold text-white">{actionTitle}</span>
                      <span className="text-[9px] text-zinc-500">•</span>
                      <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider">{log.resource}</span>
                    </div>
                    
                    {log.ip_address && (
                      <div className="text-[9px] text-zinc-500 mt-0.5 font-mono">IP Address: {log.ip_address}</div>
                    )}
                    
                    <div className="flex items-center space-x-1.5 text-[9px] text-zinc-400 mt-1 font-mono">
                      <Clock className="h-3 w-3" />
                      <span>{new Date(log.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            
            {logs.length === 0 && (
              <div className="text-center py-12 text-zinc-500 italic text-[10px] font-mono">
                No security logs recorded.
              </div>
            )}
          </div>
        </section>
      </main>

      {showAddUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl glass-panel p-6 md:p-8 animate-in fade-in zoom-in-95 duration-150 border border-zinc-700 shadow-2xl relative">
            
            {/* Modal Header */}
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-base font-bold text-white font-mono">
                Register Console Account
              </h3>
              <button 
                onClick={() => {
                  setShowAddUserModal(false);
                  setUserFormError('');
                }}
                className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-md cursor-pointer transition-colors"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            {userFormError && (
              <div className="mb-4 p-3 rounded-lg bg-zinc-950 border border-zinc-700 text-xs text-white font-medium font-mono">
                {userFormError}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleAddUser} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400 font-medium block font-mono">Account Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl py-2 px-3.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-white transition-colors font-mono"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400 font-medium block font-mono">Temporary Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl py-2 px-3.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-white transition-colors font-mono"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400 font-medium block font-mono">Access Privilege Level</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as any)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-white transition-colors font-mono"
                >
                  <option value="viewer">Viewer (Read-only)</option>
                  <option value="user">User (Manage checkpoints)</option>
                  <option value="admin">Administrator (Full Access)</option>
                </select>
              </div>

              {/* Submit panel */}
              <div className="flex space-x-3 pt-4 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddUserModal(false);
                    setUserFormError('');
                  }}
                  className="py-2 px-4 bg-zinc-900 hover:bg-black text-zinc-400 hover:text-white rounded-xl text-xs font-semibold cursor-pointer border border-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="py-2 px-4 bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-bold rounded-xl text-xs cursor-pointer transition-colors shadow-sm"
                >
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
