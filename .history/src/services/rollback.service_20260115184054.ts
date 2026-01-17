/**
 * Rollback Service
 * Manages rollback of invocations and orchestration operations
 * Tracks rollback history for debugging and auditing
 */

import { Logger } from '../utils/logger';
import { InvocationTrackerService, InvocationRecord } from './invocation-tracker.service';

/**
 * Rollback record
 */
export interface RollbackRecord {
  rollbackId: string;
  correlationId: string;
  originalInvocation: InvocationRecord;
  rollbackReason: string;
  status: 'pending' | 'completed' | 'failed';
  rollbackActions: RollbackAction[];
  initiatedAt: Date;
  completedAt?: Date;
  initiatedBy?: string;
  metadata?: Record<string, any>;
}

/**
 * Individual rollback action
 */
export interface RollbackAction {
  id: string;
  type: 'undo' | 'compensate' | 'restore';
  targetToolId: string;
  parameters?: Record<string, any>;
  status: 'pending' | 'completed' | 'failed';
  result?: any;
  error?: {
    message: string;
    details?: any;
  };
  executedAt?: Date;
}

/**
 * Rollback Service
 * Manages rollback operations and restoration
 */
export class RollbackService {
  private static instance: RollbackService;
  private invocationTracker: InvocationTrackerService;
  private rollbacks: Map<string, RollbackRecord> = new Map();
  private logger: Logger;

  private constructor() {
    this.logger = Logger.getInstance();
    this.invocationTracker = InvocationTrackerService.getInstance();
  }

  /**
   * Get or create singleton instance
   */
  static getInstance(): RollbackService {
    if (!RollbackService.instance) {
      RollbackService.instance = new RollbackService();
    }
    return RollbackService.instance;
  }

  /**
   * Initiate rollback for failed invocation
   */
  initiateRollback(
    correlationId: string,
    reason: string,
    initiatedBy?: string,
    metadata?: Record<string, any>
  ): RollbackRecord | undefined {
    const invocation = this.invocationTracker.getInvocation(correlationId);
    if (!invocation) {
      this.logger.warn(`[Rollback Service] Invocation not found for rollback: ${correlationId}`);
      return undefined;
    }

    const rollbackId = `rb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const rollbackRecord: RollbackRecord = {
      rollbackId,
      correlationId,
      originalInvocation: invocation,
      rollbackReason: reason,
      status: 'pending',
      rollbackActions: [],
      initiatedAt: new Date(),
      initiatedBy,
      metadata,
    };

    this.rollbacks.set(rollbackId, rollbackRecord);

    this.logger.info(`[Rollback Service] Initiated rollback: ${rollbackId}`, {
      correlationId,
      reason,
      initiatedBy,
    });

    return rollbackRecord;
  }

  /**
   * Add rollback action
   */
  addRollbackAction(
    rollbackId: string,
    type: 'undo' | 'compensate' | 'restore',
    targetToolId: string,
    parameters?: Record<string, any>
  ): RollbackAction | undefined {
    const rollback = this.rollbacks.get(rollbackId);
    if (!rollback) {
      this.logger.warn(`[Rollback Service] Rollback not found: ${rollbackId}`);
      return undefined;
    }

    const actionId = `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const action: RollbackAction = {
      id: actionId,
      type,
      targetToolId,
      parameters,
      status: 'pending',
    };

    rollback.rollbackActions.push(action);

    this.logger.debug(`[Rollback Service] Added rollback action: ${actionId}`, {
      rollbackId,
      type,
      targetToolId,
    });

    return action;
  }

  /**
   * Record rollback action completion
   */
  recordActionCompletion(
    rollbackId: string,
    actionId: string,
    result: any
  ): RollbackAction | undefined {
    const rollback = this.rollbacks.get(rollbackId);
    if (!rollback) {
      this.logger.warn(`[Rollback Service] Rollback not found: ${rollbackId}`);
      return undefined;
    }

    const action = rollback.rollbackActions.find((a) => a.id === actionId);
    if (!action) {
      this.logger.warn(`[Rollback Service] Action not found: ${actionId}`);
      return undefined;
    }

    action.status = 'completed';
    action.result = result;
    action.executedAt = new Date();

    this.logger.debug(`[Rollback Service] Completed rollback action: ${actionId}`, {
      rollbackId,
      targetToolId: action.targetToolId,
    });

    return action;
  }

  /**
   * Record rollback action failure
   */
  recordActionFailure(
    rollbackId: string,
    actionId: string,
    error: Error | string
  ): RollbackAction | undefined {
    const rollback = this.rollbacks.get(rollbackId);
    if (!rollback) {
      this.logger.warn(`[Rollback Service] Rollback not found: ${rollbackId}`);
      return undefined;
    }

    const action = rollback.rollbackActions.find((a) => a.id === actionId);
    if (!action) {
      this.logger.warn(`[Rollback Service] Action not found: ${actionId}`);
      return undefined;
    }

    action.status = 'failed';
    action.error = {
      message: typeof error === 'string' ? error : error.message,
      details: typeof error === 'object' ? (error as any).toString() : undefined,
    };
    action.executedAt = new Date();

    // Mark rollback as failed if any action fails
    rollback.status = 'failed';

    this.logger.warn(`[Rollback Service] Failed rollback action: ${actionId}`, {
      rollbackId,
      error: action.error.message,
    });

    return action;
  }

  /**
   * Complete rollback
   */
  completeRollback(rollbackId: string): RollbackRecord | undefined {
    const rollback = this.rollbacks.get(rollbackId);
    if (!rollback) {
      this.logger.warn(`[Rollback Service] Rollback not found: ${rollbackId}`);
      return undefined;
    }

    // Check if all actions completed successfully
    const allCompleted = rollback.rollbackActions.every((a) => a.status === 'completed');

    if (allCompleted) {
      rollback.status = 'completed';
      rollback.completedAt = new Date();

      this.logger.info(`[Rollback Service] Completed rollback: ${rollbackId}`, {
        correlationId: rollback.correlationId,
        actions: rollback.rollbackActions.length,
      });
    } else {
      rollback.status = 'failed';
      rollback.completedAt = new Date();

      this.logger.warn(`[Rollback Service] Rollback completed with failures: ${rollbackId}`, {
        correlationId: rollback.correlationId,
        failed: rollback.rollbackActions.filter((a) => a.status === 'failed').length,
      });
    }

    return rollback;
  }

  /**
   * Get rollback record
   */
  getRollback(rollbackId: string): RollbackRecord | undefined {
    return this.rollbacks.get(rollbackId);
  }

  /**
   * Get rollbacks for invocation
   */
  getInvocationRollbacks(correlationId: string): RollbackRecord[] {
    return Array.from(this.rollbacks.values()).filter((r) => r.correlationId === correlationId);
  }

  /**
   * Get rollbacks by status
   */
  getRollbacksByStatus(
    status: 'pending' | 'completed' | 'failed',
    limit: number = 100
  ): RollbackRecord[] {
    return Array.from(this.rollbacks.values())
      .filter((r) => r.status === status)
      .sort((a, b) => b.initiatedAt.getTime() - a.initiatedAt.getTime())
      .slice(0, limit);
  }

  /**
   * Get all rollbacks
   */
  getAllRollbacks(
    filter?: {
      status?: 'pending' | 'completed' | 'failed';
      initiatedBy?: string;
      startTime?: Date;
      endTime?: Date;
      limit?: number;
    }
  ): RollbackRecord[] {
    let results = Array.from(this.rollbacks.values());

    if (filter) {
      if (filter.status) {
        results = results.filter((r) => r.status === filter.status);
      }
      if (filter.initiatedBy) {
        results = results.filter((r) => r.initiatedBy === filter.initiatedBy);
      }
      if (filter.startTime) {
        results = results.filter((r) => r.initiatedAt >= filter.startTime!);
      }
      if (filter.endTime) {
        results = results.filter((r) => !r.completedAt || r.completedAt <= filter.endTime!);
      }

      // Sort by initiated time descending
      results.sort((a, b) => b.initiatedAt.getTime() - a.initiatedAt.getTime());

      // Apply limit
      const limit = filter.limit || 100;
      results = results.slice(0, limit);
    }

    return results;
  }

  /**
   * Get rollback statistics
   */
  getStats(): {
    total: number;
    pending: number;
    completed: number;
    failed: number;
    totalActions: number;
    failedActions: number;
    averageActionCount: number;
  } {
    const records = Array.from(this.rollbacks.values());

    const stats = {
      total: records.length,
      pending: records.filter((r) => r.status === 'pending').length,
      completed: records.filter((r) => r.status === 'completed').length,
      failed: records.filter((r) => r.status === 'failed').length,
      totalActions: records.reduce((sum, r) => sum + r.rollbackActions.length, 0),
      failedActions: records.reduce(
        (sum, r) => sum + r.rollbackActions.filter((a) => a.status === 'failed').length,
        0
      ),
      averageActionCount: 0,
    };

    if (records.length > 0) {
      stats.averageActionCount = Math.round(stats.totalActions / records.length);
    }

    return stats;
  }

  /**
   * Clear all rollback records (for testing)
   */
  clear(): void {
    this.rollbacks.clear();
    this.logger.debug('[Rollback Service] Cleared all rollback records');
  }
}

export const rollbackService = RollbackService.getInstance();
