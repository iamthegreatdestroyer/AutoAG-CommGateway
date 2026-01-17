/**
 * Unit Test Mocks - Rollback Service
 * Mock implementations for testing rollback functionality
 */

import {
  RollbackService,
  RollbackRecord,
  RollbackAction,
} from '../../src/services/rollback.service';
import { InvocationTrackerService } from '../../src/services/invocation-tracker.service';

/**
 * Test Suite: Rollback Service
 */
describe('RollbackService', () => {
  let rollback: RollbackService;
  let tracker: InvocationTrackerService;

  beforeEach(() => {
    rollback = RollbackService.getInstance();
    tracker = InvocationTrackerService.getInstance();
    rollback.clear();
    tracker.clear();
  });

  describe('Rollback Initiation', () => {
    it('should initiate rollback for failed invocation', () => {
      const correlationId = 'inv-123';
      const reason = 'Tool execution failed';
      const initiatedBy = 'user-1';

      const rollbackRecord = rollback.initiateRollback(correlationId, reason, initiatedBy);

      expect(rollbackRecord).toBeDefined();
      expect(rollbackRecord.correlationId).toBe(correlationId);
      expect(rollbackRecord.rollbackReason).toBe(reason);
      expect(rollbackRecord.initiatedBy).toBe(initiatedBy);
      expect(rollbackRecord.status).toBe('pending');
      expect(rollbackRecord.rollbackActions).toEqual([]);
    });

    it('should generate unique rollback IDs', () => {
      const rollback1 = rollback.initiateRollback('inv-1', 'Error', 'user-1');
      const rollback2 = rollback.initiateRollback('inv-2', 'Error', 'user-1');

      expect(rollback1.rollbackId).not.toBe(rollback2.rollbackId);
    });

    it('should set rollback metadata', () => {
      const metadata = { reason: 'timeout', attempt: 1 };

      const rollbackRecord = rollback.initiateRollback('inv-123', 'Failed', 'user-1', metadata);

      expect(rollbackRecord.metadata).toEqual(metadata);
    });

    it('should record initiatedAt timestamp', () => {
      const beforeTime = Date.now();
      const rollbackRecord = rollback.initiateRollback('inv-123', 'Failed', 'user-1');
      const afterTime = Date.now();

      expect(rollbackRecord.initiatedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(rollbackRecord.initiatedAt).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('Rollback Action Management', () => {
    it('should add undo action to rollback', () => {
      const rollbackRecord = rollback.initiateRollback('inv-123', 'Failed', 'user-1');
      const actionParams = { key: 'config', oldValue: 'A', newValue: 'B' };

      const action = rollback.addRollbackAction(
        rollbackRecord.rollbackId,
        'undo',
        'config-tool',
        actionParams
      );

      expect(action).toBeDefined();
      expect(action.type).toBe('undo');
      expect(action.targetToolId).toBe('config-tool');
      expect(action.parameters).toEqual(actionParams);
      expect(action.status).toBe('pending');
    });

    it('should add compensating action to rollback', () => {
      const rollbackRecord = rollback.initiateRollback('inv-123', 'Failed', 'user-1');

      const action = rollback.addRollbackAction(
        rollbackRecord.rollbackId,
        'compensate',
        'data-tool',
        { cleanup: true }
      );

      expect(action.type).toBe('compensate');
    });

    it('should add restore action to rollback', () => {
      const rollbackRecord = rollback.initiateRollback('inv-123', 'Failed', 'user-1');

      const action = rollback.addRollbackAction(
        rollbackRecord.rollbackId,
        'restore',
        'backup-tool',
        { version: '2024-01-15' }
      );

      expect(action.type).toBe('restore');
    });

    it('should add multiple actions to single rollback', () => {
      const rollbackRecord = rollback.initiateRollback('inv-123', 'Failed', 'user-1');

      rollback.addRollbackAction(rollbackRecord.rollbackId, 'undo', 'tool-1', {});
      rollback.addRollbackAction(rollbackRecord.rollbackId, 'compensate', 'tool-2', {});
      rollback.addRollbackAction(rollbackRecord.rollbackId, 'restore', 'tool-3', {});

      const record = rollback.getRollback(rollbackRecord.rollbackId);

      expect(record?.rollbackActions.length).toBe(3);
    });

    it('should generate unique action IDs', () => {
      const rollbackRecord = rollback.initiateRollback('inv-123', 'Failed', 'user-1');

      const action1 = rollback.addRollbackAction(rollbackRecord.rollbackId, 'undo', 'tool-1', {});
      const action2 = rollback.addRollbackAction(rollbackRecord.rollbackId, 'undo', 'tool-2', {});

      expect(action1.id).not.toBe(action2.id);
    });
  });

  describe('Action Completion', () => {
    it('should record successful action completion', () => {
      const rollbackRecord = rollback.initiateRollback('inv-123', 'Failed', 'user-1');
      const action = rollback.addRollbackAction(rollbackRecord.rollbackId, 'undo', 'tool-1', {});

      const result = { success: true, message: 'Undone successfully' };
      const updated = rollback.recordActionCompletion(rollbackRecord.rollbackId, action.id, result);

      expect(updated).toBeDefined();
      expect(updated?.status).toBe('completed');
      expect(updated?.result).toEqual(result);
      expect(updated?.executedAt).toBeDefined();
    });

    it('should record action failure', () => {
      const rollbackRecord = rollback.initiateRollback('inv-123', 'Failed', 'user-1');
      const action = rollback.addRollbackAction(rollbackRecord.rollbackId, 'undo', 'tool-1', {});

      const error = new Error('Could not undo operation');
      const updated = rollback.recordActionFailure(rollbackRecord.rollbackId, action.id, error);

      expect(updated?.status).toBe('failed');
      expect(updated?.error?.message).toBe('Could not undo operation');
    });

    it('should handle string error messages', () => {
      const rollbackRecord = rollback.initiateRollback('inv-123', 'Failed', 'user-1');
      const action = rollback.addRollbackAction(rollbackRecord.rollbackId, 'undo', 'tool-1', {});

      const updated = rollback.recordActionFailure(
        rollbackRecord.rollbackId,
        action.id,
        'Rollback failed'
      );

      expect(updated?.error?.message).toBe('Rollback failed');
    });
  });

  describe('Rollback Completion', () => {
    it('should mark rollback as completed when all actions succeed', () => {
      const rollbackRecord = rollback.initiateRollback('inv-123', 'Failed', 'user-1');

      const action1 = rollback.addRollbackAction(rollbackRecord.rollbackId, 'undo', 'tool-1', {});
      const action2 = rollback.addRollbackAction(
        rollbackRecord.rollbackId,
        'compensate',
        'tool-2',
        {}
      );

      rollback.recordActionCompletion(rollbackRecord.rollbackId, action1.id, { ok: true });
      rollback.recordActionCompletion(rollbackRecord.rollbackId, action2.id, { ok: true });

      const completed = rollback.completeRollback(rollbackRecord.rollbackId);

      expect(completed?.status).toBe('completed');
      expect(completed?.completedAt).toBeDefined();
    });

    it('should mark rollback as failed if any action fails', () => {
      const rollbackRecord = rollback.initiateRollback('inv-123', 'Failed', 'user-1');

      const action1 = rollback.addRollbackAction(rollbackRecord.rollbackId, 'undo', 'tool-1', {});
      const action2 = rollback.addRollbackAction(
        rollbackRecord.rollbackId,
        'compensate',
        'tool-2',
        {}
      );

      rollback.recordActionCompletion(rollbackRecord.rollbackId, action1.id, { ok: true });
      rollback.recordActionFailure(rollbackRecord.rollbackId, action2.id, 'Action failed');

      const completed = rollback.completeRollback(rollbackRecord.rollbackId);

      expect(completed?.status).toBe('failed');
    });

    it('should record completion timestamp', () => {
      const rollbackRecord = rollback.initiateRollback('inv-123', 'Failed', 'user-1');
      const action = rollback.addRollbackAction(rollbackRecord.rollbackId, 'undo', 'tool-1', {});

      rollback.recordActionCompletion(rollbackRecord.rollbackId, action.id, { ok: true });

      const beforeTime = Date.now();
      const completed = rollback.completeRollback(rollbackRecord.rollbackId);
      const afterTime = Date.now();

      expect(completed?.completedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(completed?.completedAt).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('Retrieval', () => {
    it('should retrieve rollback by ID', () => {
      const rollbackRecord = rollback.initiateRollback('inv-123', 'Failed', 'user-1');

      const retrieved = rollback.getRollback(rollbackRecord.rollbackId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.rollbackId).toBe(rollbackRecord.rollbackId);
    });

    it('should return undefined for non-existent rollback', () => {
      const retrieved = rollback.getRollback('non-existent-id');

      expect(retrieved).toBeUndefined();
    });

    it('should get all rollbacks for invocation', () => {
      const correlationId = 'inv-123';

      const rb1 = rollback.initiateRollback(correlationId, 'Error 1', 'user-1');
      const rb2 = rollback.initiateRollback(correlationId, 'Error 2', 'user-1');

      const rollbacks = rollback.getInvocationRollbacks(correlationId);

      expect(rollbacks.length).toBe(2);
      expect(rollbacks.every((rb) => rb.correlationId === correlationId)).toBe(true);
    });

    it('should filter rollbacks by status', () => {
      const rb1 = rollback.initiateRollback('inv-1', 'Error', 'user-1');
      const rb2 = rollback.initiateRollback('inv-2', 'Error', 'user-1');

      const action1 = rollback.addRollbackAction(rb1.rollbackId, 'undo', 'tool-1', {});
      rollback.recordActionCompletion(rb1.rollbackId, action1.id, { ok: true });
      rollback.completeRollback(rb1.rollbackId);

      const completedRollbacks = rollback.getRollbacksByStatus('completed');
      const pendingRollbacks = rollback.getRollbacksByStatus('pending');

      expect(completedRollbacks.length).toBeGreaterThan(0);
      expect(completedRollbacks.some((rb) => rb.rollbackId === rb1.rollbackId)).toBe(true);
      expect(pendingRollbacks.some((rb) => rb.rollbackId === rb2.rollbackId)).toBe(true);
    });
  });

  describe('Statistics', () => {
    it('should calculate rollback statistics', () => {
      const rb1 = rollback.initiateRollback('inv-1', 'Error 1', 'user-1');
      const rb2 = rollback.initiateRollback('inv-2', 'Error 2', 'user-1');

      const action1 = rollback.addRollbackAction(rb1.rollbackId, 'undo', 'tool-1', {});
      rollback.recordActionCompletion(rb1.rollbackId, action1.id, { ok: true });
      rollback.completeRollback(rb1.rollbackId);

      const stats = rollback.getStats();

      expect(stats.total).toBe(2);
      expect(stats.completed).toBeGreaterThanOrEqual(1);
      expect(stats.pending).toBeGreaterThanOrEqual(1);
    });

    it('should count actions in statistics', () => {
      const rb = rollback.initiateRollback('inv-1', 'Error', 'user-1');

      rollback.addRollbackAction(rb.rollbackId, 'undo', 'tool-1', {});
      rollback.addRollbackAction(rb.rollbackId, 'compensate', 'tool-2', {});
      rollback.addRollbackAction(rb.rollbackId, 'restore', 'tool-3', {});

      const stats = rollback.getStats();

      expect(stats.totalActions).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Cleanup and Deletion', () => {
    it('should delete rollback', () => {
      const rb = rollback.initiateRollback('inv-123', 'Error', 'user-1');

      expect(rollback.getRollback(rb.rollbackId)).toBeDefined();

      rollback.deleteRollback(rb.rollbackId);

      expect(rollback.getRollback(rb.rollbackId)).toBeUndefined();
    });

    it('should return false when deleting non-existent rollback', () => {
      const result = rollback.deleteRollback('non-existent-id');

      expect(result).toBe(false);
    });

    it('should clear all rollbacks', () => {
      rollback.initiateRollback('inv-1', 'Error', 'user-1');
      rollback.initiateRollback('inv-2', 'Error', 'user-1');

      rollback.clear();

      const stats = rollback.getStats();

      expect(stats.total).toBe(0);
    });
  });

  describe('Integration with Invocation Tracker', () => {
    it('should link rollback to failed invocation', () => {
      const correlationId = 'inv-123';

      tracker.createInvocation(correlationId, 'tool-1', 'server-1');
      tracker.recordFailure(correlationId, 'Tool failed', 1);

      const rollbackRecord = rollback.initiateRollback(correlationId, 'Recovery needed', 'user-1');

      expect(rollbackRecord.correlationId).toBe(correlationId);

      const invocation = tracker.getInvocation(correlationId);
      expect(invocation?.status).toBe('failed');

      const invocationRollbacks = rollback.getInvocationRollbacks(correlationId);
      expect(invocationRollbacks.length).toBeGreaterThan(0);
    });

    it('should support multiple rollbacks for single failed invocation', () => {
      const correlationId = 'inv-123';

      tracker.createInvocation(correlationId, 'tool-1', 'server-1');
      tracker.recordFailure(correlationId, 'Tool failed', 1);

      const rb1 = rollback.initiateRollback(correlationId, 'First attempt', 'user-1');
      const rb2 = rollback.initiateRollback(correlationId, 'Second attempt', 'user-1');

      const rollbacks = rollback.getInvocationRollbacks(correlationId);

      expect(rollbacks.length).toBe(2);
    });
  });
});
