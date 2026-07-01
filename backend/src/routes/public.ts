import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();

// GET /api/public/status - Get names and statuses of monitored nodes (if enabled by users)
router.get('/status', async (req: Request, res: Response) => {
  try {
    // Fetch all enabled websites along with their latest online/offline state,
    // only for users who have opted into public sharing.
    const { rows: websitesRows } = await query(`
      SELECT w.id, w.name, r.is_up
      FROM websites w
      JOIN users u ON w.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT is_up
        FROM check_results
        WHERE website_id = w.id
        ORDER BY checked_at DESC
        LIMIT 1
      ) r ON true
      WHERE w.enabled = true AND u.public_sharing_enabled = true
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
