import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_please_change_in_production';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

const parseCookies = (cookieHeader?: string): Record<string, string> => {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const key = parts.shift()?.trim();
    if (key) {
      list[key] = decodeURIComponent(parts.join('='));
    }
  });
  return list;
};

export const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    let token = '';

    // 1. Check cookies
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.token) {
      token = cookies.token;
    }

    // 2. Fallback to Authorization Header
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please log in.'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: string;
      email: string;
      role: string;
    };

    req.user = decoded;
    next();
  } catch (error) {
    console.error('[Auth Middleware] Token verification failed:', error);
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired session. Please log in again.'
    });
  }
};

export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden. Admin access required.'
      });
    }
    next();
  });
};

export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    requireAuth(req, res, () => {
      if (!req.user || !allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error: `Forbidden. Requires one of the following roles: ${allowedRoles.join(', ')}`
        });
      }
      next();
    });
  };
};

export const requireWriter = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  requireRole(['admin', 'user'])(req, res, next);
};

