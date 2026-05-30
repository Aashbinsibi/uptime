import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import rateLimit from 'express-rate-limit';
import { initDb } from './db/init';
import { initSocket } from './services/socket';
import { startMonitoring } from './services/monitor';
import { initNotificationWorker } from './services/notifier';
import logger from './services/logger';

import authRouter from './routes/auth';
import websitesRouter from './routes/websites';
import settingsRouter from './routes/settings';
import alertsRouter from './routes/alerts';
import publicRouter from './routes/public';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server for Express and Socket.io
const httpServer = createServer(app);

// Initialize Socket.io
initSocket(httpServer);

// 1. Rate Limiting Configurations (Security Best Practice)
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120, // 120 requests per minute max per IP
  message: {
    success: false,
    error: 'Too many requests. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes window
  max: 20, // Limit each IP to 20 auth requests per 15 mins
  message: {
    success: false,
    error: 'Too many login or registration attempts. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Security and utility middleware
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Apply global rate limiting to all standard APIs
app.use('/api', generalLimiter);

// Apply strict rate limiting to auth routes
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// API Route Registration
app.use('/api/auth', authRouter);
app.use('/api/websites', websitesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/public', publicRouter);

// Root path handler
app.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Uptime Monitor API Service Active'
  });
});

// Centralized error handling middleware (Logs using custom logger)
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('[Global Error Handler]', { error: err.message, stack: err.stack });
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

// Initialize database, queue worker, and start server
const bootstrap = async () => {
  try {
    // 1. Initialize schema and database connection
    await initDb();

    // 2. Initialize Redis-backed Bull background notification queue consumer
    initNotificationWorker();

    // 3. Start monitoring background tasks
    startMonitoring();

    // 4. Listen on HTTP port
    httpServer.listen(PORT, () => {
      logger.info(`[Server] Core service running on port ${PORT}`);
      logger.info('[Server] Database, WebSocket, and Bull Workers initialized.');
    });
  } catch (error: any) {
    logger.error('[Bootstrap Failed] Fatal error during startup:', { error: error.message });
    process.exit(1);
  }
};

bootstrap();
