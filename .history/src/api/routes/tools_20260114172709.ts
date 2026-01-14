import { Router, Request, Response } from 'express';
import { db } from '../../models/repositories';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { invocationLimiter, apiLimiter } from '../middleware/rateLimit';
import {
  CreateToolSchema,
  UpdateToolSchema,
  ToolInvocationSchema,
} from '../../models/validators';

const router = Router();

// Get tools for a server
router.get(
  '/server/:serverId',
  optionalAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { serverId } = req.params;

      // Verify server exists and is accessible
      const server = await db.mcpServers.findById(serverId);
      if (!server) {
        res.status(404).json({
          error: 'SERVER_NOT_FOUND',
          message: 'Server not found',
        });
        return;
      }

      // Check access for private servers
      if (server.visibility === 'PRIVATE') {
        if (!req.user || (server.ownerId !== req.user.userId && req.user.role !== 'ADMIN')) {
          res.status(404).json({
            error: 'SERVER_NOT_FOUND',
            message: 'Server not found',
          });
          return;
        }
      }

      const tools = await db.tools.findByServer(serverId);

      res.status(200).json({ tools });
    } catch (error: any) {
      console.error('Get tools error:', error);
      res.status(500).json({
        error: 'FETCH_FAILED',
        message: 'Failed to fetch tools',
      });
    }
  }
);

// Get tool by ID
router.get('/:id', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const tool = await db.tools.findById(id);
    if (!tool) {
      res.status(404).json({
        error: 'TOOL_NOT_FOUND',
        message: 'Tool not found',
      });
      return;
    }

    // Check server visibility
    const server = await db.mcpServers.findById(tool.serverId);
    if (server && server.visibility === 'PRIVATE') {
      if (!req.user || (server.ownerId !== req.user.userId && req.user.role !== 'ADMIN')) {
        res.status(404).json({
          error: 'TOOL_NOT_FOUND',
          message: 'Tool not found',
        });
        return;
      }
    }

    res.status(200).json({ tool });
  } catch (error: any) {
    console.error('Get tool error:', error);
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch tool',
    });
  }
});

// Create tool (server owner only)
router.post(
  '/',
  authenticate,
  authorize('DEVELOPER', 'ADMIN', 'SUPER_ADMIN'),
  apiLimiter,
  validateBody(CreateToolSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { serverId, ...toolData } = req.body;

      // Verify server ownership
      const server = await db.mcpServers.findById(serverId);
      if (!server) {
        res.status(404).json({
          error: 'SERVER_NOT_FOUND',
          message: 'Server not found',
        });
        return;
      }

      if (server.ownerId !== req.user!.userId && req.user!.role !== 'ADMIN' && req.user!.role !== 'SUPER_ADMIN') {
        res.status(403).json({
          error: 'FORBIDDEN',
          message: 'You do not have permission to add tools to this server',
        });
        return;
      }

      // Check for duplicate name
      const existing = await db.tools.findByName(serverId, toolData.name);
      if (existing) {
        res.status(409).json({
          error: 'TOOL_EXISTS',
          message: 'Tool with this name already exists on this server',
        });
        return;
      }

      const tool = await db.tools.create({ serverId, ...toolData });

      res.status(201).json({
        message: 'Tool created successfully',
        tool,
      });
    } catch (error: any) {
      console.error('Create tool error:', error);
      res.status(500).json({
        error: 'CREATE_FAILED',
        message: 'Failed to create tool',
      });
    }
  }
);

// Update tool (server owner only)
router.put(
  '/:id',
  authenticate,
  apiLimiter,
  validateBody(UpdateToolSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const tool = await db.tools.findById(id);
      if (!tool) {
        res.status(404).json({
          error: 'TOOL_NOT_FOUND',
          message: 'Tool not found',
        });
        return;
      }

      // Verify server ownership
      const server = await db.mcpServers.findById(tool.serverId);
      if (!server) {
        res.status(404).json({
          error: 'SERVER_NOT_FOUND',
          message: 'Server not found',
        });
        return;
      }

      if (server.ownerId !== req.user!.userId && req.user!.role !== 'ADMIN' && req.user!.role !== 'SUPER_ADMIN') {
        res.status(403).json({
          error: 'FORBIDDEN',
          message: 'You do not have permission to update this tool',
        });
        return;
      }

      const updated = await db.tools.update(id, req.body);

      res.status(200).json({
        message: 'Tool updated successfully',
        tool: updated,
      });
    } catch (error: any) {
      console.error('Update tool error:', error);
      res.status(500).json({
        error: 'UPDATE_FAILED',
        message: 'Failed to update tool',
      });
    }
  }
);

// Delete tool (server owner only)
router.delete(
  '/:id',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const tool = await db.tools.findById(id);
      if (!tool) {
        res.status(404).json({
          error: 'TOOL_NOT_FOUND',
          message: 'Tool not found',
        });
        return;
      }

      // Verify server ownership
      const server = await db.mcpServers.findById(tool.serverId);
      if (!server) {
        res.status(404).json({
          error: 'SERVER_NOT_FOUND',
          message: 'Server not found',
        });
        return;
      }

      if (server.ownerId !== req.user!.userId && req.user!.role !== 'ADMIN' && req.user!.role !== 'SUPER_ADMIN') {
        res.status(403).json({
          error: 'FORBIDDEN',
          message: 'You do not have permission to delete this tool',
        });
        return;
      }

      await db.tools.delete(id);

      res.status(200).json({
        message: 'Tool deleted successfully',
      });
    } catch (error: any) {
      console.error('Delete tool error:', error);
      res.status(500).json({
        error: 'DELETE_FAILED',
        message: 'Failed to delete tool',
      });
    }
  }
);

// Invoke tool (authenticated users)
router.post(
  '/:id/invoke',
  authenticate,
  invocationLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { inputData } = req.body;

      const tool = await db.tools.findById(id);
      if (!tool) {
        res.status(404).json({
          error: 'TOOL_NOT_FOUND',
          message: 'Tool not found',
        });
        return;
      }

      // Check server status
      const server = await db.mcpServers.findById(tool.serverId);
      if (!server || server.status !== 'ACTIVE') {
        res.status(503).json({
          error: 'SERVER_UNAVAILABLE',
          message: 'Server is currently unavailable',
        });
        return;
      }

      // TODO: Phase 4 - Actual tool invocation logic
      // For now, just create an invocation record
      const startTime = new Date();

      // Simulate tool execution (placeholder)
      const outputData = {
        status: 'success',
        message: 'Tool invocation placeholder - implement in Phase 4',
        input: inputData,
      };

      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();

      // Track metrics
      await db.tools.incrementCallCount(id);
      await db.tools.updateMetrics(id, durationMs, true);
      await db.mcpServers.incrementCallCount(server.id);

      res.status(200).json({
        message: 'Tool invoked successfully',
        result: {
          toolId: id,
          inputData,
          outputData,
          durationMs,
          timestamp: new Date(),
        },
      });
    } catch (error: any) {
      console.error('Tool invocation error:', error);
      res.status(500).json({
        error: 'INVOCATION_FAILED',
        message: 'Failed to invoke tool',
      });
    }
  }
);

// Get popular tools
router.get('/popular/list', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const tools = await db.tools.getPopularTools(limit);

    res.status(200).json({ tools });
  } catch (error: any) {
    console.error('Get popular tools error:', error);
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch popular tools',
    });
  }
});

export default router;
