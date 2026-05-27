import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// 1. Get alert channels configuration
router.get('/channels', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { rows } = await query(
      'SELECT id, type, config, enabled FROM alert_channels WHERE user_id = $1',
      [userId]
    );

    return res.json({
      success: true,
      data: rows
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch settings'
    });
  }
});

// 2. Configure / Save alert channel (Slack Webhook or Email enablement)
router.post('/channels', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { type, config, enabled } = req.body; // type = 'slack' | 'email'

    if (!type || !['slack', 'email'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid channel type. Supported: slack, email'
      });
    }

    // Check if channel already exists for user
    const { rows: existing } = await query(
      'SELECT id FROM alert_channels WHERE user_id = $1 AND type = $2',
      [userId, type]
    );

    let resultChannel;

    if (existing.length > 0) {
      // Update existing
      const { rows } = await query(
        `UPDATE alert_channels 
         SET config = $1, enabled = $2 
         WHERE user_id = $3 AND type = $4
         RETURNING *`,
        [JSON.stringify(config || {}), enabled !== undefined ? enabled : true, userId, type]
      );
      resultChannel = rows[0];
    } else {
      // Insert new
      const { rows } = await query(
        `INSERT INTO alert_channels (user_id, type, config, enabled)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [userId, type, JSON.stringify(config || {}), enabled !== undefined ? enabled : true]
      );
      resultChannel = rows[0];
    }

    // Log action
    await query(
      `INSERT INTO audit_logs (user_id, action, resource, new_value)
       VALUES ($1, 'update_channel', 'alert_channels', $2)`,
      [userId, JSON.stringify(resultChannel)]
    );

    return res.json({
      success: true,
      message: `${type.toUpperCase()} notification channel updated successfully.`,
      data: resultChannel
    });
  } catch (error: any) {
    console.error('[Settings Router] Error updating alert channel:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to save channel configuration'
    });
  }
});

// 3. Get user audit logs
router.get('/logs', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { rows } = await query(
      `SELECT id, action, resource, old_value, new_value, ip_address, created_at 
       FROM audit_logs 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [userId]
    );

    return res.json({
      success: true,
      data: rows
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch audit logs'
    });
  }
});

export default router;
