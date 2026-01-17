/**
 * Unit Test Mocks - Rate Limiter Service
 * Mock implementations for testing rate limiting functionality
 */

import { RateLimiterService } from '../../src/services/rate-limiter.service';

/**
 * Test Suite: Rate Limiter Service
 */
describe('RateLimiterService', () => {
  let rateLimiter: RateLimiterService;

  beforeEach(() => {
    rateLimiter = RateLimiterService.getInstance();
    rateLimiter.clear(); // Clear state before each test
  });

  describe('Token Bucket Algorithm', () => {
    describe('Server Rate Limiting', () => {
      it('should allow requests within rate limit', () => {
        const serverId = 'test-server-1';

        // Set up limit: 10 requests per second
        rateLimiter.setServerLimit(serverId, { requestsPerSecond: 10 });

        // Should allow 10 requests
        for (let i = 0; i < 10; i++) {
          expect(rateLimiter.allowRequest(serverId)).toBe(true);
        }

        // 11th request should be denied
        expect(rateLimiter.allowRequest(serverId)).toBe(false);
      });

      it('should refill tokens over time', (done) => {
        const serverId = 'test-server-1';

        // Set up limit: 5 requests per second
        rateLimiter.setServerLimit(serverId, { requestsPerSecond: 5 });

        // Consume all tokens
        for (let i = 0; i < 5; i++) {
          rateLimiter.allowRequest(serverId);
        }

        // Next request should be denied
        expect(rateLimiter.allowRequest(serverId)).toBe(false);

        // Wait for tokens to refill
        setTimeout(() => {
          // After ~200ms, at least 1 token should be refilled
          expect(rateLimiter.allowRequest(serverId)).toBe(true);
          done();
        }, 250);
      });

      it('should respect burst capacity', () => {
        const serverId = 'test-server-1';

        // Set up limit: 5 requests/sec with burst of 10
        rateLimiter.setServerLimit(serverId, {
          requestsPerSecond: 5,
          burstSize: 10,
        });

        // Should allow 10 burst requests
        for (let i = 0; i < 10; i++) {
          expect(rateLimiter.allowRequest(serverId)).toBe(true);
        }

        // 11th should be denied
        expect(rateLimiter.allowRequest(serverId)).toBe(false);
      });
    });

    describe('User Rate Limiting', () => {
      it('should limit by user within server limit', () => {
        const serverId = 'test-server-1';
        const userId = 'user-1';

        // Set up limits
        rateLimiter.setServerLimit(serverId, { requestsPerSecond: 100 });
        rateLimiter.setUserLimit(userId, { requestsPerSecond: 5 });

        // Allow 5 requests for user
        for (let i = 0; i < 5; i++) {
          expect(rateLimiter.allowRequest(serverId, userId)).toBe(true);
        }

        // Should hit user limit before server limit
        expect(rateLimiter.allowRequest(serverId, userId)).toBe(false);
      });

      it('should enforce stricter user limit when set', () => {
        const serverId = 'test-server-1';
        const userId = 'vip-user';

        rateLimiter.setServerLimit(serverId, { requestsPerSecond: 10 });
        rateLimiter.setUserLimit(userId, { requestsPerSecond: 20 }); // More permissive

        // User limit is used, allowing more requests than server default
        for (let i = 0; i < 10; i++) {
          expect(rateLimiter.allowRequest(serverId, userId)).toBe(true);
        }

        // Can make one more due to higher user limit
        expect(rateLimiter.allowRequest(serverId, userId)).toBe(true);
      });
    });

    describe('Tool-Level Rate Limiting', () => {
      it('should apply tool-specific limits', () => {
        const serverId = 'test-server-1';
        const toolId = 'expensive-tool';

        // Set up tool-specific limit
        rateLimiter.setToolLimit(serverId, toolId, { requestsPerSecond: 2 });

        // Allow 2 requests for this tool
        for (let i = 0; i < 2; i++) {
          expect(rateLimiter.allowRequest(serverId, undefined, toolId)).toBe(true);
        }

        // Third should be denied
        expect(rateLimiter.allowRequest(serverId, undefined, toolId)).toBe(false);
      });

      it('should enforce most restrictive limit among all levels', () => {
        const serverId = 'test-server-1';
        const userId = 'user-1';
        const toolId = 'limited-tool';

        // Server: 10/sec, User: 5/sec, Tool: 2/sec
        rateLimiter.setServerLimit(serverId, { requestsPerSecond: 10 });
        rateLimiter.setUserLimit(userId, { requestsPerSecond: 5 });
        rateLimiter.setToolLimit(serverId, toolId, { requestsPerSecond: 2 });

        // Most restrictive is 2/sec
        for (let i = 0; i < 2; i++) {
          expect(rateLimiter.allowRequest(serverId, userId, toolId)).toBe(true);
        }

        expect(rateLimiter.allowRequest(serverId, userId, toolId)).toBe(false);
      });
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should track request statistics', () => {
      const serverId = 'test-server-1';

      rateLimiter.setServerLimit(serverId, { requestsPerSecond: 10 });

      // Make some requests
      for (let i = 0; i < 5; i++) {
        rateLimiter.allowRequest(serverId);
      }

      const stats = rateLimiter.getStats();

      expect(stats.totalRequests).toBe(5);
      expect(stats.rejectedRequests).toBe(0);
      expect(stats.servers).toContain(serverId);
    });

    it('should track rejected requests', () => {
      const serverId = 'test-server-1';

      rateLimiter.setServerLimit(serverId, { requestsPerSecond: 3 });

      // Consume all tokens
      for (let i = 0; i < 3; i++) {
        rateLimiter.allowRequest(serverId);
      }

      // Try to exceed limit
      rateLimiter.allowRequest(serverId);
      rateLimiter.allowRequest(serverId);

      const stats = rateLimiter.getStats();

      expect(stats.totalRequests).toBe(5);
      expect(stats.rejectedRequests).toBe(2);
    });

    it('should provide per-server statistics', () => {
      const serverId1 = 'server-1';
      const serverId2 = 'server-2';

      rateLimiter.setServerLimit(serverId1, { requestsPerSecond: 10 });
      rateLimiter.setServerLimit(serverId2, { requestsPerSecond: 5 });

      // Make requests
      for (let i = 0; i < 8; i++) {
        rateLimiter.allowRequest(serverId1);
      }

      for (let i = 0; i < 3; i++) {
        rateLimiter.allowRequest(serverId2);
      }

      const server1Stats = rateLimiter.getServerStats(serverId1);
      const server2Stats = rateLimiter.getServerStats(serverId2);

      expect(server1Stats?.totalRequests).toBe(8);
      expect(server2Stats?.totalRequests).toBe(3);
    });
  });

  describe('Error Handling', () => {
    it('should handle undefined servers gracefully', () => {
      expect(rateLimiter.allowRequest('non-existent-server')).toBe(true);
    });

    it('should handle concurrent requests correctly', async () => {
      const serverId = 'test-server-1';
      rateLimiter.setServerLimit(serverId, { requestsPerSecond: 10, burstSize: 10 });

      const promises = Array.from({ length: 15 }, () =>
        Promise.resolve(rateLimiter.allowRequest(serverId))
      );

      const results = await Promise.all(promises);
      const allowedCount = results.filter((r) => r).length;

      expect(allowedCount).toBe(10); // Only 10 should be allowed
    });
  });
});
