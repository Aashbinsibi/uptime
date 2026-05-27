import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../utils/api';

interface User {
  id: string;
  email: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isSetupRequired: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSetupStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSetupRequired, setIsSetupRequired] = useState(false);

  const refreshSetupStatus = async () => {
    try {
      const { data } = await api.get('/api/auth/setup-status');
      if (data.success) {
        setIsSetupRequired(data.data.isSetupRequired);
      }
    } catch (error) {
      console.error('[AuthContext] Failed to retrieve setup status:', error);
    }
  };

  const checkAuth = async () => {
    try {
      const { data } = await api.get('/api/auth/me');
      if (data.success && data.data.user) {
        setUser(data.data.user);
      }
    } catch (error) {
      // Ignore 401 on boot
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    const { data } = await api.post('/api/auth/login', { email, password });
    if (data.success && data.data.user) {
      setUser(data.data.user);
      // Set header fallback for direct APIs if needed
      if (data.data.token) {
        api.defaults.headers.common['Authorization'] = `Bearer ${data.data.token}`;
      }
    }
  };

  const register = async (email: string, password: string) => {
    const { data } = await api.post('/api/auth/register', { email, password });
    if (data.success) {
      setIsSetupRequired(false);
      // Register success doesn't automatically log in for security, let them sign in!
    }
  };

  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } catch (error) {
      console.error('[AuthContext] Logout api error:', error);
    } finally {
      setUser(null);
      delete api.defaults.headers.common['Authorization'];
    }
  };

  useEffect(() => {
    const init = async () => {
      await refreshSetupStatus();
      await checkAuth();
    };
    init();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isSetupRequired,
        login,
        register,
        logout,
        refreshSetupStatus
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
