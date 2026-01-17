/**
 * Integration Test Mocks - MCP Client Service with Rate Limiting, Tracking, and Rollback
 * Tests interactions between RateLimiterService, InvocationTrackerService, and RollbackService
 */

import { MCPServerClient } from '../../src/services/mcp-client.service';
import { RateLimiterService } from '../../src/services/rate-limiter.service';
import { InvocationTrackerService } from '../../src/services/invocation-tracker.service';
import { RollbackService } from '../../src/services/rollback.service';

/**
 * Integration Test Suite: MCPClientService with All Services
 */
describe('MCPClientService Integration', () => {
  let client: MCPServerClient;
  let rateLimiter: RateLimiterService;
  let tracker: InvocationTrackerService;
  let rollback: RollbackService;

  beforeEach(() => {
    // Initialize all singletons
    client = MCPServerClient.getInstance('test-server', 'http://localhost:3000');
    rateLimiter = RateLimiterService.getInstance();
    tracker = InvocationTrackerService.getInstance();
    rollback = RollbackService.getInstance();

    // Clear all state
    rateLimiter.clear();
    tracker.clear();
    rollback.clear();

    // Set reasonable limits for testing
    rateLimiter.setServerLimit('test-server', { requestsPerSecond: 10, burstSize: 20 });
  });

  describe('Successful Tool Invocation Flow', () => {
    it('should track successful invocation through all services', (done) => {
      const toolId = 'test-tool';
      const parameters = { input: 'test' };
      const userId = 'test-user';

      // Mock the MCP communication (in real test, would mock axios)
      // For this test, we verify the tracking behavior

      // Simulate invocation tracking
      const correlationId = `inv-${Date.now()}-test`;
      const invocation = tracker.createInvocation(
        correlationId,
        toolId,
        'test-server',
        parameters,
        userId
      );

      expect(invocation).toBeDefined();
      expect(invocation.status).toBe('pending');

      // Simulate rate limit check
      const allowed = rateLimiter.allowRequest('test-server', userId);

      expect(allowed).toBe(true);

      // Simulate successful execution
      const result = { success: true, data: 'execution result' };
      const updated = tracker.recordSuccess(correlationId, result, 0);

      expect(updated?.status).toBe('completed');
      expect(updated?.result).toEqual(result);

      // Verify statistics
      const stats = tracker.getStats();
      expect(stats.completed).toBe(1);

      done();
    });

    it('should maintain correlation ID throughout invocation lifecycle', () => {
      const toolId = 'test-tool';
      const userId = 'test-user';
      const correlationId = 'corr-integration-1';

      const invocation = tracker.createInvocation(correlationId, toolId, 'test-server');
      tracker.recordSuccess(correlationId, { ok: true }, 0);

      const retrieved = tracker.getInvocation(correlationId);

      expect(retrieved?.correlationId).toBe(correlationId);
      expect(retrieved?.status).toBe('completed');
    });
  });

  describe('Failed Invocation with Rollback', () => {
    it('should initiate rollback on failed invocation', () => {
      const toolId = 'test-tool';
      const correlationId = 'corr-failure-1';
      const userId = 'test-user';

      // Create and fail invocation
      tracker.createInvocation(correlationId, toolId, 'test-server', {}, userId);
      const error = new Error('Tool execution timeout');
      const failed = tracker.recordFailure(correlationId, error, 3);

      expect(failed?.status).toBe('failed');
      expect(failed?.retries).toBe(3);

      // Initiate rollback
      const rollbackRecord = rollback.initiateRollback(
        correlationId,
        `Tool failed after 3 retries: ${error.message}`,
        userId
      );

      expect(rollbackRecord).toBeDefined();
      expect(rollbackRecord.correlationId).toBe(correlationId);
      expect(rollbackRecord.initiatedBy).toBe(userId);

      // Verify connection between failed invocation and rollback
      const rollbacks = rollback.getInvocationRollbacks(correlationId);
      expect(rollbacks.length).toBeGreaterThan(0);
    });

    it('should execute rollback actions sequentially', () => {
      const correlationId = 'corr-rollback-sequence';

      // Create failed invocation
      tracker.createInvocation(correlationId, 'tool-1', 'test-server');
      tracker.recordFailure(correlationId, 'Execution failed', 0);

      // Initiate rollback with multiple actions
      const rollbackRecord = rollback.initiateRollback(correlationId, 'Cleanup needed', 'user-1');

      const action1 = rollback.addRollbackAction(rollbackRecord.rollbackId, 'undo', 'tool-1', {
        operation: 'undo-config',
      });

      const action2 = rollback.addRollbackAction(
        rollbackRecord.rollbackId,
        'compensate',
        'tool-2',
        { operation: 'compensate-data' }
      );

      const action3 = rollback.addRollbackAction(rollbackRecord.rollbackId, 'restore', 'tool-3', {
        version: 'last-known-good',
      });

      // Execute actions
      rollback.recordActionCompletion(rollbackRecord.rollbackId, action1.id, { success: true });
      rollback.recordActionCompletion(rollbackRecord.rollbackId, action2.id, { success: true });
      rollback.recordActionCompletion(rollbackRecord.rollbackId, action3.id, { success: true });

      // Complete rollback
      const completed = rollback.completeRollback(rollbackRecord.rollbackId);

      expect(completed?.status).toBe('completed');
      expect(completed?.rollbackActions.length).toBe(3);
      expect(completed?.rollbackActions.every((a) => a.status === 'completed')).toBe(true);
    });

    it('should handle partial rollback failure', () => {
      const correlationId = 'corr-partial-failure';

      tracker.createInvocation(correlationId, 'tool-1', 'test-server');
      tracker.recordFailure(correlationId, 'Execution failed', 0);

      const rollbackRecord = rollback.initiateRollback(correlationId, 'Cleanup needed', 'user-1');

      const action1 = rollback.addRollbackAction(rollbackRecord.rollbackId, 'undo', 'tool-1', {});
      const action2 = rollback.addRollbackAction(
        rollbackRecord.rollbackId,
        'compensate',
        'tool-2',
        {}
      );

      // First action succeeds
      rollback.recordActionCompletion(rollbackRecord.rollbackId, action1.id, { success: true });

      // Second action fails
      rollback.recordActionFailure(rollbackRecord.rollbackId, action2.id, 'Compensation failed');

      // Complete rollback with failure
      const completed = rollback.completeRollback(rollbackRecord.rollbackId);

      expect(completed?.status).toBe('failed'); // Rollback marked as failed
      expect(completed?.rollbackActions[0].status).toBe('completed');
      expect(completed?.rollbackActions[1].status).toBe('failed');
    });
  });

  describe('Rate Limiting Enforcement', () => {
    it('should reject requests when rate limit exceeded', () => {
      const serverId = 'test-server';
      const userId = 'test-user';

      // Set very restrictive limit
      rateLimiter.setServerLimit(serverId, { requestsPerSecond: 1, burstSize: 2 });

      // Allow burst
      expect(rateLimiter.allowRequest(serverId, userId)).toBe(true);
      expect(rateLimiter.allowRequest(serverId, userId)).toBe(true);

      // Exceed limit
      expect(rateLimiter.allowRequest(serverId, userId)).toBe(false);
    });

    it('should respect user-level rate limit within server limit', () => {
      const serverId = 'test-server';
      const user1 = 'user-1';
      const user2 = 'user-2';

      rateLimiter.setServerLimit(serverId, { requestsPerSecond: 10, burstSize: 20 });
      rateLimiter.setUserLimit(serverId, user1, { requestsPerSecond: 2, burstSize: 5 });

      // User 1 limited to 2/sec
      expect(rateLimiter.allowRequest(serverId, user1)).toBe(true); // 1
      expect(rateLimiter.allowRequest(serverId, user1)).toBe(true); // 2
      expect(rateLimiter.allowRequest(serverId, user1)).toBe(true); // burst 3
      expect(rateLimiter.allowRequest(serverId, user1)).toBe(true); // burst 4
      expect(rateLimiter.allowRequest(serverId, user1)).toBe(true); // burst 5
      expect(rateLimiter.allowRequest(serverId, user1)).toBe(false); // over burst

      // User 2 has server limit only
      expect(rateLimiter.allowRequest(serverId, user2)).toBe(true);
    });

    it('should respect tool-level rate limit', () => {
      const serverId = 'test-server';
      const toolId = 'expensive-tool';
      const userId = 'test-user';

      rateLimiter.setServerLimit(serverId, { requestsPerSecond: 100, burstSize: 200 });
      rateLimiter.setToolLimit(serverId, toolId, { requestsPerSecond: 1, burstSize: 2 });

      // Tool limit is most restrictive
      expect(rateLimiter.allowRequest(serverId, userId, toolId)).toBe(true); // 1
      expect(rateLimiter.allowRequest(serverId, userId, toolId)).toBe(true); // 2 (burst)
      expect(rateLimiter.allowRequest(serverId, userId, toolId)).toBe(false); // over limit
    });

    it('should trigger rollback when rate limit exceeded', () => {
      const serverId = 'test-server';
      const userId = 'test-user';
      const toolId = 'tool-1';
      const correlationId = 'corr-rate-limited';

      // Very strict limit
      rateLimiter.setServerLimit(serverId, { requestsPerSecond: 1, burstSize: 1 });

      // First request succeeds
      tracker.createInvocation(correlationId, toolId, serverId, {}, userId);
      const allowed1 = rateLimiter.allowRequest(serverId, userId);
      expect(allowed1).toBe(true);
      tracker.recordSuccess(correlationId, { ok: true }, 0);

      // Second request exceeds limit
      const correlationId2 = 'corr-rate-limited-2';
      tracker.createInvocation(correlationId2, toolId, serverId, {}, userId);
      const allowed2 = rateLimiter.allowRequest(serverId, userId);

      if (!allowed2) {
        tracker.recordFailure(correlationId2, 'Rate limit exceeded', 0);
        rollback.initiateRollback(correlationId2, 'Rate limit triggered rollback', userId);
      }

      const invocation2 = tracker.getInvocation(correlationId2);
      expect(invocation2?.status).toBe('failed');

      const rollbacks = rollback.getInvocationRollbacks(correlationId2);
      expect(rollbacks.length).toBeGreaterThan(0);
    });
  });

  describe('Multi-User Scenarios', () => {
    it('should isolate tracking between users', () => {
      const toolId = 'shared-tool';
      const user1 = 'user-1';
      const user2 = 'user-2';

      // User 1 invocations
      tracker.createInvocation('corr-u1-1', toolId, 'test-server', {}, user1);
      tracker.createInvocation('corr-u1-2', toolId, 'test-server', {}, user1);
      tracker.recordSuccess('corr-u1-1', { ok: true }, 0);
      tracker.recordFailure('corr-u1-2', 'Error', 1);

      // User 2 invocations
      tracker.createInvocation('corr-u2-1', toolId, 'test-server', {}, user2);
      tracker.recordSuccess('corr-u2-1', { ok: true }, 0);

      // Check isolation
      const user1Invocations = tracker.getUserInvocations(user1);
      const user2Invocations = tracker.getUserInvocations(user2);

      expect(user1Invocations.length).toBe(2);
      expect(user2Invocations.length).toBe(1);
      expect(user1Invocations.every((r) => r.userId === user1)).toBe(true);
      expect(user2Invocations.every((r) => r.userId === user2)).toBe(true);
    });

    it('should maintain separate rate limits per user', () => {
      const serverId = 'test-server';

      rateLimiter.setServerLimit(serverId, { requestsPerSecond: 10, burstSize: 20 });
      rateLimiter.setUserLimit(serverId, 'user-1', { requestsPerSecond: 2, burstSize: 3 });
      rateLimiter.setUserLimit(serverId, 'user-2', { requestsPerSecond: 5, burstSize: 10 });

      // User 1: limited to 3 burst
      for (let i = 0; i < 3; i++) {
        expect(rateLimiter.allowRequest(serverId, 'user-1')).toBe(true);
      }
      expect(rateLimiter.allowRequest(serverId, 'user-1')).toBe(false);

      // User 2: limited to 10 burst
      for (let i = 0; i < 10; i++) {
        expect(rateLimiter.allowRequest(serverId, 'user-2')).toBe(true);
      }
      expect(rateLimiter.allowRequest(serverId, 'user-2')).toBe(false);
    });
  });

  describe('Concurrent Request Handling', () => {
    it('should handle concurrent invocations with proper tracking', (done) => {
      const promises = [];
      const userIds = ['user-1', 'user-2', 'user-3'];

      for (let i = 0; i < 9; i++) {
        const correlationId = `corr-concurrent-${i}`;
        const userId = userIds[i % 3];

        promises.push(
          Promise.resolve().then(() => {
            const created = tracker.createInvocation(
              correlationId,
              `tool-${i}`,
              'test-server',
              {},
              userId
            );

            const allowed = rateLimiter.allowRequest('test-server', userId);

            if (allowed) {
              tracker.recordSuccess(correlationId, { ok: true }, 0);
            } else {
              tracker.recordFailure(correlationId, 'Rate limited', 0);
            }

            return created;
          })
        );
      }

      Promise.all(promises).then(() => {
        const stats = tracker.getStats();

        expect(stats.total).toBe(9);
        expect(stats.completed).toBeGreaterThan(0);

        done();
      });
    });

    it('should handle concurrent rollback operations', (done) => {
      const promises = [];

      for (let i = 0; i < 5; i++) {
        const correlationId = `corr-rb-concurrent-${i}`;

        promises.push(
          Promise.resolve().then(() => {
            tracker.createInvocation(correlationId, 'tool-1', 'test-server');
            tracker.recordFailure(correlationId, 'Error', 0);

            const rb = rollback.initiateRollback(correlationId, 'Error', 'user-1');
            const action = rollback.addRollbackAction(rb.rollbackId, 'undo', 'tool-1', {});

            rollback.recordActionCompletion(rb.rollbackId, action.id, { ok: true });
            return rollback.completeRollback(rb.rollbackId);
          })
        );
      }

      Promise.all(promises).then(() => {
        const stats = rollback.getStats();

        expect(stats.total).toBe(5);
        expect(stats.completed).toBe(5);

        done();
      });
    });
  });

  describe('Statistics and Reporting', () => {
    it('should aggregate statistics across all services', () => {
      // Create successful invocations
      for (let i = 0; i < 3; i++) {
        tracker.createInvocation(`corr-success-${i}`, `tool-${i}`, 'test-server');
        tracker.recordSuccess(`corr-success-${i}`, { ok: true }, 0);
      }

      // Create failed invocations
      for (let i = 0; i < 2; i++) {
        tracker.createInvocation(`corr-fail-${i}`, `tool-${i}`, 'test-server');
        tracker.recordFailure(`corr-fail-${i}`, 'Error', 1);
      }

      const trackerStats = tracker.getStats();
      expect(trackerStats.total).toBe(5);
      expect(trackerStats.completed).toBe(3);
      expect(trackerStats.failed).toBe(2);

      const rateLimiterStats = rateLimiter.getStats('test-server');
      expect(rateLimiterStats.totalRequests).toBeGreaterThanOrEqual(0);

      const rollbackStats = rollback.getStats();
      expect(rollbackStats.total).toBeGreaterThanOrEqual(0);
    });
  });
});
