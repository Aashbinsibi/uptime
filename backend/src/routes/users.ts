import { Router, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { query } from '../db';
import { requireAdmin, requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Zod schemas
const UserCreateSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  role: z.enum(['admin', 'user', 'viewer']).default('user')
});

const UserUpdateSchema = z.object({
  email: z.string().email('Invalid email address').optional(),
  password: z.string().min(6, 'Password must be at least 6 characters long').optional(),
  role: z.enum(['admin', 'user', 'viewer']).optional()
});

// 1. Get all users (Admin only)
router.get('/', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { rows } = await query(
      'SELECT id, email, role, created_at FROM users ORDER BY created_at DESC'
    );
    return res.json({
      success: true,
      data: rows
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch users list'
    });
  }
});

// 2. Create user (Admin only)
router.post('/', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validated = UserCreateSchema.parse(req.body);
    const emailLower = validated.email.toLowerCase().trim();

    // Check if email already registered
    const { rows: existing } = await query('SELECT id FROM users WHERE email = $1', [emailLower]);
    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Email is already registered'
      });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(validated.password, saltRounds);

    const { rows } = await query(
      `INSERT INTO users (email, password_hash, role) 
       VALUES ($1, $2, $3) 
       RETURNING id, email, role, created_at`,
      [emailLower, passwordHash, validated.role]
    );

    const newUser = rows[0];

    // Audit logs
    await query(
      `INSERT INTO audit_logs (user_id, action, resource, new_value)
       VALUES ($1, 'create_user', 'users', $2)`,
      [req.user?.id, JSON.stringify({ id: newUser.id, email: newUser.email, role: newUser.role })]
    );

    return res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: newUser
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: error.errors[0].message
      });
    }
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to create user'
    });
  }
});

// 3. Update user (Admin only for role updates, self-service for password/email updates)
router.put('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    const isSelf = userId === id;
    const isAdmin = userRole === 'admin';

    if (!isSelf && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden. You can only update your own account, or require administrator access.'
      });
    }

    const validated = UserUpdateSchema.parse(req.body);

    // Fetch existing user details
    const { rows: existingRows } = await query(
      'SELECT id, email, role, password_hash FROM users WHERE id = $1',
      [id]
    );

    if (existingRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const current = existingRows[0];

    // Restrict role updates to admin only
    if (validated.role && validated.role !== current.role && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden. Only administrators can change account roles.'
      });
    }

    // Check email availability if updated
    let newEmail = current.email;
    if (validated.email && validated.email.toLowerCase().trim() !== current.email) {
      newEmail = validated.email.toLowerCase().trim();
      const { rows: emailChecks } = await query('SELECT id FROM users WHERE email = $1', [newEmail]);
      if (emailChecks.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Email already in use'
        });
      }
    }

    // Hash password if updated
    let newPasswordHash = current.password_hash;
    if (validated.password) {
      const saltRounds = 12;
      newPasswordHash = await bcrypt.hash(validated.password, saltRounds);
    }

    const newRole = validated.role || current.role;

    // Prevent administrative user from demoting their own role
    if (isSelf && current.role === 'admin' && newRole !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden. Administrative accounts cannot demote their own roles.'
      });
    }

    const { rows } = await query(
      `UPDATE users 
       SET email = $1, password_hash = $2, role = $3
       WHERE id = $4
       RETURNING id, email, role, created_at`,
      [newEmail, newPasswordHash, newRole, id]
    );

    const updatedUser = rows[0];

    // Audit logs
    await query(
      `INSERT INTO audit_logs (user_id, action, resource, old_value, new_value)
       VALUES ($1, 'update_user', 'users', $2, $3)`,
      [userId, JSON.stringify({ email: current.email, role: current.role }), JSON.stringify({ email: updatedUser.email, role: updatedUser.role })]
    );

    return res.json({
      success: true,
      message: 'User profile updated successfully',
      data: updatedUser
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: error.errors[0].message
      });
    }
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to update user profile'
    });
  }
});

// 4. Delete user (Admin only)
router.delete('/:id', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (id === userId) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request. Administrative users cannot delete their own accounts.'
      });
    }

    const { rows: existingRows } = await query(
      'SELECT id, email, role FROM users WHERE id = $1',
      [id]
    );

    if (existingRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    await query('DELETE FROM users WHERE id = $1', [id]);

    // Audit logs
    await query(
      `INSERT INTO audit_logs (user_id, action, resource, old_value)
       VALUES ($1, 'delete_user', 'users', $2)`,
      [userId, JSON.stringify(existingRows[0])]
    );

    return res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete user'
    });
  }
});

export default router;
