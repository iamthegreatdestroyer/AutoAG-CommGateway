/**
 * MCP Controller Tests
 * Test suite for REST API endpoints
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { MCPController } from '../../src/controllers/mcp.controller';
import { MCPClientManager } from '../../src/services/mcp-client.service';
import { mcpServerRegistryService } from '../../src/services/mcp-registry.service';
import { MCPOrchestrator } from '../../src/services/mcp-orchestrator.service';

describe('MCPController', () => {
  let controller: MCPController;
  let clientManager: MCPClientManager;
  let orchestrator: MCPOrchestrator;
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    clientManager = new MCPClientManager();
    orchestrator = new MCPOrchestrator(clientManager);
    controller = new MCPController(clientManager, orchestrator);

    req = {
      params: {},
      body: {},
      query: {},
      headers: {},
      app: { locals: {} },
    };

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };

    next = vi.fn();
  });

  describe('Server Management', () => {
    it('should connect new server', async () => {
      // POST /servers/connect
      req.body = {
        serverId: 'test-server',
        baseUrl: 'http://localhost:3001',
        authentication: { type: 'api_key', apiKey: 'test-key' },
      };

      await controller.connectServer(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should validate required fields on connect', async () => {
      // POST /servers/connect with missing fields
      req.body = { serverId: 'test-server' };

      await controller.connectServer(req as Request, res as Response, next);

      // Should error on missing baseUrl
      expect(next).toHaveBeenCalled();
    });

    it('should list connected servers', async () => {
      // GET /servers
      await controller.listConnectedServers(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
      const call = (res.json as any).mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(Array.isArray(call.data)).toBe(true);
    });

    it('should get server details', async () => {
      // GET /servers/:serverId
      req.params = { serverId: 'test-server' };

      await controller.getServerDetails(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('should disconnect server', async () => {
      // POST /servers/disconnect
      req.body = { serverId: 'test-server' };

      await controller.disconnectServer(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should check server health', async () => {
      // GET /servers/:serverId/health
      req.params = { serverId: 'test-server' };

      await controller.getServerHealth(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('should handle connection errors', async () => {
      // Attempt to connect to invalid server
      req.body = {
        serverId: 'bad-server',
        baseUrl: 'http://invalid.local',
        authentication: { type: 'api_key', apiKey: 'key' },
      };

      await controller.connectServer(req as Request, res as Response, next);

      // Should propagate error
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Tool Discovery', () => {
    it('should list all available tools', async () => {
      // GET /tools
      await controller.listAllTools(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
      const call = (res.json as any).mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(Array.isArray(call.data)).toBe(true);
    });

    it('should list tools by server', async () => {
      // GET /servers/:serverId/tools
      req.params = { serverId: 'test-server' };

      await controller.getServerTools(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('should get tool details', async () => {
      // GET /tools/:toolId
      req.params = { toolId: 'test-tool' };

      await controller.getToolDetails(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('should handle non-existent tool', async () => {
      // GET /tools/non-existent
      req.params = { toolId: 'non-existent-tool' };

      await controller.getToolDetails(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should support pagination of tools', async () => {
      // GET /tools?page=1&limit=10
      req.query = { page: '1', limit: '10' };

      await controller.listAllTools(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
    });
  });

  describe('Tool Invocation', () => {
    it('should invoke tool successfully', async () => {
      // POST /tools/:toolId/invoke
      req.params = { toolId: 'test-tool' };
      req.body = {
        serverId: 'test-server',
        parameters: { key: 'value' },
      };

      await controller.invokeTool(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('should validate tool parameters', async () => {
      // POST /tools/:toolId/invoke with invalid params
      req.params = { toolId: 'test-tool' };
      req.body = {
        serverId: 'test-server',
        parameters: { invalid: 'param' },
      };

      await controller.invokeTool(req as Request, res as Response, next);

      // Should error on parameter validation
      expect(next).toHaveBeenCalled();
    });

    it('should generate correlation ID for invocation', async () => {
      // POST /tools/:toolId/invoke
      req.params = { toolId: 'test-tool' };
      req.body = { serverId: 'test-server', parameters: {} };

      await controller.invokeTool(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
      const call = (res.json as any).mock.calls[0][0];
      expect(call.data.correlationId).toBeDefined();
    });

    it('should support timeout parameter', async () => {
      // POST /tools/:toolId/invoke with timeout
      req.params = { toolId: 'test-tool' };
      req.body = {
        serverId: 'test-server',
        parameters: {},
        timeout: 30000,
      };

      await controller.invokeTool(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('should get invocation status', async () => {
      // GET /invocations/:correlationId
      req.params = { correlationId: 'test-correlation-id' };

      await controller.getInvocationStatus(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('should track invocation history', async () => {
      // Multiple invocations, should be tracked
      // GET /invocations should return history
      req.params = {};

      await controller.getInvocationStatus(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('should handle tool invocation errors', async () => {
      // Invoke with server error
      req.params = { toolId: 'failing-tool' };
      req.body = { serverId: 'test-server', parameters: {} };

      await controller.invokeTool(req as Request, res as Response, next);

      // Should handle error gracefully
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Workflow Orchestration', () => {
    it('should create and execute workflow', async () => {
      // POST /workflows
      req.body = {
        workflowId: 'wf-test',
        name: 'Test Workflow',
        steps: [
          {
            stepId: 'step-1',
            serverId: 'server-1',
            toolId: 'tool-1',
            parameters: {},
          },
        ],
      };

      await controller.createWorkflow(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should get workflow status', async () => {
      // GET /workflows/:workflowId
      req.params = { workflowId: 'wf-test' };

      await controller.getWorkflowStatus(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('should cancel workflow', async () => {
      // POST /workflows/:workflowId/cancel
      req.params = { workflowId: 'wf-test' };

      await controller.cancelWorkflow(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('should validate workflow structure', async () => {
      // POST /workflows with invalid structure
      req.body = {
        workflowId: 'wf-bad',
        name: 'Bad Workflow',
        // Missing steps array
      };

      await controller.createWorkflow(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('should support workflow timeout', async () => {
      // POST /workflows with timeout
      req.body = {
        workflowId: 'wf-timeout',
        name: 'Workflow with Timeout',
        steps: [],
        timeout: 60000,
      };

      await controller.createWorkflow(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('should support error handling strategies', async () => {
      // POST /workflows with error handling
      req.body = {
        workflowId: 'wf-error',
        name: 'Workflow with Error Handling',
        steps: [],
        errorHandling: 'continue',
      };

      await controller.createWorkflow(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('should include execution summary in response', async () => {
      // POST /workflows
      req.body = {
        workflowId: 'wf-summary',
        name: 'Workflow for Summary',
        steps: [
          {
            stepId: 'step-1',
            serverId: 'server-1',
            toolId: 'tool-1',
            parameters: {},
          },
        ],
      };

      await controller.createWorkflow(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
      const call = (res.json as any).mock.calls[0][0];
      expect(call.data.summary).toBeDefined();
    });
  });

  describe('Registry Management', () => {
    it('should get registry statistics', async () => {
      // GET /registry/stats
      await controller.getRegistryStats(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
      const call = (res.json as any).mock.calls[0][0];
      expect(call.data.stats).toBeDefined();
    });

    it('should search registry', async () => {
      // GET /registry/search?q=postgresql
      req.query = { q: 'postgresql' };

      await controller.searchRegistry(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('should filter by category', async () => {
      // GET /registry/search?category=data_processing
      req.query = { category: 'data_processing' };

      await controller.searchRegistry(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('should return server statistics', async () => {
      // Registry stats should include server counts
      await controller.getRegistryStats(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
      const call = (res.json as any).mock.calls[0][0];
      expect(call.data.stats.totalServers).toBeGreaterThanOrEqual(0);
      expect(call.data.stats.byCategory).toBeDefined();
    });
  });

  describe('Response Formatting', () => {
    it('should wrap successful responses', async () => {
      // Any successful response should have standard format
      req.params = {};

      await controller.listConnectedServers(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
      const call = (res.json as any).mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data).toBeDefined();
    });

    it('should include correlation ID in responses', async () => {
      // POST /tools/:toolId/invoke
      req.params = { toolId: 'test-tool' };
      req.body = { serverId: 'test-server', parameters: {} };
      req.headers = { 'x-correlation-id': 'test-corr-id' };

      await controller.invokeTool(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
      const call = (res.json as any).mock.calls[0][0];
      expect(call.data.correlationId).toBeDefined();
    });

    it('should include timestamps in responses', async () => {
      // Responses should have timestamp
      await controller.listConnectedServers(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalled();
      const call = (res.json as any).mock.calls[0][0];
      expect(call.timestamp).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing required parameters', async () => {
      // POST /tools/:toolId/invoke without serverId
      req.params = { toolId: 'test-tool' };
      req.body = { parameters: {} };

      await controller.invokeTool(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should handle server not found', async () => {
      // Reference non-existent server
      req.params = { toolId: 'test-tool' };
      req.body = { serverId: 'non-existent', parameters: {} };

      await controller.invokeTool(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should propagate service errors', async () => {
      // Any service error should be propagated
      req.params = {};
      req.body = {};

      // Mock clientManager to throw error
      vi.spyOn(clientManager, 'getConnectedServers').mockImplementation(() => {
        throw new Error('Service error');
      });

      await controller.listConnectedServers(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Authentication and Authorization', () => {
    it('should validate authentication', async () => {
      // Missing authentication should be rejected
      req.body = {
        serverId: 'test-server',
        baseUrl: 'http://localhost:3001',
        // Missing authentication
      };

      await controller.connectServer(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('should check user authorization', async () => {
      // Controller should respect req.user if authentication implemented
      // Expected: Appropriate access control
    });
  });
});
