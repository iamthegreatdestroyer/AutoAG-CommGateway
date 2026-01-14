export interface Config {
  nodeEnv: string;
  api: {
    port: number;
    host: string;
  };
  database: {
    url: string;
  };
  redis: {
    url: string;
    host: string;
    port: number;
  };
  jwt: {
    secret: string;
    expiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
    publicMax: number;
    authMax: number;
    premiumMax: number;
  };
  cors: {
    origin: string[];
    credentials: boolean;
  };
  mcp: {
    healthCheckIntervalMs: number;
    timeoutMs: number;
  };
  cache: {
    ttlSeconds: number;
  };
  logLevel: string;
}

export const config: Config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  api: {
    port: parseInt(process.env.API_PORT || '18500', 10),
    host: process.env.API_HOST || '0.0.0.0',
  },
  database: {
    url: process.env.DATABASE_URL || 'postgresql://autoag:autoag_secret@localhost:18510/autoag',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:18520',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '18520', 10),
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'change-this-secret-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'change-this-refresh-secret-too',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    publicMax: parseInt(process.env.RATE_LIMIT_PUBLIC_MAX || '100', 10),
    authMax: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '1000', 10),
    premiumMax: parseInt(process.env.RATE_LIMIT_PREMIUM_MAX || '10000', 10),
  },
  cors: {
    origin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(','),
    credentials: process.env.CORS_CREDENTIALS === 'true',
  },
  mcp: {
    healthCheckIntervalMs: parseInt(process.env.MCP_HEALTH_CHECK_INTERVAL_MS || '300000', 10),
    timeoutMs: parseInt(process.env.MCP_TIMEOUT_MS || '30000', 10),
  },
  cache: {
    ttlSeconds: parseInt(process.env.CACHE_TTL_SECONDS || '3600', 10),
  },
  logLevel: process.env.LOG_LEVEL || 'info',
};
