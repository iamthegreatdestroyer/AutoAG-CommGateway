import { Router, Request, Response } from 'express';
import { db } from '../../models/repositories';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { validateBody, validateQuery } from '../middleware/validate';
import { createServerLimiter, apiLimiter } from '../middleware/rateLimit';
import {
  CreateMCPServerSchema,
  UpdateMCPServerSchema,
  MCPServerQuerySchema,
} from '../../models/validators';

const router = Router();

// Search/List servers (public)
router.get(
  '/',
  optionalAuth,
  validateQuery(MCPServerQuerySchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const query = req.query as any;

      const result = await db.mcpServers.search({
        search: query.search,
        category: query.category,
        status: query.status,
        visibility: query.visibility,
        page: query.page,
        limit: query.limit,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      });

      res.status(200).json({
        servers: result.servers,
        pagination: {
          page: query.page,
          limit: query.limit,
          total: result.total,
          pages: Math.ceil(result.total / query.limit),
        },
      });
    } catch (error: any) {
      console.error('Server search error:', error);
      res.status(500).json({
        error: 'SEARCH_FAILED',
        message: 'Failed to search servers',
      });
    }
  }
);

// Get top servers
router.get('/top', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const servers = await db.mcpServers.getTopServers(limit);

    res.status(200).json({ servers });
  } catch (error: any) {
    console.error('Get top servers error:', error);
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch top servers',
    });
  }
});

// Get server by ID (public)
router.get('/:id', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const server = await db.mcpServers.findById(id);
    if (!server) {
      res.status(404).json({
        error: 'SERVER_NOT_FOUND',
        message: 'Server not found',
      });
      return;
    }

    // Check if user has access to private servers
    if (server.visibility === 'PRIVATE') {
      if (!req.user || (server.ownerId !== req.user.userId && req.user.role !== 'ADMIN')) {
        res.status(404).json({
          error: 'SERVER_NOT_FOUND',
          message: 'Server not found',
        });
        return;
      }
    }

    res.status(200).json({ server });
  } catch (error: any) {
    console.error('Get server error:', error);
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch server',
    });
  }
});

// Create server (requires DEVELOPER or ADMIN role)
router.post(
  '/',
  authenticate,
  authorize('DEVELOPER', 'ADMIN', 'SUPER_ADMIN'),
  createServerLimiter,
  validateBody(CreateMCPServerSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const serverData = {
        ...req.body,
        ownerId: req.user!.userId,
      };

      // Check for duplicate name
      const existing = await db.mcpServers.findByName(req.user!.userId, serverData.name);
      if (existing) {
        res.status(409).json({
          error: 'SERVER_EXISTS',
          message: 'Server with this name already exists',
        });
        return;
      }

      const server = await db.mcpServers.create(serverData);

      res.status(201).json({
        message: 'Server created successfully',
        server,
      });
    } catch (error: any) {
      console.error('Create server error:', error);
      res.status(500).json({
        error: 'CREATE_FAILED',
        message: 'Failed to create server',
      });
    }
  }
);

// Update server (owner or admin only)
router.put(
  '/:id',
  authenticate,
  apiLimiter,
  validateBody(UpdateMCPServerSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const server = await db.mcpServers.findById(id);
      if (!server) {
        res.status(404).json({
          error: 'SERVER_NOT_FOUND',
          message: 'Server not found',
        });
        return;
      }

      // Check ownership
      if (
        server.ownerId !== req.user!.userId &&
        req.user!.role !== 'ADMIN' &&
        req.user!.role !== 'SUPER_ADMIN'
      ) {
        res.status(403).json({
          error: 'FORBIDDEN',
          message: 'You do not have permission to update this server',
        });
        return;
      }

      const updated = await db.mcpServers.update(id, req.body);

      res.status(200).json({
        message: 'Server updated successfully',
        server: updated,
      });
    } catch (error: any) {
      console.error('Update server error:', error);
      res.status(500).json({
        error: 'UPDATE_FAILED',
        message: 'Failed to update server',
      });
    }
  }
);

// Delete server (owner or admin only)
router.delete('/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const server = await db.mcpServers.findById(id);
    if (!server) {
      res.status(404).json({
        error: 'SERVER_NOT_FOUND',
        message: 'Server not found',
      });
      return;
    }

    // Check ownership
    if (
      server.ownerId !== req.user!.userId &&
      req.user!.role !== 'ADMIN' &&
      req.user!.role !== 'SUPER_ADMIN'
    ) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'You do not have permission to delete this server',
      });
      return;
    }

    await db.mcpServers.delete(id);

    res.status(200).json({
      message: 'Server deleted successfully',
    });
  } catch (error: any) {
    console.error('Delete server error:', error);
    res.status(500).json({
      error: 'DELETE_FAILED',
      message: 'Failed to delete server',
    });
  }
});

// Publish server (change from PENDING to ACTIVE)
router.post(
  '/:id/publish',
  authenticate,
  authorize('DEVELOPER', 'ADMIN', 'SUPER_ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const server = await db.mcpServers.findById(id);
      if (!server) {
        res.status(404).json({
          error: 'SERVER_NOT_FOUND',
          message: 'Server not found',
        });
        return;
      }

      // Check ownership
      if (
        server.ownerId !== req.user!.userId &&
        req.user!.role !== 'ADMIN' &&
        req.user!.role !== 'SUPER_ADMIN'
      ) {
        res.status(403).json({
          error: 'FORBIDDEN',
          message: 'You do not have permission to publish this server',
        });
        return;
      }

      // Only PENDING servers can be published
      if (server.status !== 'PENDING') {
        res.status(400).json({
          error: 'INVALID_STATUS',
          message: 'Only pending servers can be published',
        });
        return;
      }

      const updated = await db.mcpServers.updateStatus(id, 'ACTIVE');

      res.status(200).json({
        message: 'Server published successfully',
        server: updated,
      });
    } catch (error: any) {
      console.error('Publish server error:', error);
      res.status(500).json({
        error: 'PUBLISH_FAILED',
        message: 'Failed to publish server',
      });
    }
  }
);

// Get servers by owner
router.get('/owner/:userId', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    // Only allow viewing own servers unless admin
    if (
      userId !== req.user!.userId &&
      req.user!.role !== 'ADMIN' &&
      req.user!.role !== 'SUPER_ADMIN'
    ) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'You do not have permission to view these servers',
      });
      return;
    }

    const servers = await db.mcpServers.findByOwner(userId);

    res.status(200).json({ servers });
  } catch (error: any) {
    console.error('Get owner servers error:', error);
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch servers',
    });
  }
});

export default router;
