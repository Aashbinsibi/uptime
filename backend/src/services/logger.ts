import dotenv from 'dotenv';

dotenv.config();

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

const log = (level: LogLevel, message: string, meta?: Record<string, any>) => {
  const timestamp = new Date().toISOString();
  
  if (process.env.NODE_ENV === 'production') {
    // Structured JSON logging in production (standard for cloud logs aggregators)
    console.log(JSON.stringify({
      timestamp,
      level,
      message,
      ...meta
    }));
  } else {
    // Beautiful colored log output for easy local development reading
    let color = '\x1b[37m'; // White
    if (level === 'WARN') color = '\x1b[33m'; // Yellow
    if (level === 'ERROR') color = '\x1b[31m'; // Red
    
    const metaString = meta ? ` | Meta: ${JSON.stringify(meta)}` : '';
    console.log(`${color}[${timestamp}] [${level}]\x1b[0m ${message}${metaString}`);
  }
};

export const logger = {
  info: (message: string, meta?: Record<string, any>) => log('INFO', message, meta),
  warn: (message: string, meta?: Record<string, any>) => log('WARN', message, meta),
  error: (message: string, meta?: Record<string, any>) => log('ERROR', message, meta)
};

export default logger;
