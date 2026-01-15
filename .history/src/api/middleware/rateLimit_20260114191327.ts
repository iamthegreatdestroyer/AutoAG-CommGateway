import rateLimit from 'express-rate-limit';
import { Request } from 'express';

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiter for authentication endpoints
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per window
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many authentication attempts, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
});

// Rate limiter for tool invocations (per user)
export const invocationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Tool invocation rate limit exceeded',
  },
  keyGenerator: (req: Request) => {
    // Rate limit by user ID if authenticated, otherwise by IP
    return req.user?.userId || req.ip || 'unknown';
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for server registration
export const createServerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 server registrations per hour
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Server registration rate limit exceeded',
  },
  keyGenerator: (req: Request) => {
    return req.user?.userId || req.ip || 'unknown';
  },
  standardHeaders: true,
  legacyHeaders: false,
});
