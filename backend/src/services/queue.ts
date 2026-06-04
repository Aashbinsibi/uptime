import Queue from 'bull';
import dotenv from 'dotenv';
import logger from './logger';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Initialize Bull queue for alert notifications
export const notificationQueue = new Queue('alert-notifications', REDIS_URL, {
  defaultJobOptions: {
    attempts: 3, // Retry up to 3 times on network failure
    backoff: {
      type: 'exponential',
      delay: 5000 // Initial backoff delay (5s)
    },
    removeOnComplete: true, // Clean up successful jobs to save memory
    removeOnFail: false // Keep failed jobs for logging/debugging
  }
});

notificationQueue.on('error', (error) => {
  logger.error('[Bull Queue] Connection error occurred:', { error: error.message });
});

notificationQueue.on('failed', (job, err) => {
  logger.error(`[Bull Queue] Job #${job.id} failed after attempts:`, {
    jobName: job.name,
    error: err.message,
    data: job.data
  });
});

notificationQueue.on('completed', (job) => {
  if (process.env.NODE_ENV === 'development') {
    logger.info(`[Bull Queue] Job #${job.id} completed successfully.`);
  }
});

// Worker handler: will be registered dynamically to prevent circular dependencies
export const registerQueueProcessor = (name: string, processor: (job: Queue.Job) => Promise<void>) => {
  logger.info(`[Bull Queue] Registering background consumer worker process for job type: ${name}...`);
  notificationQueue.process(name, async (job) => {
    try {
      await processor(job);
    } catch (error: any) {
      logger.error(`[Bull Queue] Process failure in worker on job #${job.id} (${name}):`, { error: error.message });
      throw error; // Propagate error so Bull schedules retry backoff
    }
  });
};
