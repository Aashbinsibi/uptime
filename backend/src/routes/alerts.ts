import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import logger from '../services/logger';

const router = Router();

// 1. Get all alerts for authenticated user
router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const statusFilter = req.query.status as string; // 'active' | 'acknowledged' | 'resolved'
    
    let dbQuery = `
      SELECT a.*, w.name as website_name, w.url as website_url
      FROM alerts a
      INNER JOIN websites w ON a.website_id = w.id
      WHERE w.user_id = $1
    `;
    
    const queryParams: any[] = [userId];
    
    if (statusFilter && ['active', 'acknowledged', 'resolved'].includes(statusFilter)) {
      dbQuery += ` AND a.status = $2`;
      queryParams.push(statusFilter);
    }
    
    dbQuery += ` ORDER BY a.triggered_at DESC LIMIT 100`;
    
    const { rows } = await query(dbQuery, queryParams);
    
    return res.json({
      success: true,
      data: rows
    });
  } catch (error: any) {
    logger.error('[Alerts GET] Failed to retrieve user alerts:', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch alerts'
    });
  }
});

// 2. Acknowledge alert
router.put('/:id/acknowledge', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    
    // Check ownership of the website associated with this alert
    const { rows: checkRows } = await query(
      `SELECT a.id, a.status 
       FROM alerts a
       INNER JOIN websites w ON a.website_id = w.id
       WHERE a.id = $1 AND w.user_id = $2`,
      [id, userId]
    );
    
    if (checkRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Alert not found'
      });
    }
    
    const currentAlert = checkRows[0];
    if (currentAlert.status !== 'active') {
      return res.status(400).json({
        success: false,
        error: `Cannot acknowledge alert that is currently: ${currentAlert.status}`
      });
    }
    
    // Perform update
    const { rows: updatedRows } = await query(
      `UPDATE alerts 
       SET status = 'acknowledged' 
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    
    // Audit log
    await query(
      `INSERT INTO audit_logs (user_id, action, resource, old_value, new_value)
       VALUES ($1, 'acknowledge_alert', 'alerts', $2, $3)`,
      [userId, JSON.stringify(currentAlert), JSON.stringify(updatedRows[0])]
    );
    
    logger.info(`[Alerts API] Alert acknowledged: ${id} by user ${userId}`);
    
    return res.json({
      success: true,
      message: 'Alert acknowledged successfully.',
      data: updatedRows[0]
    });
  } catch (error: any) {
    logger.error('[Alerts PUT Acknowledge] Error:', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error'
    });
  }
});

// 3. Manually Resolve Alert
router.put('/:id/resolve', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    
    // Check ownership
    const { rows: checkRows } = await query(
      `SELECT a.id, a.status 
       FROM alerts a
       INNER JOIN websites w ON a.website_id = w.id
       WHERE a.id = $1 AND w.user_id = $2`,
      [id, userId]
    );
    
    if (checkRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Alert not found'
      });
    }
    
    const currentAlert = checkRows[0];
    if (currentAlert.status === 'resolved') {
      return res.status(400).json({
        success: false,
        error: 'Alert is already resolved.'
      });
    }
    
    // Perform update
    const { rows: updatedRows } = await query(
      `UPDATE alerts 
       SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    
    // Audit log
    await query(
      `INSERT INTO audit_logs (user_id, action, resource, old_value, new_value)
       VALUES ($1, 'resolve_alert', 'alerts', $2, $3)`,
      [userId, JSON.stringify(currentAlert), JSON.stringify(updatedRows[0])]
    );
    
    logger.info(`[Alerts API] Alert manually resolved: ${id} by user ${userId}`);
    
    return res.json({
      success: true,
      message: 'Alert resolved successfully.',
      data: updatedRows[0]
    });
  } catch (error: any) {
    logger.error('[Alerts PUT Resolve] Error:', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error'
    });
  }
});

export default router;
