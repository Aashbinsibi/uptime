import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();

// GET /api/public/status - Get names and statuses of monitored nodes (if enabled)
router.get('/status', async (req: Request, res: Response) => {
  try {
    // 1. Verify if public status is enabled
    const { rows: settingsRows } = await query(
      "SELECT value FROM global_settings WHERE key = 'public_status_enabled'"
    );
    const enabled = settingsRows.length > 0 ? settingsRows[0].value === true : false;

    if (!enabled) {
      return res.json({
        success: true,
        enabled: false,
        data: []
      });
    }

    // 2. Fetch all enabled websites along with their latest online/offline state
    const { rows: websitesRows } = await query(`
      SELECT w.id, w.name, r.is_up
      FROM websites w
      LEFT JOIN LATERAL (
        SELECT is_up
        FROM check_results
        WHERE website_id = w.id
        ORDER BY checked_at DESC
        LIMIT 1
      ) r ON true
      WHERE w.enabled = true
      ORDER BY w.name ASC
    `);

    return res.json({
      success: true,
      enabled: true,
      data: websitesRows
    });
  } catch (error: any) {
    console.error('[Public Router] Error fetching public status:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch public status'
    });
  }
});

export default router;
