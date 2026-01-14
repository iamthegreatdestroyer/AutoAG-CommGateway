import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { config } from '../../config';

const router = Router();
const prisma = new PrismaClient();
const redis = new Redis(config.redis.url);

router.get('/', async (req: Request, res: Response) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.nodeEnv,
    services: {
      api: 'healthy',
      database: 'unknown',
      redis: 'unknown',
    },
  };

  try {
    // Check database connectivity
    await prisma.$queryRaw`SELECT 1`;
    health.services.database = 'healthy';
  } catch (error) {
    health.services.database = 'unhealthy';
    health.status = 'degraded';
  }

  try {
    // Check Redis connectivity
    await redis.ping();
    health.services.redis = 'healthy';
  } catch (error) {
    health.services.redis = 'unhealthy';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

export { router as healthRouter };
