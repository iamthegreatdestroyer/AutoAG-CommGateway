import dotenv from 'dotenv';
import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { logger } from './utils/logger';
import { config } from './config';
import { db } from './models/repositories';
import { healthRouter } from './api/routes/health';
import authRouter from './api/routes/auth';
import serversRouter from './api/routes/servers';
import toolsRouter from './api/routes/tools';
import usersRouter from './api/routes/users';
import { errorHandler } from './api/middleware/errorHandler';
import { requestLogger } from './api/middleware/requestLogger';

// Load environment variables
dotenv.config();

// Create Express app
const app: Express = express();

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: config.cors.origin,
    credentials: config.cors.credentials,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Routes
app.use('/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/servers', serversRouter);
app.use('/api/tools', toolsRouter);
app.use('/api/users', usersRouter);

// Error handling (must be last)
app.use(errorHandler);

// Start server
const PORT = config.api.port;
const HOST = config.api.host;

const startServer = async () => {
  try {
    // Connect to database
    await db.connect();
    logger.info('✅ Database connected successfully');

    // Check database health
    const dbHealthy = await db.healthCheck();
    if (!dbHealthy) {
      throw new Error('Database health check failed');
    }
    logger.info('✅ Database health check passed');

    app.listen(PORT, HOST, () => {
      logger.info(`🚀 AutoAG-CommGateway API Server running on http://${HOST}:${PORT}`);
      logger.info(`📊 Environment: ${config.nodeEnv}`);
      logger.info(`💾 Database: ${config.database.url.split('@')[1] || 'configured'}`);
      logger.info(`🔴 Redis: ${config.redis.host}:${config.redis.port}`);
      logger.info('');
      logger.info('📡 API Endpoints:');
      logger.info('  - GET  /health');
      logger.info('  - POST /api/auth/register');
      logger.info('  - POST /api/auth/login');
      logger.info('  - POST /api/auth/refresh');
      logger.info('  - GET  /api/servers');
      logger.info('  - GET  /api/tools');
      logger.info('  - GET  /api/users/me');
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Only start server if running directly (not during tests)
if (require.main === module) {
  startServer();
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  await db.disconnect();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  process.exit(0);
});

export default app;
