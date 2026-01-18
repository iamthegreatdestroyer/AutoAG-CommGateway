/**
 * MCP Orchestrator Service
 * Coordinates complex workflows across multiple MCP servers
 * Handles tool chaining, error recovery, and result aggregation
 */

import { logger, Logger } from '../utils/logger';
import { MCPClientManager, MCPServerClient } from './mcp-client.service';
import { mcpServerRegistryService } from './mcp-registry.service';
import {
  ToolInvocationRequest,
  ToolInvocationResponse,
  MCPError,
  MCPOrchestrationError,
} from '../types/mcp.types';

/**
 * Orchestration request configuration
 */
interface OrchestrationRequest {
  workflowId: string;
  name: string;
  description?: string;
  steps: OrchestrationStep[];
  errorHandling?: 'stop' | 'continue' | 'rollback';
  timeout?: number;
  metadata?: Record<string, any>;
}

/**
 * Single orchestration step
 */
interface OrchestrationStep {
  stepId: string;
  serverId: string;
  toolId: string;
  parameters?: Record<string, any>;
  retryPolicy?: {
    maxAttempts: number;
    backoffMs: number;
    backoffMultiplier: number;
  };
  timeout?: number;
  conditions?: {
    requiresApproval?: boolean;
    skipCondition?: string; // JS expression
  };
}

/**
 * Orchestration execution result
 */
interface OrchestrationResult {
  workflowId: string;
  status: 'success' | 'partial' | 'failed';
  executedSteps: Map<string, ToolInvocationResponse>;
  failedSteps: Map<string, Error>;
  totalExecutionTime: number;
  startTime: Date;
  endTime: Date;
  summary: {
    totalSteps: number;
    successfulSteps: number;
    failedSteps: number;
    skippedSteps: number;
  };
}

/**
 * MCP Orchestrator
 */
export class MCPOrchestrator {
  private clientManager: MCPClientManager;
  private logger: Logger;
  private activeWorkflows: Map<string, OrchestrationResult> = new Map();

  constructor(clientManager: MCPClientManager) {
    this.clientManager = clientManager;
    this.logger = logger;
  }

  /**
   * Execute an orchestration workflow
   */
  async executeWorkflow(request: OrchestrationRequest): Promise<OrchestrationResult> {
    const startTime = Date.now();
    const result: OrchestrationResult = {
      workflowId: request.workflowId,
      status: 'success',
      executedSteps: new Map(),
      failedSteps: new Map(),
      totalExecutionTime: 0,
      startTime: new Date(),
      endTime: new Date(),
      summary: {
        totalSteps: request.steps.length,
        successfulSteps: 0,
        failedSteps: 0,
        skippedSteps: 0,
      },
    };

    this.activeWorkflows.set(request.workflowId, result);

    this.logger.info(`[MCP Orchestrator] Starting workflow: ${request.name}`, {
      workflowId: request.workflowId,
      steps: request.steps.length,
    });

    try {
      for (const step of request.steps) {
        try {
          // Check skip condition
          if (step.conditions?.skipCondition) {
            if (this.evaluateCondition(step.conditions.skipCondition, result.executedSteps)) {
              this.logger.info(`[MCP Orchestrator] Skipping step: ${step.stepId}`);
              result.summary.skippedSteps++;
              continue;
            }
          }

          // Execute step with retry policy
          const stepResult = await this.executeStepWithRetry(step);
          result.executedSteps.set(step.stepId, stepResult);
          result.summary.successfulSteps++;

          this.logger.info(`[MCP Orchestrator] Step completed: ${step.stepId}`, {
            executionTime: stepResult.executionTime,
          });
        } catch (error: any) {
          result.failedSteps.set(step.stepId, error);
          result.summary.failedSteps++;

          this.logger.error(`[MCP Orchestrator] Step failed: ${step.stepId}`, {
            error: error.message,
          });

          // Handle error based on policy
          if (request.errorHandling === 'stop') {
            result.status = 'failed';
            throw new MCPOrchestrationError(
              request.workflowId,
              `Workflow stopped at step: ${step.stepId}`,
              { failedStep: step.stepId, error }
            );
          } else if (request.errorHandling === 'rollback') {
            // TODO: Implement rollback logic
            result.status = 'partial';
            break;
          }
          // else: continue
        }
      }

      if (result.summary.failedSteps > 0) {
        result.status = 'partial';
      }
    } catch (error: any) {
      if (!(error instanceof MCPError)) {
        throw new MCPOrchestrationError(request.workflowId, error.message, {
          error: error.toString(),
        });
      }
      throw error;
    } finally {
      result.totalExecutionTime = Date.now() - startTime;
      result.endTime = new Date();

      this.logger.info(`[MCP Orchestrator] Workflow completed: ${request.name}`, {
        status: result.status,
        executionTime: result.totalExecutionTime,
        summary: result.summary,
      });

      this.activeWorkflows.delete(request.workflowId);
    }

    return result;
  }

  /**
   * Execute a single step with retry logic
   */
  private async executeStepWithRetry(step: OrchestrationStep): Promise<ToolInvocationResponse> {
    const retryPolicy = step.retryPolicy || {
      maxAttempts: 1,
      backoffMs: 1000,
      backoffMultiplier: 2,
    };

    let lastError: Error | null = null;
    let backoffMs = retryPolicy.backoffMs;

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
      try {
        return await this.executeStep(step);
      } catch (error: any) {
        lastError = error;

        if (attempt < retryPolicy.maxAttempts) {
          this.logger.warn(
            `[MCP Orchestrator] Step retry (${attempt}/${retryPolicy.maxAttempts}): ${step.stepId}`,
            { backoffMs, error: error.message }
          );

          // Wait before retry
          await this.sleep(backoffMs);
          backoffMs *= retryPolicy.backoffMultiplier;
        }
      }
    }

    throw lastError || new Error('Unknown error during step execution');
  }

  /**
   * Execute single orchestration step
   */
  private async executeStep(step: OrchestrationStep): Promise<ToolInvocationResponse> {
    const client = this.clientManager.getClient(step.serverId);
    if (!client) {
      throw new MCPError(
        'CLIENT_NOT_FOUND',
        `No client connected for server: ${step.serverId}`,
        404
      );
    }

    const invocationRequest: ToolInvocationRequest = {
      toolId: step.toolId,
      parameters: step.parameters || {},
      timeout: step.timeout,
      invokedBy: 'orchestrator',
      correlationId: `orch-${Date.now()}-${Math.random()}`,
    };

    return await client.invokeTool(invocationRequest);
  }

  /**
   * Evaluate conditional expression
   */
  private evaluateCondition(
    condition: string,
    executedSteps: Map<string, ToolInvocationResponse>
  ): boolean {
    try {
      // Build context object from executed steps
      const context: Record<string, any> = {};
      for (const [stepId, result] of executedSteps) {
        context[stepId] = result.result;
      }

      // Evaluate condition in safe context
      const func = new Function(...Object.keys(context), `return ${condition}`);
      return func(...Object.values(context)) === true;
    } catch (error) {
      this.logger.warn(`[MCP Orchestrator] Failed to evaluate condition: ${condition}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get workflow status
   */
  getWorkflowStatus(workflowId: string): OrchestrationResult | null {
    return this.activeWorkflows.get(workflowId) || null;
  }

  /**
   * Cancel workflow
   */
  cancelWorkflow(workflowId: string): void {
    this.activeWorkflows.delete(workflowId);
    this.logger.info(`[MCP Orchestrator] Workflow cancelled: ${workflowId}`);
  }

  /**
   * Get all active workflows
   */
  getActiveWorkflows(): OrchestrationResult[] {
    return Array.from(this.activeWorkflows.values());
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Workflow Builder
 * Fluent API for building orchestration workflows
 */
export class WorkflowBuilder {
  private request: OrchestrationRequest;

  constructor(workflowId: string, name: string) {
    this.request = {
      workflowId,
      name,
      steps: [],
      errorHandling: 'stop',
      timeout: 300000, // 5 minutes default
    };
  }

  /**
   * Add step to workflow
   */
  addStep(
    stepId: string,
    serverId: string,
    toolId: string,
    parameters?: Record<string, any>
  ): this {
    this.request.steps.push({
      stepId,
      serverId,
      toolId,
      parameters,
    });
    return this;
  }

  /**
   * Set error handling strategy
   */
  withErrorHandling(strategy: 'stop' | 'continue' | 'rollback'): this {
    this.request.errorHandling = strategy;
    return this;
  }

  /**
   * Set workflow timeout
   */
  withTimeout(ms: number): this {
    this.request.timeout = ms;
    return this;
  }

  /**
   * Add step retry policy
   */
  addRetry(stepId: string, maxAttempts: number, backoffMs: number): this {
    const step = this.request.steps.find((s) => s.stepId === stepId);
    if (step) {
      step.retryPolicy = {
        maxAttempts,
        backoffMs,
        backoffMultiplier: 2,
      };
    }
    return this;
  }

  /**
   * Build and return request
   */
  build(): OrchestrationRequest {
    return this.request;
  }
}

export { OrchestrationRequest, OrchestrationStep, OrchestrationResult };
