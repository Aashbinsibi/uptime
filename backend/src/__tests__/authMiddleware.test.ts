import { requireAuth, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_please_change_in_production';

describe('Authentication Middleware', () => {
  let mockRequest: Partial<AuthenticatedRequest>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction = jest.fn();

  beforeEach(() => {
    mockRequest = {
      headers: {},
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFunction = jest.fn();
  });

  describe('requireAuth', () => {
    it('should return 401 if no token is provided in cookies or header', () => {
      requireAuth(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        error: 'Authentication required. Please log in.',
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should authenticate user and call next() with valid token in authorization header', () => {
      const payload = { id: 'user-123', email: 'test@example.com', role: 'admin' };
      const token = jwt.sign(payload, JWT_SECRET);

      mockRequest.headers = {
        authorization: `Bearer ${token}`,
      };

      requireAuth(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockRequest.user).toMatchObject(payload);
    });

    it('should authenticate user and call next() with valid token in cookie header', () => {
      const payload = { id: 'user-456', email: 'user@example.com', role: 'user' };
      const token = jwt.sign(payload, JWT_SECRET);

      mockRequest.headers = {
        cookie: `token=${token}`,
      };

      requireAuth(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockRequest.user).toMatchObject(payload);
    });

    it('should return 401 status for expired or invalid token', () => {
      mockRequest.headers = {
        authorization: 'Bearer invalid_token_123',
      };

      requireAuth(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid or expired session. Please log in again.',
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });

  describe('requireAdmin', () => {
    it('should call next() if user is an admin', () => {
      const payload = { id: 'admin-123', email: 'admin@example.com', role: 'admin' };
      const token = jwt.sign(payload, JWT_SECRET);
      mockRequest.headers = {
        authorization: `Bearer ${token}`,
      };

      requireAdmin(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should return 403 if user is authenticated but not an admin', () => {
      const payload = { id: 'user-789', email: 'user@example.com', role: 'user' };
      const token = jwt.sign(payload, JWT_SECRET);
      mockRequest.headers = {
        authorization: `Bearer ${token}`,
      };

      requireAdmin(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        error: 'Forbidden. Admin access required.',
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });
});
