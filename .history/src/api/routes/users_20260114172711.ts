import { Router, Request, Response } from 'express';
import { db } from '../../models/repositories';
import { authenticate, authorize } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { apiLimiter } from '../middleware/rateLimit';
import { UpdateUserSchema } from '../../models/validators';

const router = Router();

// Get current user profile
router.get('/me', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await db.users.findById(req.user!.userId);

    if (!user) {
      res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'User not found',
      });
      return;
    }

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        status: user.status,
        walletBalance: user.walletBalance,
        walletAddress: user.walletAddress,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
    });
  } catch (error: any) {
    console.error('Get profile error:', error);
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch profile',
    });
  }
});

// Update user profile
router.put(
  '/me',
  authenticate,
  apiLimiter,
  validateBody(UpdateUserSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const updated = await db.users.update(req.user!.userId, req.body);

      res.status(200).json({
        message: 'Profile updated successfully',
        user: {
          id: updated.id,
          email: updated.email,
          username: updated.username,
          firstName: updated.firstName,
          lastName: updated.lastName,
          role: updated.role,
          walletAddress: updated.walletAddress,
        },
      });
    } catch (error: any) {
      console.error('Update profile error:', error);
      res.status(500).json({
        error: 'UPDATE_FAILED',
        message: 'Failed to update profile',
      });
    }
  }
);

// Generate API key
router.post(
  '/me/api-key',
  authenticate,
  authorize('DEVELOPER', 'ADMIN', 'SUPER_ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const apiKey = await db.users.generateApiKey(req.user!.userId);

      res.status(201).json({
        message: 'API key generated successfully',
        apiKey,
      });
    } catch (error: any) {
      console.error('Generate API key error:', error);
      res.status(500).json({
        error: 'GENERATION_FAILED',
        message: 'Failed to generate API key',
      });
    }
  }
);

// Get wallet balance
router.get('/me/wallet', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await db.users.findById(req.user!.userId);

    if (!user) {
      res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'User not found',
      });
      return;
    }

    res.status(200).json({
      balance: user.walletBalance,
      walletAddress: user.walletAddress,
    });
  } catch (error: any) {
    console.error('Get wallet error:', error);
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch wallet information',
    });
  }
});

// Get user's transactions
router.get(
  '/me/transactions',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const transactions = await db.transactions.findByUser(req.user!.userId, {
        page,
        limit,
      });

      const total = await db.transactions.count({
        userId: req.user!.userId,
      });

      res.status(200).json({
        transactions,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error: any) {
      console.error('Get transactions error:', error);
      res.status(500).json({
        error: 'FETCH_FAILED',
        message: 'Failed to fetch transactions',
      });
    }
  }
);

// Get user's servers
router.get('/me/servers', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const servers = await db.mcpServers.findByOwner(req.user!.userId);

    res.status(200).json({ servers });
  } catch (error: any) {
    console.error('Get user servers error:', error);
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch servers',
    });
  }
});

// Admin: Get user by ID
router.get(
  '/:id',
  authenticate,
  authorize('ADMIN', 'SUPER_ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const user = await db.users.findById(id);

      if (!user) {
        res.status(404).json({
          error: 'USER_NOT_FOUND',
          message: 'User not found',
        });
        return;
      }

      res.status(200).json({ user });
    } catch (error: any) {
      console.error('Get user error:', error);
      res.status(500).json({
        error: 'FETCH_FAILED',
        message: 'Failed to fetch user',
      });
    }
  }
);

// Admin: Update user status
router.patch(
  '/:id/status',
  authenticate,
  authorize('ADMIN', 'SUPER_ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!['ACTIVE', 'SUSPENDED', 'BANNED'].includes(status)) {
        res.status(400).json({
          error: 'INVALID_STATUS',
          message: 'Invalid status value',
        });
        return;
      }

      const updated = await db.users.updateStatus(id, status);

      res.status(200).json({
        message: 'User status updated successfully',
        user: updated,
      });
    } catch (error: any) {
      console.error('Update user status error:', error);
      res.status(500).json({
        error: 'UPDATE_FAILED',
        message: 'Failed to update user status',
      });
    }
  }
);

export default router;
