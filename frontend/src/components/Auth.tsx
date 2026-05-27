import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Activity, ShieldCheck, Mail, Lock, Server, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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
      setInfoMsg('Welcome! As this is the first run, please configure your administrator account to secure this installation.');
    } else {
      setIsRegistering(false);
      setInfoMsg('');
    }
  }, [isSetupRequired]);

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
      <div className="min-h-screen flex items-center justify-center bg-[#080c14]">
        <div className="flex flex-col items-center">
          <Activity className="h-10 w-10 text-emerald-500 animate-pulse-glow-green animate-bounce" />
          <p className="mt-4 text-slate-400 font-medium tracking-wide">Syncing monitoring cores...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full relative flex items-center justify-center p-4 md:p-8 overflow-hidden select-none">
      {/* Glow Blur Orbs */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[450px] h-[450px] rounded-full bg-blue-500/10 blur-[100px] pointer-events-none" />

      {/* Main Container */}
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 rounded-2xl glass-panel overflow-hidden relative z-10">
        
        {/* Left Side: Brand Narrative */}
        <div className="hidden md:flex flex-col justify-between p-12 bg-gradient-to-br from-slate-900/60 to-slate-950/80 border-r border-white/5 relative">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 glow-green-pulse">
              <Activity className="h-6 w-6 text-emerald-400" />
            </div>
            <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              ANTIGRAVITY UPTIME
            </span>
          </div>

          <div className="my-8">
            <h1 className="text-3xl font-extrabold leading-tight text-white mb-4">
              Real-Time Node <br />Availability Tracking.
            </h1>
            <p className="text-slate-400 text-sm leading-relaxed max-w-xs">
              Monitor response times, analyze SSL health, and receive instant alert notifications during website downtime events.
            </p>
          </div>

          <div className="flex items-center space-x-3 text-xs text-slate-500 bg-slate-900/40 p-3.5 rounded-lg border border-white/5">
            <ShieldCheck className="h-4.5 w-4.5 text-emerald-500 flex-shrink-0" />
            <span>Encrypted credentials & secure cookie sessions.</span>
          </div>
        </div>

        {/* Right Side: Authentication Forms */}
        <div className="p-8 md:p-12 flex flex-col justify-center">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-white mb-2">
              {isSetupRequired ? 'System Setup' : 'Secure Core Access'}
            </h2>
            <p className="text-slate-400 text-sm">
              {isSetupRequired 
                ? 'Initialize database with administrator credentials' 
                : 'Enter your credentials to manage monitoring tasks'}
            </p>
          </div>

          {infoMsg && (
            <div className="mb-5 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400 leading-relaxed">
              {infoMsg}
            </div>
          )}

          {errorMsg && (
            <div className="mb-5 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-medium">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email field */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium block">Account Email</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                  <Mail className="h-4 w-4" />
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@monitoring.local"
                  className="w-full bg-slate-950/50 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                  disabled={submitting}
                  required
                />
              </div>
            </div>

            {/* Password field */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium block">Password</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                  <Lock className="h-4 w-4" />
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-950/50 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                  disabled={submitting}
                  required
                />
              </div>
            </div>

            {/* Confirm Password field (only during register setup) */}
            {isRegistering && isSetupRequired && (
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-medium block">Confirm Password</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950/50 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
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
              className="w-full mt-2 flex items-center justify-center space-x-2 py-2.5 px-4 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 font-bold rounded-xl shadow-lg shadow-emerald-500/10 cursor-pointer disabled:opacity-50 transition-all"
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
              className="mt-4 text-xs text-emerald-400 hover:underline cursor-pointer block text-center"
            >
              Back to Login
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Auth;
