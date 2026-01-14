import winston from 'winston';
import { config } from '../config';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom log format
const logFormat = printf(({ level, message, timestamp: ts, stack }) => {
  return `${ts} [${level}]: ${stack || message}`;
});

// Create transports array
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: combine(colorize(), logFormat),
  }),
];

// Only add file transports in non-Docker/non-production environments
if (config.nodeEnv !== 'production') {
  try {
    transports.push(
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
      }),
      new winston.transports.File({
        filename: 'logs/combined.log',
      })
    );
  } catch (error) {
    // Ignore file transport errors (e.g., in Docker without writable filesystem)
  }
}

// Create logger
export const logger = winston.createLogger({
  level: config.logLevel,
  format: combine(errors({ stack: true }), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
  transports,
});

// If not in production, log to console with more details
if (config.nodeEnv !== 'production') {
  logger.debug('Logger initialized in development mode');
}
