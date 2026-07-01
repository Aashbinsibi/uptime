import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { sendSlackAlert, sendTeamsAlert, sendEmailAlert } from '../services/notifier';
import { promisify } from 'util';
import { lookup } from 'dns';

const dnsLookup = promisify(lookup);

/**
 * Check if IP address is in a private, loopback, or link-local range
 */
export function isRestrictedIP(address: string): boolean {
  // IPv4 checks
  const ipv4Parts = address.split('.');
  if (ipv4Parts.length === 4) {
    const parts = ipv4Parts.map(Number);
    if (isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2]) || isNaN(parts[3])) {
      return false;
    }
    // 127.0.0.0/8 - Loopback
    if (parts[0] === 127) return true;
    // 10.0.0.0/8 - Private
    if (parts[0] === 10) return true;
    // 172.16.0.0/12 - Private
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16 - Private
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16 - Link-local
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 0.0.0.0/8 - Current network
    if (parts[0] === 0) return true;
  }

  // IPv6 checks
  if (address.includes(':')) {
    // ::1 - Loopback
    if (address === '::1') return true;
    // fe80::/10 - Link-local
    if (address.startsWith('fe80:')) return true;
    // fc00::/7 - Unique local
    if (address.startsWith('fc') || address.startsWith('fd')) return true;
  }

  return false;
}

/**
 * Validate webhook URL for security: HTTPS, hostname restrictions, no private IPs
 */
export async function isValidWebhookUrl(urlStr: string, type: 'slack' | 'teams'): Promise<{ valid: boolean; error?: string }> {
  try {
    // Parse URL
    const url = new URL(urlStr);

    // Enforce HTTPS
    if (url.protocol !== 'https:') {
      return { valid: false, error: 'Webhook URL must use HTTPS protocol' };
    }

    const hostname = url.hostname;

    // Validate hostname based on type
    if (type === 'slack') {
      if (!hostname.endsWith('hooks.slack.com')) {
        return { valid: false, error: 'Slack webhook must be from hooks.slack.com' };
      }
    } else if (type === 'teams') {
      const isValidTeamsHost =
        hostname.endsWith('webhook.office.com') ||
        hostname.endsWith('outlook.office.com') ||
        hostname.endsWith('outlook.office365.com') ||
        hostname.endsWith('logic.azure.com') ||
        hostname.endsWith('logic.office.com') ||
        hostname.endsWith('powerplatform.com');
      if (!isValidTeamsHost) {
        return {
          valid: false,
          error: 'Teams webhook must be from a valid Microsoft Teams or Power Automate domain'
        };
      }
    }

    // Resolve hostname to IP and check if it's private/loopback/link-local
    try {
      const { address } = await dnsLookup(hostname);

      if (isRestrictedIP(address)) {
        return { valid: false, error: 'Webhook URL resolves to a private or restricted IP range' };
      }
    } catch (dnsError) {
      return { valid: false, error: 'Unable to resolve webhook URL hostname' };
    }

    return { valid: true };
  } catch (error: any) {
    return { valid: false, error: error.message || 'Invalid webhook URL format' };
  }
}

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

    if (!type || !['slack', 'email', 'teams'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid channel type. Supported: slack, email, teams'
      });
    }

    // Check if channel already exists for user
    const { rows: existing } = await query(
      'SELECT id FROM alert_channels WHERE user_id = $1 AND type = $2',
      [userId, type]
    );

    // Validate webhook URL if provided for Slack or Teams
    if ((type === 'slack' || type === 'teams') && config?.webhookUrl) {
      const validation = await isValidWebhookUrl(config.webhookUrl, type);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: validation.error || 'Invalid webhook URL'
        });
      }
    }

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

// 4. Get public status sharing configuration
router.get('/public-status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { rows } = await query(
      "SELECT value FROM global_settings WHERE key = 'public_status_enabled'"
    );
    const enabled = rows.length > 0 ? rows[0].value === true : false;
    return res.json({
      success: true,
      enabled
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch public status setting'
    });
  }
});

// 5. Update public status sharing configuration
router.post('/public-status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { enabled } = req.body;

    if (enabled === undefined || typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Field "enabled" is required and must be a boolean.'
      });
    }

    await query(
      `INSERT INTO global_settings (key, value, updated_at) 
       VALUES ('public_status_enabled', $1::jsonb, CURRENT_TIMESTAMP) 
       ON CONFLICT (key) 
       DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(enabled)]
    );

    // Log action
    await query(
      `INSERT INTO audit_logs (user_id, action, resource, new_value)
       VALUES ($1, 'update_public_status', 'global_settings', $2)`,
      [userId, JSON.stringify({ enabled })]
    );

    return res.json({
      success: true,
      message: `Public status listing has been ${enabled ? 'enabled' : 'disabled'} successfully.`,
      enabled
    });
  } catch (error: any) {
    console.error('[Settings Router] Error updating public status setting:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to save public status configuration'
    });
  }
});

// 6. Send test notification
router.post('/channels/test', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { type, config } = req.body;

    if (!type || !['slack', 'email', 'teams'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid channel type. Supported: slack, email, teams'
      });
    }

    const testWebsite = {
      name: 'Uptime Monitor Probe Test',
      url: 'https://example.com',
      user_id: userId
    };
    const testMessage = 'This is a manual test notification to confirm your alert channel settings are working correctly.';

    if (type === 'slack') {
      const webhookUrl = config?.webhookUrl;
      if (!webhookUrl) return res.status(400).json({ success: false, error: 'Slack Webhook URL is required' });
      
      // Validate webhook URL before sending
      const validation = await isValidWebhookUrl(webhookUrl, 'slack');
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: validation.error || 'Invalid Slack webhook URL' });
      }
      
      await sendSlackAlert(webhookUrl, testWebsite, 'down', testMessage);
    } else if (type === 'teams') {
      const webhookUrl = config?.webhookUrl;
      if (!webhookUrl) return res.status(400).json({ success: false, error: 'Teams Webhook URL is required' });
      
      // Validate webhook URL before sending
      const validation = await isValidWebhookUrl(webhookUrl, 'teams');
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: validation.error || 'Invalid Teams webhook URL' });
      }
      
      await sendTeamsAlert(webhookUrl, testWebsite, 'down', testMessage);
    } else if (type === 'email') {
      await sendEmailAlert(testWebsite, 'down', testMessage);
    }

    return res.json({
      success: true,
      message: `Test alert dispatched successfully for ${type.toUpperCase()}!`
    });
  } catch (error: any) {
    console.error('[Settings Router] Error sending test notification:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to dispatch test notification'
    });
  }
});

export default router;
