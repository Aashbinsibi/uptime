# Uptime Monitoring - Development Guide

This guide provides specific instructions for implementing features and following project conventions.

## Implementation Patterns

### Adding API Endpoints

**Backend Structure**:
```typescript
// src/routes/websites.ts
import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { WebsiteSchema } from '../schemas/website';

const router = Router();

router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    // Validate input
    const data = WebsiteSchema.parse(req.body);
    
    // Execute business logic
    const result = await db.query(
      'INSERT INTO websites (name, url, user_id) VALUES ($1, $2, $3) RETURNING *',
      [data.name, data.url, req.user.id]
    );
    
    // Return standardized response
    res.status(201).json({
      success: true,
      data: result.rows[0],
      error: null
    });
  } catch (error) {
    // Error middleware handles this
    next(error);
  }
});

export default router;
```

**Frontend Integration**:
```typescript
// src/services/api.ts
export const createWebsite = (data: WebsiteInput) =>
  api.post('/websites', data);

// src/components/WebsiteForm.tsx
const onSubmit = async (data) => {
  try {
    const response = await createWebsite(data);
    socket.emit('website-created', response.data);
    // Update UI
  } catch (error) {
    showErrorNotification(error.message);
  }
};
```

### Database Migrations

Use Knex for migrations (to be configured):

```bash
npx knex migrate:make add_websites_table
```

**Migration file**:
```typescript
export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('websites', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('name').notNullable();
    table.string('url').notNullable();
    table.integer('check_interval').defaultTo(300);
    table.uuid('user_id').references('users.id').onDelete('CASCADE');
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('websites');
}
```

### WebSocket Events

**Backend (Socket.io Server)**:
```typescript
// src/services/socket.ts
io.on('connection', (socket) => {
  socket.on('subscribe-website', (websiteId) => {
    socket.join(`website:${websiteId}`);
  });
});

// Broadcast check result
export function broadcastCheckResult(websiteId: string, result: CheckResult) {
  io.to(`website:${websiteId}`).emit('website-status-changed', {
    websiteId,
    isUp: result.is_up,
    statusCode: result.status_code,
    responseTime: result.response_time,
    checkedAt: result.checked_at
  });
}
```

**Frontend (React Hook)**:
```typescript
// src/hooks/useWebsiteStatus.ts
export function useWebsiteStatus(websiteId: string) {
  const [status, setStatus] = useState<StatusData | null>(null);
  
  useEffect(() => {
    socket.emit('subscribe-website', websiteId);
    
    const handleStatusChange = (data: StatusData) => {
      if (data.websiteId === websiteId) {
        setStatus(data);
      }
    };
    
    socket.on('website-status-changed', handleStatusChange);
    return () => {
      socket.off('website-status-changed', handleStatusChange);
      socket.emit('unsubscribe-website', websiteId);
    };
  }, [websiteId]);
  
  return status;
}
```

### Input Validation with Zod

**Define Schema**:
```typescript
// src/schemas/website.ts
import { z } from 'zod';

export const WebsiteSchema = z.object({
  name: z.string()
    .min(1, 'Name required')
    .max(255, 'Name too long'),
  url: z.string()
    .url('Invalid URL'),
  check_interval: z.number()
    .min(60, 'Minimum 60 seconds')
    .max(3600, 'Maximum 1 hour'),
  timeout: z.number()
    .min(5, 'Minimum 5 seconds')
    .max(30, 'Maximum 30 seconds'),
  enabled: z.boolean().default(true)
});

export type WebsiteInput = z.infer<typeof WebsiteSchema>;
```

**Use in Route**:
```typescript
router.post('/websites', async (req, res, next) => {
  try {
    const data = WebsiteSchema.parse(req.body);
    // Process validated data
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: error.flatten()
      });
    }
    next(error);
  }
});
```

### Monitoring Service Pattern

**Background Worker**:
```typescript
// src/workers/monitoringService.ts
import cron from 'node-cron';
import axios from 'axios';

export function startMonitoringService() {
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const websites = await getEnabledWebsites();
      
      for (const website of websites) {
        await checkWebsite(website);
      }
    } catch (error) {
      logger.error('Monitoring service error:', error);
    }
  });
}

async function checkWebsite(website: Website) {
  const startTime = Date.now();
  
  try {
    const response = await axios.head(website.url, {
      timeout: website.timeout * 1000,
      maxRedirects: 0
    });
    
    const responseTime = Date.now() - startTime;
    const isUp = response.status >= 200 && response.status < 400;
    
    // Store result
    await saveCheckResult({
      website_id: website.id,
      status_code: response.status,
      response_time: responseTime,
      is_up: isUp,
      error_message: null
    });
    
    // Check state change and trigger alert
    await handleStateChange(website, isUp);
    
    // Broadcast real-time update
    broadcastCheckResult(website.id, { isUp, responseTime });
    
  } catch (error) {
    await saveCheckResult({
      website_id: website.id,
      status_code: 0,
      response_time: Date.now() - startTime,
      is_up: false,
      error_message: error.message
    });
    
    await handleStateChange(website, false);
  }
}

async function handleStateChange(website: Website, isUp: boolean) {
  const lastResult = await getLastCheckResult(website.id);
  
  if (lastResult?.is_up !== isUp) {
    // State changed, create alert
    await createAlert({
      website_id: website.id,
      type: isUp ? 'UP' : 'DOWN',
      message: `Website ${isUp ? 'is back online' : 'went down'}`
    });
    
    // Send notifications
    await sendNotifications(website.user_id, website, isUp);
  }
}
```

## Testing

### Backend Unit Test Example

```typescript
// src/services/__tests__/websiteService.test.ts
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createWebsite, getWebsite } from '../websiteService';
import db from '../../db';

describe('Website Service', () => {
  beforeEach(async () => {
    await db.query('BEGIN');
  });
  
  afterEach(async () => {
    await db.query('ROLLBACK');
  });
  
  it('should create a website', async () => {
    const website = await createWebsite({
      name: 'Example',
      url: 'https://example.com',
      user_id: 'test-user-id'
    });
    
    expect(website).toHaveProperty('id');
    expect(website.name).toBe('Example');
  });
  
  it('should validate URL format', async () => {
    await expect(createWebsite({
      name: 'Invalid',
      url: 'not-a-url',
      user_id: 'test-user-id'
    })).rejects.toThrow();
  });
});
```

### Frontend Component Test Example

```typescript
// src/components/__tests__/StatusBadge.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StatusBadge from '../StatusBadge';

describe('StatusBadge', () => {
  it('displays UP status with green indicator', () => {
    render(<StatusBadge isUp={true} />);
    expect(screen.getByText('UP')).toHaveClass('bg-green-500');
  });
  
  it('displays DOWN status with red indicator', () => {
    render(<StatusBadge isUp={false} />);
    expect(screen.getByText('DOWN')).toHaveClass('bg-red-500');
  });
});
```

## Environment Configuration

**`.env.example`** (commit this):
```
# Backend
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://user:password@localhost/uptime
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
FRONTEND_URL=http://localhost:5173

# Email notifications
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# Slack integration (optional)
SLACK_WEBHOOK_URL=

# Monitoring
CHECK_TIMEOUT=10
DEFAULT_CHECK_INTERVAL=300
```

**Usage**:
```typescript
// src/config.ts
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000'),
  database: {
    url: process.env.DATABASE_URL,
    pool: { min: 2, max: 20 }
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: '15m'
  }
};
```

## Code Review Checklist

When implementing features, ensure:
- [ ] Input validation with Zod schemas
- [ ] Error handling with try-catch or error middleware
- [ ] TypeScript strict mode compliance
- [ ] Database queries use parameterized statements
- [ ] API responses follow standard format
- [ ] WebSocket events properly scoped to users
- [ ] Tests included (>70% coverage)
- [ ] No hardcoded secrets or credentials
- [ ] HTTPS/secure headers configured
- [ ] Rate limiting applied to sensitive endpoints

## Debugging Tips

**PostgreSQL**:
```bash
# Connect to database
psql $DATABASE_URL

# View tables and schema
\dt  # List tables
\d websites  # Describe table

# Query recent check results
SELECT * FROM check_results ORDER BY checked_at DESC LIMIT 10;
```

**Redis**:
```bash
# Connect to Redis
redis-cli

# Check monitoring data
KEYS "website:*"
GET "website:123:last-status"
```

**Backend Logs**:
```bash
# View backend container logs
docker-compose logs -f backend

# Search for errors
docker-compose logs backend | grep ERROR
```

**Frontend Browser DevTools**:
- Network: Monitor API calls and WebSocket connections
- Console: Check for JavaScript errors
- Application: Inspect cookies, storage, and WebSocket messages
