/**
 * MCP Controller
 * REST API endpoints for MCP server management and tool invocation
 */

import { Router, Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/logger';
import { MCPClientManager } from '../services/mcp-client.service';
import { mcpServerRegistryService } from '../services/mcp-registry.service';
import { MCPOrchestrator, WorkflowBuilder } from '../services/mcp-orchestrator.service';
import { ServerConnectionRequest, ToolInvocationRequest } from '../types/mcp.types';

export class MCPController {
  private router: Router;
  private clientManager: MCPClientManager;
  private orchestrator: MCPOrchestrator;
  private logger: Logger;

  constructor(clientManager: MCPClientManager) {
    this.router = Router();
    this.clientManager = clientManager;
    this.orchestrator = new MCPOrchestrator(clientManager);
    this.logger = Logger.getInstance();
    this.setupRoutes();
  }

  /**
   * Setup all routes
   */
  private setupRoutes(): void {
    // Server management endpoints
    this.router.post('/servers/connect', (req, res, next) => this.connectServer(req, res, next));
    this.router.post('/servers/disconnect', (req, res, next) => this.disconnectServer(req, res, next));
    this.router.get('/servers', (req, res, next) => this.listServers(req, res, next));
    this.router.get('/servers/:serverId', (req, res, next) => this.getServerInfo(req, res, next));
    this.router.get('/servers/:serverId/health', (req, res, next) =>
      this.checkServerHealth(req, res, next),
    );

    // Tool discovery endpoints
    this.router.get('/tools', (req, res, next) => this.listAllTools(req, res, next));
    this.router.get('/servers/:serverId/tools', (req, res, next) =>
      this.listServerTools(req, res, next),
    );
    this.router.get('/tools/:toolId', (req, res, next) => this.getTool(req, res, next));

    // Tool invocation endpoints
    this.router.post('/tools/:toolId/invoke', (req, res, next) => this.invokeTool(req, res, next));
    this.router.get('/invocations/:correlationId', (req, res, next) =>
      this.getInvocationStatus(req, res, next),
    );

    // Workflow orchestration endpoints
    this.router.post('/workflows', (req, res, next) => this.createWorkflow(req, res, next));
    this.router.get('/workflows/:workflowId', (req, res, next) =>
      this.getWorkflowStatus(req, res, next),
    );
    this.router.post('/workflows/:workflowId/cancel', (req, res, next) =>
      this.cancelWorkflow(req, res, next),
    );

    // Registry endpoints
    this.router.get('/registry/stats', (req, res, next) => this.getRegistryStats(req, res, next));
    this.router.get('/registry/search', (req, res, next) => this.searchRegistry(req, res, next));
  }

  /**
   * Connect to MCP server
   */
  private async connectServer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const connectionRequest: ServerConnectionRequest = req.body;

      this.logger.info(`[MCP Controller] Connecting to server: ${connectionRequest.serverName}`);

      const response = await this.clientManager.addServer(connectionRequest);

      res.status(200).json({
        success: true,
        data: response,
        message: 'Successfully connected to MCP server',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Disconnect from MCP server
   */
  private async disconnectServer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { serverId } = req.body;

      if (!serverId) {
        return res.status(400).json({
          success: false,
          error: 'serverId is required',
        });
      }

      this.logger.info(`[MCP Controller] Disconnecting server: ${serverId}`);

      await this.clientManager.removeServer(serverId);

      res.status(200).json({
        success: true,
        message: `Disconnected from server: ${serverId}`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List all connected servers
   */
  private async listServers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const servers = this.clientManager.getConnectedServers();

      res.status(200).json({
        success: true,
        data: servers,
        count: servers.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get server information
   */
  private async getServerInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { serverId } = req.params;
      const client = this.clientManager.getClient(serverId);

      if (!client) {
        return res.status(404).json({
          success: false,
          error: `Server not found: ${serverId}`,
        });
      }

      const serverInfo = client.getServerInfo();

      res.status(200).json({
        success: true,
        data: serverInfo,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check server health
   */
  private async checkServerHealth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { serverId } = req.params;
      const client = this.clientManager.getClient(serverId);

      if (!client) {
        return res.status(404).json({
          success: false,
          error: `Server not found: ${serverId}`,
        });
      }

      const isHealthy = client.isConnected();

      res.status(200).json({
        success: true,
        data: {
          serverId,
          isHealthy,
          status: isHealthy ? 'healthy' : 'unhealthy',
          timestamp: new Date(),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List all available tools
   */
  private async listAllTools(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const servers = this.clientManager.getConnectedServers();
      const allTools = servers.flatMap((server) =>
        server.tools.map((tool) => ({
          ...tool,
          serverId: server.id,
          serverName: server.name,
        })),
      );

      res.status(200).json({
        success: true,
        data: allTools,
        count: allTools.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List tools on specific server
   */
  private async listServerTools(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { serverId } = req.params;
      const client = this.clientManager.getClient(serverId);

      if (!client) {
        return res.status(404).json({
          success: false,
          error: `Server not found: ${serverId}`,
        });
      }

      const tools = await client.discoverTools();

      res.status(200).json({
        success: true,
        data: tools,
        count: tools.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get specific tool information
   */
  private async getTool(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { toolId } = req.params;
      const servers = this.clientManager.getConnectedServers();

      const tool = servers
        .flatMap((server) => server.tools.map((t) => ({ ...t, serverId: server.id })))
        .find((t) => t.id === toolId);

      if (!tool) {
        return res.status(404).json({
          success: false,
          error: `Tool not found: ${toolId}`,
        });
      }

      res.status(200).json({
        success: true,
        data: tool,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Invoke a tool
   */
  private async invokeTool(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { toolId } = req.params;
      const { serverId, parameters, timeout } = req.body;

      if (!serverId) {
        return res.status(400).json({
          success: false,
          error: 'serverId is required',
        });
      }

      const client = this.clientManager.getClient(serverId);
      if (!client) {
        return res.status(404).json({
          success: false,
          error: `Server not found: ${serverId}`,
        });
      }

      const invocationRequest: ToolInvocationRequest = {
        toolId,
        parameters: parameters || {},
        timeout,
        invokedBy: req.user?.id || 'anonymous',
      };

      const result = await client.invokeTool(invocationRequest);

      res.status(200).json({
        success: result.status === 'success',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get invocation status
   */
  private async getInvocationStatus(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { correlationId } = req.params;

      // TODO: Implement invocation tracking/status retrieval
      res.status(200).json({
        success: true,
        data: {
          correlationId,
          status: 'completed',
          message: 'Invocation tracking coming soon',
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create and execute workflow
   */
  private async createWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { workflowId, name, steps, errorHandling, timeout } = req.body;

      this.logger.info(`[MCP Controller] Creating workflow: ${name}`);

      const builder = new WorkflowBuilder(workflowId, name);

      for (const step of steps) {
        builder.addStep(step.stepId, step.serverId, step.toolId, step.parameters);

        if (step.retryPolicy) {
          builder.addRetry(step.stepId, step.retryPolicy.maxAttempts, step.retryPolicy.backoffMs);
        }
      }

      if (errorHandling) builder.withErrorHandling(errorHandling);
      if (timeout) builder.withTimeout(timeout);

      const workflowRequest = builder.build();
      const result = await this.orchestrator.executeWorkflow(workflowRequest);

      res.status(200).json({
        success: result.status === 'success' || result.status === 'partial',
        data: {
          workflowId: result.workflowId,
          status: result.status,
          summary: result.summary,
          executionTime: result.totalExecutionTime,
          steps: Array.from(result.executedSteps.entries()).map(([stepId, response]) => ({
            stepId,
            status: response.status,
            executionTime: response.executionTime,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get workflow status
   */
  private async getWorkflowStatus(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { workflowId } = req.params;
      const status = this.orchestrator.getWorkflowStatus(workflowId);

      if (!status) {
        return res.status(404).json({
          success: false,
          error: `Workflow not found: ${workflowId}`,
        });
      }

      res.status(200).json({
        success: true,
        data: {
          workflowId: status.workflowId,
          status: status.status,
          summary: status.summary,
          executionTime: status.totalExecutionTime,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cancel workflow
   */
  private async cancelWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { workflowId } = req.params;
      this.orchestrator.cancelWorkflow(workflowId);

      res.status(200).json({
        success: true,
        message: `Workflow cancelled: ${workflowId}`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get registry statistics
   */
  private async getRegistryStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stats = mcpServerRegistryService.getStatistics();

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Search registry
   */
  private async searchRegistry(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { query, type, category } = req.query;

      let results = mcpServerRegistryService.getAllServers();

      if (query) {
        results = mcpServerRegistryService.findByName(String(query));
      } else if (category) {
        results = mcpServerRegistryService.findByCategory(String(category) as any);
      }

      res.status(200).json({
        success: true,
        data: results,
        count: results.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get router
   */
  getRouter(): Router {
    return this.router;
  }
}

export default MCPController;
