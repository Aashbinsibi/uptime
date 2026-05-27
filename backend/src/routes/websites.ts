import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { performSingleCheck } from '../services/monitor';

const router = Router();

// Zod validation schemas
const WebsiteCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  url: z.string().url('Invalid URL format. Must start with http:// or https://'),
  check_interval: z.number().int().min(10, 'Minimum check interval is 10 seconds').max(86400).default(60),
  timeout: z.number().int().min(1, 'Minimum timeout is 1 second').max(60).default(10),
  enabled: z.boolean().default(true)
});

const WebsiteUpdateSchema = WebsiteCreateSchema.partial();

// 1. Get all websites (with latest status)
router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    // Use LATERAL join to get the latest check result for each website in a single query
    const { rows } = await query(
      `SELECT w.*, 
              r.is_up as last_is_up, 
              r.status_code as last_status_code, 
              r.response_time as last_response_time, 
              r.checked_at as last_checked_at,
              r.error_message as last_error_message,
              r.ssl_days_remaining as last_ssl_days_remaining
       FROM websites w
       LEFT JOIN LATERAL (
         SELECT is_up, status_code, response_time, checked_at, error_message, ssl_days_remaining
         FROM check_results
         WHERE website_id = w.id
         ORDER BY checked_at DESC
         LIMIT 1
       ) r ON true
       WHERE w.user_id = $1
       ORDER BY w.created_at DESC`,
      [userId]
    );

    return res.json({
      success: true,
      data: rows
    });
  } catch (error: any) {
    console.error('[Websites GET] Error listing websites:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch websites'
    });
  }
});

// 2. Get single website detail
router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const { rows } = await query(
      `SELECT w.*, 
              r.is_up as last_is_up, 
              r.status_code as last_status_code, 
              r.response_time as last_response_time, 
              r.checked_at as last_checked_at,
              r.error_message as last_error_message,
              r.ssl_days_remaining as last_ssl_days_remaining
       FROM websites w
       LEFT JOIN LATERAL (
         SELECT is_up, status_code, response_time, checked_at, error_message, ssl_days_remaining
         FROM check_results
         WHERE website_id = w.id
         ORDER BY checked_at DESC
         LIMIT 1
       ) r ON true
       WHERE w.id = $1 AND w.user_id = $2`,
      [id, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Website not found'
      });
    }

    return res.json({
      success: true,
      data: rows[0]
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch website details'
    });
  }
});

// 3. Create a new website
router.post('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const validated = WebsiteCreateSchema.parse(req.body);

    const { rows } = await query(
      `INSERT INTO websites (name, url, check_interval, timeout, enabled, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        validated.name,
        validated.url,
        validated.check_interval,
        validated.timeout,
        validated.enabled,
        userId
      ]
    );

    const newWebsite = rows[0];

    // Log action
    await query(
      `INSERT INTO audit_logs (user_id, action, resource, new_value)
       VALUES ($1, 'create_website', 'websites', $2)`,
      [userId, JSON.stringify(newWebsite)]
    );

    // Run first check in background asynchronously after creation
    performSingleCheck(newWebsite).catch(err => console.error('[Initial Check Error]', err));

    return res.status(201).json({
      success: true,
      data: newWebsite
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: error.errors[0].message
      });
    }
    console.error('[Websites POST] Error creating website:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to create website'
    });
  }
});

// 4. Update website
router.put('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    // Fetch existing
    const { rows: existingRows } = await query(
      'SELECT * FROM websites WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (existingRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Website not found'
      });
    }

    const current = existingRows[0];
    const validated = WebsiteUpdateSchema.parse(req.body);

    const updated = {
      name: validated.name !== undefined ? validated.name : current.name,
      url: validated.url !== undefined ? validated.url : current.url,
      check_interval: validated.check_interval !== undefined ? validated.check_interval : current.check_interval,
      timeout: validated.timeout !== undefined ? validated.timeout : current.timeout,
      enabled: validated.enabled !== undefined ? validated.enabled : current.enabled,
    };

    const { rows } = await query(
      `UPDATE websites 
       SET name = $1, url = $2, check_interval = $3, timeout = $4, enabled = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [
        updated.name,
        updated.url,
        updated.check_interval,
        updated.timeout,
        updated.enabled,
        id,
        userId
      ]
    );

    // Audit logs
    await query(
      `INSERT INTO audit_logs (user_id, action, resource, old_value, new_value)
       VALUES ($1, 'update_website', 'websites', $2, $3)`,
      [userId, JSON.stringify(current), JSON.stringify(rows[0])]
    );

    return res.json({
      success: true,
      data: rows[0]
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
      error: error.message || 'Failed to update website'
    });
  }
});

// 5. Delete website
router.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const { rows: existingRows } = await query(
      'SELECT * FROM websites WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (existingRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Website not found'
      });
    }

    await query('DELETE FROM websites WHERE id = $1 AND user_id = $2', [id, userId]);

    // Log deletion
    await query(
      `INSERT INTO audit_logs (user_id, action, resource, old_value)
       VALUES ($1, 'delete_website', 'websites', $2)`,
      [userId, JSON.stringify(existingRows[0])]
    );

    return res.json({
      success: true,
      message: 'Website deleted successfully'
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete website'
    });
  }
});

// 6. Get check history (last 100 entries for charts)
router.get('/:id/checks', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;

    // Verify website ownership first
    const { rows: ownerRows } = await query(
      'SELECT id FROM websites WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (ownerRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Website not found'
      });
    }

    const { rows } = await query(
      `SELECT id, status_code, response_time, is_up, error_message, checked_at, ssl_days_remaining 
       FROM check_results 
       WHERE website_id = $1 
       ORDER BY checked_at DESC 
       LIMIT $2`,
      [id, limit]
    );

    return res.json({
      success: true,
      data: rows.reverse() // Return in chronological order for easier chart rendering
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch check history'
    });
  }
});

// 7. Get website uptime statistics
router.get('/:id/stats', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const range = (req.query.range as string) || '24h'; // 24h, 7d, 30d

    // Verify website ownership
    const { rows: ownerRows } = await query(
      'SELECT id FROM websites WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (ownerRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Website not found'
      });
    }

    let interval = '1 day';
    if (range === '7d') interval = '7 days';
    if (range === '30d') interval = '30 days';

    // Calculate aggregated statistics
    const statsQuery = `
      SELECT 
        COUNT(*)::integer as total_checks,
        COUNT(CASE WHEN is_up = true THEN 1 END)::integer as up_checks,
        COALESCE(AVG(response_time), 0)::integer as avg_response_time,
        COALESCE(MIN(response_time), 0)::integer as min_response_time,
        COALESCE(MAX(response_time), 0)::integer as max_response_time
      FROM check_results
      WHERE website_id = $1 AND checked_at >= NOW() - INTERVAL '${interval}'
    `;

    const { rows: statsRows } = await query(statsQuery, [id]);
    const stats = statsRows[0];

    const uptimePercentage = stats.total_checks > 0 
      ? parseFloat(((stats.up_checks / stats.total_checks) * 100).toFixed(4))
      : 100.0;

    return res.json({
      success: true,
      data: {
        totalChecks: stats.total_checks,
        upChecks: stats.up_checks,
        avgResponseTime: stats.avg_response_time,
        minResponseTime: stats.min_response_time,
        maxResponseTime: stats.max_response_time,
        uptimePercentage
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch website statistics'
    });
  }
});

// 8. Trigger manual check
router.post('/:id/check', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const { rows: websiteRows } = await query(
      'SELECT * FROM websites WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (websiteRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Website not found'
      });
    }

    const checkResult = await performSingleCheck(websiteRows[0]);

    return res.json({
      success: true,
      message: 'Manual check completed successfully',
      data: checkResult
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Manual check execution failed'
    });
  }
});

export default router;
