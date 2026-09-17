import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Activity, ShieldCheck, Mail, Lock, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';

const Auth: React.FC = () => {
  const { user, login, register, isSetupRequired, loading, refreshSetupStatus } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  // Public status sharing state
  const [publicNodes, setPublicNodes] = useState<any[]>([]);
  const [publicEnabled, setPublicEnabled] = useState(false);

  useEffect(() => {
    // If already logged in, send to dashboard!
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  useEffect(() => {
    // Set view based on setup requirements
    if (isSetupRequired) {
      setIsRegistering(true);
      setInfoMsg('Initial Setup Mode: Please register the administrative controller.');
    } else {
      setIsRegistering(false);
      setInfoMsg('');
    }
  }, [isSetupRequired]);

  useEffect(() => {
    const fetchPublicStatus = async () => {
      try {
        const { data } = await api.get('/api/public/status');
        if (data.success) {
          setPublicEnabled(data.enabled);
          setPublicNodes(data.data);
        }
      } catch (err) {
        console.error('[Public Status] Failed to fetch:', err);
      }
    };
    fetchPublicStatus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);

    if (!email || !password) {
      setErrorMsg('Please enter both email and password.');
      setSubmitting(false);
      return;
    }

    try {
      if (isRegistering && isSetupRequired) {
        if (password !== confirmPassword) {
          setErrorMsg('Passwords do not match.');
          setSubmitting(false);
          return;
        }
        await register(email, password);
        setInfoMsg('Administrator account registered! You can now log in using these credentials.');
        setIsRegistering(false);
        setPassword('');
        setConfirmPassword('');
        await refreshSetupStatus();
      } else {
        await login(email, password);
        navigate('/');
      }
    } catch (error: any) {
      console.error('[Auth Form] Error submitting:', error);
      setErrorMsg(
        error.response?.data?.error || 'An error occurred. Please verify your connection and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center glass-panel p-8 rounded-3xl shadow-2xl border border-zinc-800">
          <Activity className="h-10 w-10 text-white animate-spin" />
          <p className="mt-4 text-zinc-400 font-medium tracking-wide text-xs font-mono">Syncing monitoring cores...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full relative flex items-center justify-center p-4 md:p-8 overflow-hidden select-none">
      {/* Main Container */}
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 rounded-2xl glass-panel overflow-hidden relative z-10 border border-zinc-800 shadow-2xl">
        
        {/* Left Side: Brand Narrative */}
        <div className="hidden md:flex flex-col justify-between p-12 bg-zinc-950 border-r border-zinc-800 relative">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-zinc-900 rounded-xl border border-zinc-700 glow-mono-pulse">
              <Activity className="h-6 w-6 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white font-mono">
              ANTIGRAVITY UPTIME
            </span>
          </div>

          <div className="my-4">
            <h1 className="text-3xl font-extrabold leading-tight text-white mb-3 font-mono">
              Real-Time Node <br />Availability Tracking.
            </h1>
            <p className="text-zinc-400 text-xs leading-relaxed max-w-xs font-mono">
              Monitor response times, analyze SSL health, and receive instant alert notifications during website downtime events.
            </p>
          </div>

          {publicEnabled && publicNodes.length > 0 && (
            <div className="mb-6 flex-grow overflow-hidden flex flex-col max-h-[220px]">
              <h3 className="text-[10px] font-bold text-white uppercase tracking-wider mb-2 font-mono">Live Node Availability</h3>
              <div className="flex-grow overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {publicNodes.map((node) => (
                  <div key={node.id} className="flex justify-between items-center p-2 rounded-xl bg-zinc-900/60 border border-zinc-800 text-xs font-mono">
                    <span className="text-zinc-200 font-medium truncate max-w-[160px]">{node.name}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                      node.is_up === true 
                        ? 'bg-zinc-800 text-white border-zinc-600' 
                        : node.is_up === false 
                        ? 'bg-zinc-950 text-zinc-300 border-zinc-700' 
                        : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                    }`}>
                      {node.is_up === true ? 'ONLINE' : node.is_up === false ? 'OFFLINE' : 'PENDING'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center space-x-3 text-xs text-zinc-400 bg-zinc-900/60 p-3.5 rounded-lg border border-zinc-800 mt-auto font-mono">
            <ShieldCheck className="h-4.5 w-4.5 text-white flex-shrink-0" />
            <span>Encrypted credentials & secure cookie sessions.</span>
          </div>
        </div>

        {/* Right Side: Authentication Forms */}
        <div className="p-8 md:p-12 flex flex-col justify-center bg-zinc-950/40">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-white mb-2 font-mono">
              {isSetupRequired ? 'System Setup' : 'Secure Core Access'}
            </h2>
            <p className="text-zinc-400 text-sm">
              {isSetupRequired 
                ? 'Initialize database with administrator credentials' 
                : 'Enter your credentials to manage monitoring tasks'}
            </p>
          </div>

          {infoMsg && (
            <div className="mb-5 p-3 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 leading-relaxed font-mono">
              {infoMsg}
            </div>
          )}

          {errorMsg && (
            <div className="mb-5 p-3 rounded-lg bg-zinc-950 border border-zinc-700 text-xs text-white font-medium font-mono">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email field */}
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400 font-medium block font-mono">Account Email</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-zinc-500">
                  <Mail className="h-4 w-4" />
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@monitoring.local"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-white transition-colors font-mono"
                  disabled={submitting}
                  required
                />
              </div>
            </div>

            {/* Password field */}
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400 font-medium block font-mono">Password</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-zinc-500">
                  <Lock className="h-4 w-4" />
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-white transition-colors font-mono"
                  disabled={submitting}
                  required
                />
              </div>
            </div>

            {/* Confirm Password field (only during register setup) */}
            {isRegistering && isSetupRequired && (
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400 font-medium block font-mono">Confirm Password</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-zinc-500">
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-white transition-colors font-mono"
                    disabled={submitting}
                    required={isRegistering}
                  />
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-2 flex items-center justify-center space-x-2 py-2.5 px-4 bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-bold rounded-xl shadow-md cursor-pointer disabled:opacity-50 transition-all font-mono"
            >
              <span>{isSetupRequired ? 'Initialize Console' : 'Access Dashboard'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          {/* Setup registration fallback context */}
          {!isSetupRequired && isRegistering && (
            <button
              onClick={() => {
                setIsRegistering(false);
                setErrorMsg('');
              }}
              className="mt-4 text-xs text-zinc-400 hover:text-white hover:underline cursor-pointer block text-center font-mono"
            >
              Back to Login
            </button>
          )}

          {/* Public Status List for Mobile at the bottom of forms */}
          {publicEnabled && publicNodes.length > 0 && (
            <div className="mt-6 pt-5 border-t border-zinc-800 md:hidden">
              <h3 className="text-[10px] font-bold text-white uppercase tracking-wider mb-2 font-mono">Live Node Status</h3>
              <div className="grid grid-cols-1 gap-2 max-h-[140px] overflow-y-auto pr-1">
                {publicNodes.map((node) => (
                  <div key={node.id} className="flex justify-between items-center p-2 rounded-xl bg-zinc-900/60 border border-zinc-800 text-xs font-mono">
                    <span className="text-zinc-200 font-medium truncate max-w-[180px]">{node.name}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                      node.is_up === true 
                        ? 'bg-zinc-800 text-white border-zinc-600' 
                        : node.is_up === false 
                        ? 'bg-zinc-950 text-zinc-300 border-zinc-700' 
                        : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                    }`}>
                      {node.is_up === true ? 'ONLINE' : node.is_up === false ? 'OFFLINE' : 'PENDING'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Auth;
