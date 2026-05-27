import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../db';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_please_change_in_production';
const COOKIE_SECURE = process.env.NODE_ENV === 'production';

// Check if any users exist in the database (Setup state)
router.get('/setup-status', async (req, res) => {
  try {
    const { rows } = await query('SELECT COUNT(*)::integer as count FROM users');
    const isSetupRequired = rows[0].count === 0;
    return res.json({
      success: true,
      data: { isSetupRequired }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to check system setup status'
    });
  }
});

// Register the first user as Admin (Setup registration)
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long'
      });
    }

    // Check if user table is empty
    const { rows: countRows } = await query('SELECT COUNT(*)::integer as count FROM users');
    const isEmpty = countRows[0].count === 0;

    if (!isEmpty) {
      return res.status(403).json({
        success: false,
        error: 'Registration is locked. The system has already been initialized.'
      });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert user
    const { rows: userRows } = await query(
      `INSERT INTO users (email, password_hash, role) 
       VALUES ($1, $2, 'admin') 
       RETURNING id, email, role, created_at`,
      [email.toLowerCase().trim(), passwordHash]
    );

    const newUser = userRows[0];

    // Log audit log
    await query(
      `INSERT INTO audit_logs (user_id, action, resource, new_value)
       VALUES ($1, 'register_admin', 'users', $2)`,
      [newUser.id, JSON.stringify({ id: newUser.id, email: newUser.email, role: newUser.role })]
    );

    return res.status(201).json({
      success: true,
      message: 'System initialized successfully. First administrator registered.',
      data: {
        user: {
          id: newUser.id,
          email: newUser.email,
          role: newUser.role
        }
      }
    });
  } catch (error: any) {
    console.error('[Auth Register] Error registering admin:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error'
    });
  }
});

// User Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    const { rows } = await query(
      'SELECT id, email, password_hash, role FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    const user = rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' } // 7-day token
    );

    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Write audit log
    await query(
      `INSERT INTO audit_logs (user_id, action, resource)
       VALUES ($1, 'login', 'auth')`,
      [user.id]
    );

    return res.json({
      success: true,
      data: {
        token, // Return token as fallback for non-cookie APIs
        user: {
          id: user.id,
          email: user.email,
          role: user.role
        }
      }
    });
  } catch (error: any) {
    console.error('[Auth Login] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error'
    });
  }
});

// User Logout
router.post('/logout', async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Clear cookies
    res.clearCookie('token');
    return res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to logout'
    });
  }
});

// Get Session Profile
router.get('/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    return res.json({
      success: true,
      data: {
        user: req.user
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch session'
    });
  }
});

export default router;
