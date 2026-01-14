import { Router, Request, Response } from 'express';
import { db } from '../../models/repositories';
import { authService } from '../../services/auth.service';
import { validateBody } from '../middleware/validate';
import { authLimiter } from '../middleware/rateLimit';
import {
  CreateUserSchema,
  LoginSchema,
} from '../../models/validators';

const router = Router();

// Register new user
router.post(
  '/register',
  authLimiter,
  validateBody(CreateUserSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password, username, firstName, lastName } = req.body;

      // Check if user already exists
      const existingEmail = await db.users.findByEmail(email);
      if (existingEmail) {
        res.status(409).json({
          error: 'EMAIL_EXISTS',
          message: 'Email address is already registered',
        });
        return;
      }

      const existingUsername = await db.users.findByUsername(username);
      if (existingUsername) {
        res.status(409).json({
          error: 'USERNAME_EXISTS',
          message: 'Username is already taken',
        });
        return;
      }

      // Create user
      const user = await db.users.createUser({
        email,
        password,
        username,
        firstName,
        lastName,
      });

      // Generate tokens
      const tokens = authService.generateTokens(user);

      res.status(201).json({
        message: 'User registered successfully',
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          createdAt: user.createdAt,
        },
        tokens,
      });
    } catch (error: any) {
      console.error('Registration error:', error);
      res.status(500).json({
        error: 'REGISTRATION_FAILED',
        message: 'Failed to register user',
      });
    }
  }
);

// Login
router.post(
  '/login',
  authLimiter,
  validateBody(LoginSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body;

      // Find user
      const user = await db.users.findByEmail(email);
      if (!user) {
        res.status(401).json({
          error: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
        return;
      }

      // Check status
      if (user.status !== 'ACTIVE') {
        res.status(403).json({
          error: 'ACCOUNT_DISABLED',
          message: `Account is ${user.status.toLowerCase()}`,
        });
        return;
      }

      // Verify password
      const isValidPassword = await db.users.verifyPassword(user, password);
      if (!isValidPassword) {
        res.status(401).json({
          error: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
        return;
      }

      // Update last login
      await db.users.updateLastLogin(user.id);

      // Generate tokens
      const tokens = authService.generateTokens(user);

      res.status(200).json({
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          walletBalance: user.walletBalance,
        },
        tokens,
      });
    } catch (error: any) {
      console.error('Login error:', error);
      res.status(500).json({
        error: 'LOGIN_FAILED',
        message: 'Failed to login',
      });
    }
  }
);

// Refresh token
router.post(
  '/refresh',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        res.status(400).json({
          error: 'MISSING_REFRESH_TOKEN',
          message: 'Refresh token is required',
        });
        return;
      }

      // Verify refresh token
      const payload = authService.verifyRefreshToken(refreshToken);

      // Find user
      const user = await db.users.findById(payload.userId);
      if (!user || user.status !== 'ACTIVE') {
        res.status(401).json({
          error: 'INVALID_REFRESH_TOKEN',
          message: 'Invalid or expired refresh token',
        });
        return;
      }

      // Generate new tokens
      const tokens = authService.generateTokens(user);

      res.status(200).json({
        message: 'Token refreshed successfully',
        tokens,
      });
    } catch (error: any) {
      console.error('Token refresh error:', error);
      res.status(401).json({
        error: 'REFRESH_FAILED',
        message: 'Failed to refresh token',
      });
    }
  }
);

// Logout (client-side only, invalidate tokens)
router.post('/logout', (req: Request, res: Response): void => {
  res.status(200).json({
    message: 'Logout successful',
  });
});

export default router;
