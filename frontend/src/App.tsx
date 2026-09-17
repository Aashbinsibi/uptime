import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import WebsiteDetail from './components/WebsiteDetail';
import Settings from './components/Settings';
import Alerts from './components/Alerts';
import ServerMonitoring from './components/ServerMonitoring';
import { Activity } from 'lucide-react';

const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center glass-panel p-6 rounded-2xl shadow-xl border border-white/10">
          <Activity className="h-8 w-8 text-white animate-spin" />
          <p className="mt-4 text-xs text-zinc-400 tracking-wider">Syncing secure console session...</p>
        </div>
      </div>
    );
  }

  return user ? <>{children}</> : <Navigate to="/login" replace />;
};

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Authentication Screen */}
          <Route path="/login" element={<Auth />} />

          {/* Secure Console Dashboard Routes */}
          <Route 
            path="/" 
            element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/websites/:id" 
            element={
              <PrivateRoute>
                <WebsiteDetail />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/settings" 
            element={
              <PrivateRoute>
                <Settings />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/alerts" 
            element={
              <PrivateRoute>
                <Alerts />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/server-monitoring" 
            element={
              <PrivateRoute>
                <ServerMonitoring />
              </PrivateRoute>
            } 
          />

          {/* Redirection fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
