/**
 * Invocation Tracker Service
 * Tracks tool invocation results for later retrieval via correlation ID
 * Provides audit trail and invocation history
 */

import { logger, Logger } from '../utils/logger';
import { ToolInvocationResponse } from '../types/mcp.types';

/**
 * Complete invocation record
 */
export interface InvocationRecord {
  correlationId: string;
  toolId: string;
  serverId: string;
  parameters?: Record<string, any>;
  result?: any;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
  status: 'pending' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  executionTime?: number;
  retries?: number;
  userId?: string;
  metadata?: Record<string, any>;
}

/**
 * Invocation Tracker Service
 * Stores and retrieves invocation results
 */
export class InvocationTrackerService {
  private static instance: InvocationTrackerService;
  private invocations: Map<string, InvocationRecord> = new Map();
  private userInvocations: Map<string, Set<string>> = new Map(); // userId -> correlationIds
  private logger: Logger;

  // Retention policy
  private retentionMs = 86400000; // 24 hours by default

  private constructor() {
    this.logger = logger;
    this.startCleanupInterval();
  }

  /**
   * Get or create singleton instance
   */
  static getInstance(): InvocationTrackerService {
    if (!InvocationTrackerService.instance) {
      InvocationTrackerService.instance = new InvocationTrackerService();
    }
    return InvocationTrackerService.instance;
  }

  /**
   * Create a new pending invocation record
   */
  createInvocation(
    correlationId: string,
    toolId: string,
    serverId: string,
    parameters?: Record<string, any>,
    userId?: string,
    metadata?: Record<string, any>
  ): InvocationRecord {
    const record: InvocationRecord = {
      correlationId,
      toolId,
      serverId,
      parameters,
      status: 'pending',
      startTime: new Date(),
      userId,
      metadata,
    };

    this.invocations.set(correlationId, record);

    // Track by user
    if (userId) {
      if (!this.userInvocations.has(userId)) {
        this.userInvocations.set(userId, new Set());
      }
      this.userInvocations.get(userId)!.add(correlationId);
    }

    this.logger.debug(`[Invocation Tracker] Created invocation: ${correlationId}`, {
      toolId,
      serverId,
      userId,
    });

    return record;
  }

  /**
   * Record successful invocation completion
   */
  recordSuccess(
    correlationId: string,
    result: any,
    retries: number = 0
  ): InvocationRecord | undefined {
    const record = this.invocations.get(correlationId);
    if (!record) {
      this.logger.warn(`[Invocation Tracker] Invocation not found: ${correlationId}`);
      return undefined;
    }

    record.status = 'completed';
    record.result = result;
    record.endTime = new Date();
    record.executionTime = record.endTime.getTime() - record.startTime.getTime();
    record.retries = retries;

    this.logger.info(`[Invocation Tracker] Invocation completed: ${correlationId}`, {
      executionTime: record.executionTime,
      retries,
    });

    return record;
  }

  /**
   * Record invocation failure
   */
  recordFailure(
    correlationId: string,
    error: Error | string,
    retries: number = 0
  ): InvocationRecord | undefined {
    const record = this.invocations.get(correlationId);
    if (!record) {
      this.logger.warn(`[Invocation Tracker] Invocation not found: ${correlationId}`);
      return undefined;
    }

    record.status = 'failed';
    record.error = {
      message: typeof error === 'string' ? error : error.message,
      details: typeof error === 'object' ? (error as any).toString() : undefined,
    };
    record.endTime = new Date();
    record.executionTime = record.endTime.getTime() - record.startTime.getTime();
    record.retries = retries;

    this.logger.info(`[Invocation Tracker] Invocation failed: ${correlationId}`, {
      error: record.error.message,
      executionTime: record.executionTime,
      retries,
    });

    return record;
  }

  /**
   * Get invocation record by correlation ID
   */
  getInvocation(correlationId: string): InvocationRecord | undefined {
    return this.invocations.get(correlationId);
  }

  /**
   * Get all invocations for a user
   */
  getUserInvocations(userId: string, limit: number = 100): InvocationRecord[] {
    const correlationIds = this.userInvocations.get(userId);
    if (!correlationIds) {
      return [];
    }

    return Array.from(correlationIds)
      .slice(-limit) // Get last N
      .map((id) => this.invocations.get(id))
      .filter((record) => record !== undefined) as InvocationRecord[];
  }

  /**
   * Get invocations by tool
   */
  getToolInvocations(toolId: string, limit: number = 100): InvocationRecord[] {
    return Array.from(this.invocations.values())
      .filter((record) => record.toolId === toolId)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
      .slice(0, limit);
  }

  /**
   * Get invocations by server
   */
  getServerInvocations(serverId: string, limit: number = 100): InvocationRecord[] {
    return Array.from(this.invocations.values())
      .filter((record) => record.serverId === serverId)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
      .slice(0, limit);
  }

  /**
   * Get invocations by status
   */
  getInvocationsByStatus(
    status: 'pending' | 'completed' | 'failed',
    limit: number = 100
  ): InvocationRecord[] {
    return Array.from(this.invocations.values())
      .filter((record) => record.status === status)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
      .slice(0, limit);
  }

  /**
   * Get all invocations (with optional filtering)
   */
  getAllInvocations(filter?: {
    status?: 'pending' | 'completed' | 'failed';
    toolId?: string;
    serverId?: string;
    userId?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): InvocationRecord[] {
    let results = Array.from(this.invocations.values());

    if (filter) {
      if (filter.status) {
        results = results.filter((r) => r.status === filter.status);
      }
      if (filter.toolId) {
        results = results.filter((r) => r.toolId === filter.toolId);
      }
      if (filter.serverId) {
        results = results.filter((r) => r.serverId === filter.serverId);
      }
      if (filter.userId) {
        results = results.filter((r) => r.userId === filter.userId);
      }
      if (filter.startTime) {
        results = results.filter((r) => r.startTime >= filter.startTime!);
      }
      if (filter.endTime) {
        results = results.filter((r) => !r.endTime || r.endTime <= filter.endTime!);
      }

      // Sort by start time descending
      results.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

      // Apply limit
      const limit = filter.limit || 100;
      results = results.slice(0, limit);
    }

    return results;
  }

  /**
   * Delete invocation record
   */
  deleteInvocation(correlationId: string): boolean {
    const record = this.invocations.get(correlationId);
    if (!record) {
      return false;
    }

    // Remove from user tracking
    if (record.userId) {
      const userIds = this.userInvocations.get(record.userId);
      if (userIds) {
        userIds.delete(correlationId);
      }
    }

    this.invocations.delete(correlationId);
    this.logger.debug(`[Invocation Tracker] Deleted invocation: ${correlationId}`);

    return true;
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    pending: number;
    completed: number;
    failed: number;
    averageExecutionTime: number;
    users: number;
  } {
    const records = Array.from(this.invocations.values());

    const stats = {
      total: records.length,
      pending: records.filter((r) => r.status === 'pending').length,
      completed: records.filter((r) => r.status === 'completed').length,
      failed: records.filter((r) => r.status === 'failed').length,
      averageExecutionTime: 0,
      users: this.userInvocations.size,
    };

    const completedWithTime = records.filter((r) => r.executionTime !== undefined);
    if (completedWithTime.length > 0) {
      const totalTime = completedWithTime.reduce((sum, r) => sum + (r.executionTime || 0), 0);
      stats.averageExecutionTime = Math.round(totalTime / completedWithTime.length);
    }

    return stats;
  }

  /**
   * Set retention policy
   */
  setRetentionMs(ms: number): void {
    this.retentionMs = ms;
    this.logger.info(`[Invocation Tracker] Updated retention policy to ${ms}ms`);
  }

  /**
   * Cleanup old records periodically
   */
  private startCleanupInterval(): void {
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      for (const [correlationId, record] of this.invocations.entries()) {
        // Delete if older than retention policy
        if (now - record.startTime.getTime() > this.retentionMs) {
          // Remove from user tracking
          if (record.userId) {
            const userIds = this.userInvocations.get(record.userId);
            if (userIds) {
              userIds.delete(correlationId);
            }
          }

          this.invocations.delete(correlationId);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        this.logger.debug(`[Invocation Tracker] Cleaned ${cleaned} expired invocations`);
      }
    }, 300000); // Run every 5 minutes
  }

  /**
   * Clear all records (for testing)
   */
  clear(): void {
    this.invocations.clear();
    this.userInvocations.clear();
    this.logger.debug('[Invocation Tracker] Cleared all records');
  }
}

export const invocationTrackerService = InvocationTrackerService.getInstance();
