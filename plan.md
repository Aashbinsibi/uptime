# Uptime Monitoring Web Application - Project Plan

⚠️ **PRIVATE & CONFIDENTIAL** - Keep this file local and do not share publicly. This contains architecture, security specifications, and technical implementation details for the uptime monitoring system.

---

## Project Overview
A private web application to monitor the uptime/availability of multiple websites with real-time status, historical data, alerts, and analytics.

---

## Core Features

### Phase 1: MVP (Minimum Viable Product)
- [ ] Website monitoring (HTTP/HTTPS checks at regular intervals)
- [ ] Real-time status display (online/offline)
- [ ] Dashboard with website list and status
- [ ] Check history (last 24-48 hours)
- [ ] Basic authentication (single user or API key)

### Phase 2: Enhanced Monitoring
- [ ] Alert system (email/Slack/webhook notifications)
- [ ] Response time tracking & graphs
- [ ] Uptime percentage calculations
- [ ] Status page for public sharing (optional)
- [ ] Configurable check intervals
- [ ] Custom health check rules (status codes, keyword matching)

### Phase 3: Advanced Features
- [ ] Multi-user support with roles
- [ ] API endpoint monitoring
- [ ] SSL certificate expiration alerts
- [ ] Incident tracking & reports
- [ ] Performance metrics & analytics
- [ ] Geolocation-based monitoring
- [ ] Database backups

---

## Technical Architecture

### Tech Stack Options

#### Option A: Node.js/Express + React
- **Backend**: Node.js with Express
- **Frontend**: React + TypeScript
- **Database**: PostgreSQL or MongoDB
- **Task Queue**: Node-cron or Bull (Redis)
- **Deployment**: Docker + Docker Compose

#### Option B: Python/FastAPI + Vue.js
- **Backend**: FastAPI
- **Frontend**: Vue.js or Svelte
- **Database**: PostgreSQL
- **Task Scheduler**: APScheduler or Celery
- **Deployment**: Docker

### ✅ RECOMMENDED: Option A (Node.js/Express + React)

**Justification:**
- **Real-time Capabilities**: WebSocket support with Socket.io for instant alerts and status updates
- **Performance**: Non-blocking I/O handles concurrent connections efficiently (ideal for many simultaneous checks)
- **Development Speed**: Single language (JavaScript) across full stack reduces context switching
- **Ecosystem**: Vast npm ecosystem with mature libraries (axios, node-cron, nodemailer, bull)
- **Scalability**: Easy to add worker processes and queue systems
- **Community**: Large community with extensive documentation and examples
- **TypeScript Support**: Better type safety and developer experience

**Specific Packages:**
- **Backend**: Express, node-cron, pg (PostgreSQL), redis, socket.io, nodemailer, axios, bcrypt
- **Frontend**: React, TypeScript, Chart.js/Recharts, Socket.io-client, TailwindCSS
- **DevOps**: Docker, Docker Compose, nginx

---

## Tech Stack Detailed Specifications

### Backend Dependencies
```json
{
  "express": "^4.18.2",
  "typescript": "^5.0.0",
  "node-cron": "^3.0.2",
  "pg": "^8.10.0",
  "redis": "^4.6.0",
  "socket.io": "^4.6.0",
  "axios": "^1.4.0",
  "bcrypt": "^5.1.0",
  "jsonwebtoken": "^9.0.0",
  "dotenv": "^16.0.3",
  "zod": "^3.21.0",
  "helmet": "^7.0.0",
  "cors": "^2.8.5",
  "express-rate-limit": "^6.7.0",
  "bull": "^4.10.0",
  "nodemailer": "^6.9.0"
}
```

### Frontend Dependencies
```json
{
  "react": "^18.2.0",
  "typescript": "^5.0.0",
  "recharts": "^2.7.0",
  "socket.io-client": "^4.6.0",
  "axios": "^1.4.0",
  "react-router-dom": "^6.12.0",
  "tailwindcss": "^3.3.0",
  "zod": "^3.21.0"
}
```

---

## Architecture Design

```
┌─────────────────────────────────────────┐
│         Frontend (React/SPA)             │
│  - Dashboard, Settings, History, Alerts │
└──────────────────┬──────────────────────┘
                   │ API (REST/WebSocket)
┌──────────────────┴──────────────────────┐
│     Backend (Node.js/Express)            │
│  - API routes, Business logic            │
│  - WebSocket for real-time updates       │
└──────────────────┬──────────────────────┘
         │                    │
    ┌────┴────┐          ┌────┴──────┐
    │          │          │            │
┌───▼──┐  ┌────▼─────┐  ┌─▼──────┐   │
│  DB  │  │  Redis   │  │ Queue  │   │
│(PG)  │  │(Caching) │  │(Tasks) │   │
└──────┘  └──────────┘  └────────┘   │
                                   ┌──▼────────────┐
                                   │ Monitoring    │
                                   │ Service       │
                                   │(Background    │
                                   │ Workers)      │
                                   └───────────────┘
```

---

## Database Schema

### Tables

**websites**
- id (UUID, Primary Key)
- name (string)
- url (string)
- check_interval (integer, seconds)
- timeout (integer, seconds)
- enabled (boolean)
- created_at (timestamp)
- updated_at (timestamp)
- user_id (Foreign Key)

**check_results**
- id (UUID, Primary Key)
- website_id (Foreign Key)
- status_code (integer)
- response_time (integer, milliseconds)
- is_up (boolean)
- error_message (string, nullable)
- checked_at (timestamp)
- created_at (timestamp)

**alerts**
- id (UUID, Primary Key)
- website_id (Foreign Key)
- type (enum: 'down', 'slow', 'ssl_expiring')
- status (enum: 'active', 'resolved', 'acknowledged')
- message (string)
- triggered_at (timestamp)
- resolved_at (timestamp, nullable)
- created_at (timestamp)

**users** (if multi-user)
- id (UUID, Primary Key)
- email (string, unique)
- password_hash (string)
- role (enum: 'admin', 'user')
- created_at (timestamp)

**alert_channels**
- id (UUID, Primary Key)
- user_id (Foreign Key)
- type (enum: 'email', 'slack', 'webhook')
- config (JSON)
- enabled (boolean)
- created_at (timestamp)

**audit_logs**
- id (UUID, Primary Key)
- user_id (Foreign Key)
- action (string)
- resource (string)
- old_value (JSON, nullable)
- new_value (JSON, nullable)
- ip_address (string)
- user_agent (string)
- created_at (timestamp)

---

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user
- `POST /api/auth/refresh` - Refresh access token

### Websites
- `GET /api/websites` - List all websites
- `POST /api/websites` - Create new website
- `GET /api/websites/:id` - Get website details
- `PUT /api/websites/:id` - Update website
- `DELETE /api/websites/:id` - Delete website

### Check Results
- `GET /api/websites/:id/checks` - Get check history for website
- `GET /api/websites/:id/stats` - Get uptime stats
- `POST /api/websites/:id/check` - Trigger manual check

### Alerts
- `GET /api/alerts` - List alerts
- `GET /api/alerts/:id` - Get alert details
- `PUT /api/alerts/:id` - Update alert status
- `POST /api/alerts/channels` - Configure alert channels

### WebSocket Events
- `website-status-changed` - Real-time status updates
- `check-completed` - New check result

---

## Frontend Pages & Components

### Pages
1. **Dashboard** - Overview of all websites, current status
2. **Website Detail** - Historical data, charts, check results
3. **Alerts** - Alert history and management
4. **Settings** - Website configuration, alert channels, user settings
5. **Reports** - Uptime reports, SLA tracking

### Components
- StatusBadge (online/offline indicator)
- UptimeChart (line chart of uptime %)
- ResponseTimeChart (response time trends)
- AlertsList (recent alerts)
- WebsiteForm (add/edit website)

---

## Monitoring Service (Background Worker)

### Responsibilities
- Periodically check websites at configured intervals
- Record check results to database
- Detect state changes (up → down, down → up)
- Trigger alerts when state changes
- Clean up old data (retention policy)

### Check Logic
```
For each enabled website:
  1. Make HTTP/HTTPS request with timeout
  2. Record response time, status code
  3. Determine if up/down based on status code
  4. Compare with last known state
  5. If changed: create alert, notify user
  6. Store result in database
  7. Emit WebSocket event to connected clients
```

---

## Development Phases & Timeline

### Phase 1: Foundation (Week 1-2)
- [ ] Project setup (Node.js, Express, React)
- [ ] Database schema & migrations
- [ ] Basic authentication
- [ ] Website CRUD API
- [ ] Simple dashboard UI

### Phase 2: Core Monitoring (Week 2-3)
- [ ] Monitoring service setup
- [ ] Check results storage
- [ ] Real-time WebSocket updates
- [ ] Check history page
- [ ] Uptime statistics

### Phase 3: Alerts & Polish (Week 3-4)
- [ ] Alert system setup
- [ ] Email notifications
- [ ] Alert management UI
- [ ] Error handling & validation
- [ ] Basic testing

### Phase 4: Deployment & Documentation
- [ ] Docker setup
- [ ] Deployment guide
- [ ] API documentation
- [ ] User guide

---

## Best Practices & Implementation

### Code Quality
- **TypeScript**: Use strict mode for type safety
  ```
  "strict": true,
  "noImplicitAny": true,
  "strictNullChecks": true
  ```
- **ESLint & Prettier**: Consistent code formatting
- **Git Hooks**: Pre-commit hooks to run linting and tests
- **Error Handling**: Centralized error handling middleware
- **Logging**: Structured logging with Winston or Pino
- **Unit & Integration Tests**: Jest for backend, Vitest for frontend

### API Design
- **RESTful Principles**: Proper HTTP methods (GET, POST, PUT, DELETE)
- **Versioning**: API versioning (/api/v1/...)
- **Pagination**: Limit results with pagination for large datasets
- **Consistent Responses**: Standard response format with status, data, errors
  ```json
  {
    "success": true,
    "data": {},
    "error": null,
    "meta": { "timestamp": "...", "requestId": "..." }
  }
  ```
- **Proper HTTP Status Codes**: 200, 201, 400, 401, 403, 404, 500, etc.

### Database Best Practices
- **Migrations**: Use Knex or TypeORM for schema versioning
- **Connection Pooling**: PgBouncer or native pool (max 20 connections)
- **Indexes**: Create indexes on frequently queried columns (website_id, checked_at)
- **Constraints**: Foreign keys, unique constraints, not null validations
- **Query Optimization**: Avoid N+1 queries, use JOIN instead of separate queries
- **Backups**: Automated daily backups to S3/cloud storage

### Monitoring & Observability
- **Application Metrics**: Track check frequency, success rate, response times
- **Health Checks**: `/health` endpoint for Docker/Kubernetes
- **Structured Logging**: JSON logs with correlation IDs for tracing requests
- **Error Tracking**: Sentry or similar for exception monitoring
- **Performance Monitoring**: New Relic or Datadog for APM
- **Database Monitoring**: Query performance, connection pool usage

### Frontend Best Practices
- **Component Structure**: Atomic design pattern (atoms, molecules, organisms)
- **State Management**: React Context API or Zustand for global state
- **Performance**: Code splitting, lazy loading components
- **Accessibility**: ARIA labels, semantic HTML, keyboard navigation
- **Responsive Design**: Mobile-first approach with TailwindCSS
- **Error Boundaries**: Graceful error handling in React

---

## Comprehensive Security Specifications

### Authentication & Authorization
- **JWT Tokens**: Access tokens (15 min expiry) + Refresh tokens (7 days)
  ```typescript
  // Example: JWT payload
  {
    "sub": "user_id",
    "email": "user@example.com",
    "role": "admin",
    "iat": 1234567890,
    "exp": 1234568490
  }
  ```
- **Secure Token Storage**: HTTP-only cookies for tokens (not localStorage)
- **RBAC**: Role-Based Access Control (admin, user, viewer roles)
- **API Key Authentication**: For internal services and integrations
- **Session Management**: 30-minute inactivity timeout

### Data Protection
- **Encryption at Rest**: Encrypt sensitive data (passwords, API keys) in database
  - Use bcrypt for password hashing (12+ salt rounds)
  - Encrypt API keys before storing: AES-256-GCM
- **Encryption in Transit**: TLS 1.3 enforced
- **Database**: Store only hashed passwords, never plaintext
- **Secrets Management**: Use environment variables for secrets
  ```bash
  DB_PASSWORD=***
  JWT_SECRET=***
  REDIS_PASSWORD=***
  API_KEYS=***
  ```

### API Security
- **Rate Limiting**: Implement per-IP and per-user limits
  ```typescript
  // Example: 100 requests per 15 minutes per IP
  express-rate-limit: {
    windowMs: 15 * 60 * 1000,
    max: 100
  }
  ```
- **CORS**: Restrictive CORS policy
  ```typescript
  cors: {
    origin: process.env.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
  ```
- **CSRF Protection**: Token-based CSRF protection or SameSite cookies
- **Input Validation**: Strict validation using Zod or Joi
  ```typescript
  const WebsiteSchema = z.object({
    name: z.string().min(1).max(255),
    url: z.string().url(),
    check_interval: z.number().min(60).max(3600)
  });
  ```
- **SQL Injection Prevention**: Parameterized queries (pg library handles this)
- **XSS Prevention**: Sanitize user input, use Content Security Policy headers
  ```typescript
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  });
  ```

### Infrastructure Security
- **HTTPS Enforcement**: Redirect HTTP to HTTPS, HSTS headers
  ```typescript
  helmet.hsts({
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  });
  ```
- **Security Headers**:
  ```
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  X-XSS-Protection: 1; mode=block
  Referrer-Policy: strict-origin-when-cross-origin
  ```
- **HTTPS Certificate**: Let's Encrypt (free, auto-renewing)
- **Firewall Rules**: Restrict access to database and Redis from backend only
- **DDoS Protection**: Use Cloudflare or similar service
- **IP Whitelisting**: Optional for database connections

### Monitoring & Audit
- **Audit Logs**: Log all user actions (login, website creation, alert triggers)
  ```typescript
  audit_logs table:
  - id, user_id, action, resource, old_value, new_value, timestamp
  ```
- **Failed Login Attempts**: Track and lock account after 5 failed attempts
- **API Access Logs**: Log all API requests with method, endpoint, status, duration
- **Security Alerts**: Alert on suspicious activities (multiple failed logins, etc.)
- **Dependency Scanning**: Use npm audit, Snyk for vulnerability detection
- **SAST**: Static analysis with SonarQube or similar

### SSL/TLS & Certificates
- **Certificate Provider**: Let's Encrypt
- **Auto-Renewal**: Certbot with auto-renewal every 60 days
- **Cipher Suite**: Modern ciphers only (TLS 1.3)
- **Certificate Pinning**: Optional for critical connections

### Third-Party Integration Security
- **Webhook Validation**: Sign webhooks with HMAC-SHA256
- **External API Keys**: Rotate quarterly, store encrypted
- **OAuth 2.0**: Use for Slack/GitHub integrations
- **Minimal Permissions**: Request only necessary scopes

### Incident Response
- **Breach Notification**: 24-hour incident response protocol
- **Data Retention**: Delete user data within 30 days of account deletion
- **Compliance**: GDPR, CCPA readiness (data export, deletion, privacy)
- **Privacy Policy**: Clear data handling and retention policies

---

## Deployment Options
1. **Self-hosted**: Docker on personal server/VPS
2. **Cloud**: AWS EC2, DigitalOcean, Heroku
3. **Docker Compose**: Single machine with multiple containers

### Minimal Setup
- 1 Node.js app server
- 1 PostgreSQL database
- 1 Redis instance (optional, for caching/queue)
- Nginx reverse proxy

---

## Additional Considerations
- **Data Retention**: Keep check results for 90 days, aggregate older data
- **Performance**: Cache website list, use Redis for frequent queries
- **Scalability**: Design to handle 100+ websites initially
- **Monitoring**: Monitor the monitor itself (uptime of the app)
- **Backup Strategy**: Automated database backups
- **Logging**: Comprehensive logging for debugging

---

## Success Metrics
- ✅ Accurately detect uptime/downtime within 1-1.5 minutes
- ✅ <1s dashboard load time
- ✅ <500ms API response time
- ✅ Real-time alerts within 1 minute of detection
- ✅ 99%+ application uptime

---

## Project Progress Checklist

### Phase 1: Foundation (Week 1-2) - Status: Not Started
- [ ] Initialize Git repository
- [ ] Create backend project structure (Node.js/Express)
- [ ] Create frontend project structure (React/TypeScript)
- [ ] Set up TypeScript configuration (strict mode)
- [ ] Configure ESLint and Prettier
- [ ] Set up environment variables (.env template)
- [ ] Initialize database (PostgreSQL setup)
- [ ] Create database schema and migrations
- [ ] Implement user model and authentication
- [ ] Set up JWT tokens and refresh mechanism
- [ ] Create basic login/logout API endpoints
- [ ] Build login page UI (React)
- [ ] Build dashboard skeleton
- [ ] Implement website CRUD API endpoints
- [ ] Build websites list UI component
- [ ] Build add/edit website form UI
- [ ] Set up API request client (axios)
- [ ] Test authentication flow
- [ ] Document Phase 1 completion

### Phase 2: Core Monitoring (Week 2-3) - Status: Not Started
- [ ] Set up monitoring service (background worker)
- [ ] Implement HTTP/HTTPS check logic
- [ ] Create check scheduler with node-cron
- [ ] Set up database connection pooling
- [ ] Implement check results storage
- [ ] Add response time tracking
- [ ] Implement status change detection
- [ ] Set up Redis for caching
- [ ] Configure Socket.io for WebSocket
- [ ] Implement real-time status updates
- [ ] Create WebSocket event handlers
- [ ] Build real-time status badge component
- [ ] Build check history page UI
- [ ] Implement pagination for results
- [ ] Calculate uptime percentages
- [ ] Build uptime chart component (Recharts)
- [ ] Build response time chart
- [ ] Add data filtering by date range
- [ ] Test monitoring accuracy (1-1.5 min detection)
- [ ] Test WebSocket real-time updates
- [ ] Document Phase 2 completion

### Phase 3: Alerts & Polish (Week 3-4) - Status: Not Started
- [ ] Set up alert system
- [ ] Implement alert creation logic
- [ ] Create alert state detection (down, slow, ssl_expiring)
- [ ] Set up Bull job queue (Redis)
- [ ] Configure email notifications (Nodemailer)
- [ ] Add Slack integration (webhook)
- [ ] Implement alert channels configuration
- [ ] Create alert channels UI form
- [ ] Build alerts page UI
- [ ] Display alert history and status
- [ ] Implement alert acknowledgment
- [ ] Implement alert resolution
- [ ] Add error handling for all endpoints
- [ ] Add input validation (Zod)
- [ ] Implement centralized error handling
- [ ] Add comprehensive logging (Winston/Pino)
- [ ] Set up unit tests (Jest - backend)
- [ ] Set up component tests (Vitest - frontend)
- [ ] Write tests for critical functions
- [ ] Achieve 70%+ code coverage
- [ ] Test alert notifications (email, Slack)
- [ ] Test edge cases (network timeouts, retries)
- [ ] Document Phase 3 completion

### Phase 4: Deployment & Documentation (Week 4) - Status: Not Started
- [ ] Create Dockerfile (backend)
- [ ] Create Dockerfile (frontend - nginx)
- [ ] Set up Docker Compose for full stack
- [ ] Configure environment variables for production
- [ ] Set up SSL/TLS with Let's Encrypt
- [ ] Configure nginx reverse proxy
- [ ] Set up automated backups
- [ ] Configure database backups to S3
- [ ] Set up health checks
- [ ] Configure logging aggregation
- [ ] Write API documentation (Swagger/OpenAPI)
- [ ] Create deployment guide (VPS setup)
- [ ] Write user guide/README
- [ ] Set up monitoring for the application itself
- [ ] Test full deployment on staging
- [ ] Document database schema
- [ ] Create troubleshooting guide
- [ ] Document security setup
- [ ] Deploy to production
- [ ] Verify all features working
- [ ] Document Phase 4 completion

### Additional Tasks - Status: Not Started
- [ ] Set up security headers (Helmet)
- [ ] Implement rate limiting
- [ ] Set up CORS properly
- [ ] Implement audit logging
- [ ] Add database indexing optimization
- [ ] Set up performance monitoring
- [ ] Configure dependency scanning (npm audit)
- [ ] Set up CI/CD pipeline
- [ ] Create pre-commit hooks
- [ ] Document code architecture
- [ ] Set up feature flags for gradual rollout
- [ ] Create incident response runbook
- [ ] Set up monitoring dashboards
- [ ] Test database backup/restore
- [ ] Create user onboarding guide

### Summary Statistics
- **Total Tasks**: 130+
- **Completed**: 0
- **In Progress**: 0
- **Not Started**: 130+
- **Overall Progress**: 0%

### Known Issues & Blockers
- None yet

### Notes & Progress Updates
- **Last Updated**: 2026-05-23
- **Current Status**: Planning phase complete, ready to start Phase 1
- **Next Steps**: Initialize repository and set up project structure
