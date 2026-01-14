import dotenv from 'dotenv';
import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { logger } from './utils/logger';
import { config } from './config';
import { healthRouter } from './api/routes/health';
import { errorHandler } from './api/middleware/errorHandler';
import { requestLogger } from './api/middleware/requestLogger';

// Load environment variables
dotenv.config();

// Create Express app
const app: Express = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: config.cors.origin,
  credentials: config.cors.credentials,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Routes
app.use('/health', healthRouter);

// Error handling (must be last)
app.use(errorHandler);

// Start server
const PORT = config.api.port;
const HOST = config.api.host;

app.listen(PORT, HOST, () => {
  logger.info(`🚀 AutoAG-CommGateway API Server running on http://${HOST}:${PORT}`);
  logger.info(`📊 Environment: ${config.nodeEnv}`);
  logger.info(`💾 Database: ${config.database.url.split('@')[1] || 'configured'}`);
  logger.info(`🔴 Redis: ${config.redis.host}:${config.redis.port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  process.exit(0);
});

export default app;
