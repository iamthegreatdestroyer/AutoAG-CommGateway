/**
 * Rate Limiter Service
 * In-memory rate limiting with sliding window algorithm
 * Supports both per-tool and per-server rate limiting
 */

import { logger, Logger } from '../utils/logger';

/**
 * Rate limit configuration
 */
interface RateLimitConfig {
  maxRequests: number;
  windowMs: number; // Time window in milliseconds
  keyPrefix?: string;
}

/**
 * Rate limit entry
 */
interface RateLimitEntry {
  timestamps: number[]; // Array of request timestamps
  lastChecked: number;
}

/**
 * Rate Limiter Service
 * Implements token bucket and sliding window algorithms
 */
export class RateLimiterService {
  private static instance: RateLimiterService;
  private limits: Map<string, RateLimitEntry> = new Map();
  private configs: Map<string, RateLimitConfig> = new Map();
  private logger: Logger;

  // Default configurations
  private defaultToolLimit: RateLimitConfig = {
    maxRequests: 100,
    windowMs: 60000, // 1 minute
  };

  private defaultServerLimit: RateLimitConfig = {
    maxRequests: 1000,
    windowMs: 60000, // 1 minute
  };

  private constructor() {
    this.logger = logger;
    this.setupDefaultLimits();
    this.startCleanupInterval();
  }

  /**
   * Get or create singleton instance
   */
  static getInstance(): RateLimiterService {
    if (!RateLimiterService.instance) {
      RateLimiterService.instance = new RateLimiterService();
    }
    return RateLimiterService.instance;
  }

  /**
   * Setup default rate limit configurations
   */
  private setupDefaultLimits(): void {
    // Tool-level defaults (per tool)
    this.configs.set('tool:default', this.defaultToolLimit);

    // Server-level defaults (per server)
    this.configs.set('server:default', this.defaultServerLimit);

    // Tool-specific overrides
    this.configs.set('tool:openai_chat_completion', {
      maxRequests: 60,
      windowMs: 60000, // More restrictive for expensive operations
    });

    this.configs.set('tool:aws_ec2_launch', {
      maxRequests: 10,
      windowMs: 300000, // 5 minutes - expensive operation
    });

    this.configs.set('tool:ml_inference', {
      maxRequests: 50,
      windowMs: 60000,
    });

    // Server-specific overrides
    this.configs.set('server:openai-server', {
      maxRequests: 200,
      windowMs: 60000,
    });

    this.configs.set('server:aws-server', {
      maxRequests: 500,
      windowMs: 60000,
    });
  }

  /**
   * Check if request is within rate limit
   * Returns: { allowed: boolean, remaining: number, resetTime: number }
   */
  checkLimit(
    key: string,
    configKey?: string
  ): {
    allowed: boolean;
    remaining: number;
    resetTime: number;
    retryAfter?: number;
  } {
    const config = this.getConfig(configKey || 'tool:default');
    const now = Date.now();

    // Get or create entry
    let entry = this.limits.get(key);
    if (!entry) {
      entry = {
        timestamps: [],
        lastChecked: now,
      };
      this.limits.set(key, entry);
    }

    // Remove old timestamps outside the window
    const windowStart = now - config.windowMs;
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
    entry.lastChecked = now;

    // Check if limit exceeded
    const isAllowed = entry.timestamps.length < config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - entry.timestamps.length - 1);

    if (isAllowed) {
      // Record this request
      entry.timestamps.push(now);
    }

    // Calculate reset time (when oldest timestamp expires)
    let resetTime = now + config.windowMs;
    if (entry.timestamps.length > 0) {
      const oldestTs = entry.timestamps[0];
      resetTime = oldestTs + config.windowMs;
    }

    return {
      allowed: isAllowed,
      remaining: Math.max(0, remaining),
      resetTime,
      retryAfter: isAllowed ? undefined : Math.ceil((resetTime - now) / 1000),
    };
  }

  /**
   * Check rate limit for a tool invocation
   */
  checkToolLimit(toolId: string): {
    allowed: boolean;
    remaining: number;
    resetTime: number;
    retryAfter?: number;
  } {
    return this.checkLimit(`tool:${toolId}`, `tool:${toolId}`);
  }

  /**
   * Check rate limit for a server
   */
  checkServerLimit(serverId: string): {
    allowed: boolean;
    remaining: number;
    resetTime: number;
    retryAfter?: number;
  } {
    return this.checkLimit(`server:${serverId}`, `server:${serverId}`);
  }

  /**
   * Check rate limit for combined server + tool
   */
  checkCombinedLimit(
    serverId: string,
    toolId: string
  ): {
    allowed: boolean;
    remaining: number;
    resetTime: number;
    retryAfter?: number;
  } {
    const serverLimit = this.checkServerLimit(serverId);
    const toolLimit = this.checkToolLimit(toolId);

    // Both must allow
    if (!serverLimit.allowed || !toolLimit.allowed) {
      return {
        allowed: false,
        remaining: Math.min(serverLimit.remaining, toolLimit.remaining),
        resetTime: Math.max(serverLimit.resetTime, toolLimit.resetTime),
        retryAfter: Math.max(serverLimit.retryAfter || 0, toolLimit.retryAfter || 0),
      };
    }

    return {
      allowed: true,
      remaining: Math.min(serverLimit.remaining, toolLimit.remaining),
      resetTime: Math.max(serverLimit.resetTime, toolLimit.resetTime),
    };
  }

  /**
   * Set custom rate limit configuration
   */
  setConfig(key: string, config: RateLimitConfig): void {
    this.configs.set(key, config);
    this.logger.info(`[Rate Limiter] Updated config for ${key}`, config);
  }

  /**
   * Get configuration
   */
  private getConfig(key: string): RateLimitConfig {
    return this.configs.get(key) || this.defaultToolLimit;
  }

  /**
   * Reset rate limit for key
   */
  reset(key: string): void {
    this.limits.delete(key);
    this.logger.debug(`[Rate Limiter] Reset limits for ${key}`);
  }

  /**
   * Reset all rate limits
   */
  resetAll(): void {
    this.limits.clear();
    this.logger.debug('[Rate Limiter] Reset all rate limits');
  }

  /**
   * Get current statistics
   */
  getStats(): {
    totalKeys: number;
    configs: number;
    entries: Array<{
      key: string;
      requests: number;
      lastChecked: Date;
    }>;
  } {
    const entries = Array.from(this.limits.entries()).map(([key, entry]) => ({
      key,
      requests: entry.timestamps.length,
      lastChecked: new Date(entry.lastChecked),
    }));

    return {
      totalKeys: this.limits.size,
      configs: this.configs.size,
      entries,
    };
  }

  /**
   * Cleanup old entries periodically
   */
  private startCleanupInterval(): void {
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      for (const [key, entry] of this.limits.entries()) {
        // Remove entries that haven't been checked in 24 hours
        if (now - entry.lastChecked > 86400000) {
          this.limits.delete(key);
          cleaned++;
        } else {
          // Clean old timestamps
          const windowStart = now - 3600000; // 1 hour - clean aggressive
          entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
        }
      }

      if (cleaned > 0) {
        this.logger.debug(`[Rate Limiter] Cleaned ${cleaned} inactive entries`);
      }
    }, 600000); // Run every 10 minutes
  }
}

export const rateLimiterService = RateLimiterService.getInstance();
