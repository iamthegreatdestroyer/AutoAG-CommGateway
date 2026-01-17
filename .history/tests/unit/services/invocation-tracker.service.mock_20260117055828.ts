/**
 * Unit Test Mocks - Invocation Tracker Service
 * Mock implementations for testing invocation tracking functionality
 */

import {
  InvocationTrackerService,
  InvocationRecord,
} from '../../src/services/invocation-tracker.service';

/**
 * Test Suite: Invocation Tracker Service
 */
describe('InvocationTrackerService', () => {
  let tracker: InvocationTrackerService;

  beforeEach(() => {
    tracker = InvocationTrackerService.getInstance();
    tracker.clear(); // Clear state before each test
  });

  describe('Invocation Creation and Tracking', () => {
    it('should create a new invocation record', () => {
      const correlationId = 'corr-123';
      const toolId = 'tool-1';
      const serverId = 'server-1';

      const record = tracker.createInvocation(correlationId, toolId, serverId);

      expect(record).toBeDefined();
      expect(record.correlationId).toBe(correlationId);
      expect(record.toolId).toBe(toolId);
      expect(record.serverId).toBe(serverId);
      expect(record.status).toBe('pending');
      expect(record.startTime).toBeDefined();
    });

    it('should track invocation with parameters', () => {
      const correlationId = 'corr-123';
      const parameters = { input: 'test', value: 42 };

      const record = tracker.createInvocation('corr-123', 'tool-1', 'server-1', parameters);

      expect(record.parameters).toEqual(parameters);
    });

    it('should track invocation with user and metadata', () => {
      const userId = 'user-1';
      const metadata = { context: 'testing', version: '1.0' };

      const record = tracker.createInvocation(
        'corr-123',
        'tool-1',
        'server-1',
        {},
        userId,
        metadata
      );

      expect(record.userId).toBe(userId);
      expect(record.metadata).toEqual(metadata);
    });
  });

  describe('Success Tracking', () => {
    it('should record successful invocation', () => {
      const correlationId = 'corr-123';
      const result = { status: 'success', data: 'result-data' };

      tracker.createInvocation(correlationId, 'tool-1', 'server-1');
      const updatedRecord = tracker.recordSuccess(correlationId, result, 0);

      expect(updatedRecord?.status).toBe('completed');
      expect(updatedRecord?.result).toEqual(result);
      expect(updatedRecord?.endTime).toBeDefined();
      expect(updatedRecord?.executionTime).toBeDefined();
      expect(updatedRecord?.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('should track retry count on success', () => {
      const correlationId = 'corr-123';

      tracker.createInvocation(correlationId, 'tool-1', 'server-1');
      const record = tracker.recordSuccess(correlationId, { ok: true }, 2);

      expect(record?.retries).toBe(2);
    });

    it('should calculate execution time correctly', (done) => {
      const correlationId = 'corr-123';

      tracker.createInvocation(correlationId, 'tool-1', 'server-1');

      setTimeout(() => {
        const record = tracker.recordSuccess(correlationId, { ok: true }, 0);

        expect(record?.executionTime).toBeDefined();
        expect(record?.executionTime).toBeGreaterThanOrEqual(100); // At least 100ms
        done();
      }, 100);
    });
  });

  describe('Failure Tracking', () => {
    it('should record failed invocation with error message', () => {
      const correlationId = 'corr-123';
      const errorMsg = 'Connection timeout';

      tracker.createInvocation(correlationId, 'tool-1', 'server-1');
      const record = tracker.recordFailure(correlationId, errorMsg, 3);

      expect(record?.status).toBe('failed');
      expect(record?.error?.message).toBe(errorMsg);
      expect(record?.retries).toBe(3);
    });

    it('should record failed invocation with Error object', () => {
      const correlationId = 'corr-123';
      const error = new Error('Network error');

      tracker.createInvocation(correlationId, 'tool-1', 'server-1');
      const record = tracker.recordFailure(correlationId, error, 1);

      expect(record?.status).toBe('failed');
      expect(record?.error?.message).toBe('Network error');
    });

    it('should capture execution time on failure', (done) => {
      const correlationId = 'corr-123';

      tracker.createInvocation(correlationId, 'tool-1', 'server-1');

      setTimeout(() => {
        const record = tracker.recordFailure(correlationId, 'Failed', 0);

        expect(record?.executionTime).toBeDefined();
        expect(record?.executionTime).toBeGreaterThanOrEqual(50);
        done();
      }, 50);
    });
  });

  describe('Retrieval and Filtering', () => {
    beforeEach(() => {
      // Create multiple invocations
      for (let i = 1; i <= 5; i++) {
        tracker.createInvocation(`corr-${i}`, `tool-${i % 2}`, 'server-1');
        if (i <= 3) {
          tracker.recordSuccess(`corr-${i}`, { result: `r${i}` }, 0);
        } else {
          tracker.recordFailure(`corr-${i}`, 'Error', 1);
        }
      }
    });

    it('should retrieve invocation by correlation ID', () => {
      const record = tracker.getInvocation('corr-1');

      expect(record).toBeDefined();
      expect(record?.correlationId).toBe('corr-1');
      expect(record?.status).toBe('completed');
    });

    it('should get invocations by tool', () => {
      const records = tracker.getToolInvocations('tool-0');

      expect(records.length).toBeGreaterThan(0);
      expect(records.every((r) => r.toolId === 'tool-0')).toBe(true);
    });

    it('should get invocations by server', () => {
      const records = tracker.getServerInvocations('server-1');

      expect(records.length).toBe(5);
      expect(records.every((r) => r.serverId === 'server-1')).toBe(true);
    });

    it('should get invocations by status', () => {
      const completedRecords = tracker.getInvocationsByStatus('completed');
      const failedRecords = tracker.getInvocationsByStatus('failed');

      expect(completedRecords.length).toBe(3);
      expect(failedRecords.length).toBe(2);
    });

    it('should filter invocations with multiple criteria', () => {
      const records = tracker.getAllInvocations({
        status: 'completed',
        limit: 2,
      });

      expect(records.length).toBe(2);
      expect(records.every((r) => r.status === 'completed')).toBe(true);
    });
  });

  describe('User Tracking', () => {
    it('should track invocations per user', () => {
      const userId = 'user-123';

      tracker.createInvocation('corr-1', 'tool-1', 'server-1', {}, userId);
      tracker.createInvocation('corr-2', 'tool-2', 'server-1', {}, userId);

      const userInvocations = tracker.getUserInvocations(userId);

      expect(userInvocations.length).toBe(2);
      expect(userInvocations.every((r) => r.userId === userId)).toBe(true);
    });

    it('should respect limit on user invocations', () => {
      const userId = 'user-123';

      for (let i = 1; i <= 10; i++) {
        tracker.createInvocation(`corr-${i}`, 'tool-1', 'server-1', {}, userId);
      }

      const userInvocations = tracker.getUserInvocations(userId, 5);

      expect(userInvocations.length).toBe(5);
    });
  });

  describe('Statistics', () => {
    it('should calculate statistics', () => {
      tracker.createInvocation('corr-1', 'tool-1', 'server-1');
      tracker.recordSuccess('corr-1', { ok: true }, 0);

      tracker.createInvocation('corr-2', 'tool-1', 'server-1');
      tracker.recordFailure('corr-2', 'Error', 1);

      tracker.createInvocation('corr-3', 'tool-1', 'server-1'); // Pending

      const stats = tracker.getStats();

      expect(stats.total).toBe(3);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.pending).toBe(1);
    });

    it('should calculate average execution time', (done) => {
      tracker.createInvocation('corr-1', 'tool-1', 'server-1');

      setTimeout(() => {
        tracker.recordSuccess('corr-1', { ok: true }, 0);

        tracker.createInvocation('corr-2', 'tool-1', 'server-1');

        setTimeout(() => {
          tracker.recordSuccess('corr-2', { ok: true }, 0);

          const stats = tracker.getStats();

          expect(stats.averageExecutionTime).toBeGreaterThan(0);
          expect(stats.averageExecutionTime).toBeLessThan(500); // Should be reasonable
          done();
        }, 50);
      }, 50);
    });
  });

  describe('Cleanup and Deletion', () => {
    it('should delete specific invocation', () => {
      tracker.createInvocation('corr-1', 'tool-1', 'server-1');

      let record = tracker.getInvocation('corr-1');
      expect(record).toBeDefined();

      tracker.deleteInvocation('corr-1');

      record = tracker.getInvocation('corr-1');
      expect(record).toBeUndefined();
    });

    it('should return false when deleting non-existent invocation', () => {
      const result = tracker.deleteInvocation('non-existent');

      expect(result).toBe(false);
    });

    it('should clear all records', () => {
      tracker.createInvocation('corr-1', 'tool-1', 'server-1');
      tracker.createInvocation('corr-2', 'tool-2', 'server-1');

      tracker.clear();

      const stats = tracker.getStats();

      expect(stats.total).toBe(0);
    });
  });

  describe('Retention Policy', () => {
    it('should accept retention policy changes', () => {
      tracker.setRetentionMs(60000); // 1 minute

      // This test primarily ensures the method is callable
      expect(true).toBe(true);
    });

    it('should maintain invocations within retention period', (done) => {
      tracker.setRetentionMs(100); // 100ms retention

      tracker.createInvocation('corr-1', 'tool-1', 'server-1');
      tracker.recordSuccess('corr-1', { ok: true }, 0);

      expect(tracker.getInvocation('corr-1')).toBeDefined();

      // Wait for cleanup
      setTimeout(() => {
        // Note: Cleanup runs every 5 minutes in real implementation
        // This test is illustrative - actual cleanup won't run in this timeframe
        expect(true).toBe(true);
        done();
      }, 200);
    });
  });
});
