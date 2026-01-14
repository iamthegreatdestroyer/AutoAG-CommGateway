import { Request, Response, NextFunction } from 'express';
import { authService, JWTPayload } from '../../services/auth.service';
import { db } from '../../models/repositories';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = authService.extractTokenFromHeader(req.headers.authorization);

    if (!token) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
      return;
    }

    const payload = authService.verifyAccessToken(token);

    // Verify user still exists and is active
    const user = await db.users.findById(payload.userId);
    if (!user || user.status !== 'ACTIVE') {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'User not found or inactive',
      });
      return;
    }

    req.user = payload;
    next();
  } catch (error: any) {
    if (error.message === 'ACCESS_TOKEN_EXPIRED') {
      res.status(401).json({
        error: 'TOKEN_EXPIRED',
        message: 'Access token has expired',
      });
      return;
    }

    res.status(401).json({
      error: 'INVALID_TOKEN',
      message: 'Invalid authentication token',
    });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Insufficient permissions',
      });
      return;
    }

    next();
  };
};

export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const token = authService.extractTokenFromHeader(req.headers.authorization);

  if (token) {
    try {
      const payload = authService.verifyAccessToken(token);
      req.user = payload;
    } catch (error) {
      // Silently fail for optional auth
    }
  }

  next();
};
