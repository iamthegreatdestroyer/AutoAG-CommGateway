/**
 * MarketplaceController - REST API Layer for MCP Server Marketplace
 *
 * Exposes HTTP endpoints for all marketplace operations:
 * - Server registration and discovery
 * - Ratings and reviews
 * - Commission tracking and payouts
 * - Affiliate program management
 *
 * API Design:
 * - RESTful conventions
 * - JSON request/response bodies
 * - Proper HTTP status codes
 * - Comprehensive error handling
 * - Authentication middleware integration
 *
 * Base Path: /api/marketplace
 *
 * Copyright (c) 2026 AutoAG-CommGateway. All Rights Reserved.
 */

import { Request, Response } from 'express';
import {
  serverRegistryService,
  ServerCategory,
} from '../services/marketplace/server-registry.service';
import { ratingService } from '../services/marketplace/rating.service';
import { commissionService } from '../services/marketplace/commission.service';
import { JWTPayload } from '../services/auth.service';
import {
  ServerNotFoundError,
  InvalidServerError,
  UnauthorizedError as ServerUnauthorizedError,
} from '../services/marketplace/server-registry.service';
import {
  RatingNotFoundError,
  UnauthorizedRatingError,
  RateLimitError,
  InvalidRatingError,
} from '../services/marketplace/rating.service';
import {
  CommissionNotFoundError,
  InvalidCommissionError,
  PayoutError,
  AffiliateError,
} from '../services/marketplace/commission.service';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Extended Request with authenticated user
 */
interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
}

/**
 * API response wrapper
 */
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    timestamp: string;
    requestId?: string;
  };
}

// ============================================================================
// MARKETPLACE CONTROLLER CLASS
// ============================================================================

export class MarketplaceController {
  // ==========================================================================
  // SERVER REGISTRY ENDPOINTS
  // ==========================================================================

  /**
   * POST /api/marketplace/servers
   * Register a new MCP server
   *
   * @auth Required - Publisher role
   */
  public async registerServer(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json(this.errorResponse('UNAUTHORIZED', 'Authentication required'));
        return;
      }

      const registration = {
        ...req.body,
        publisherId: userId, // Ensure publisher is the authenticated user
      };

      const server = await serverRegistryService.registerServer(registration);

      res.status(201).json(
        this.successResponse(server, {
          message: 'Server registered successfully',
        })
      );
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * GET /api/marketplace/servers
   * Search and discover MCP servers
   */
  public async searchServers(req: Request, res: Response): Promise<void> {
    try {
      const {
        query,
        category,
        tags,
        minRating,
        page = '1',
        limit = '20',
        sortBy = 'trending',
      } = req.query;

      const searchQuery = {
        query: query as string,
        category: category as ServerCategory,
        tags: tags ? (tags as string).split(',') : undefined,
        minRating: minRating ? parseFloat(minRating as string) : undefined,
        page: parseInt(page as string, 10),
        limit: Math.min(parseInt(limit as string, 10), 100), // Max 100 per page
        sort: (sortBy as 'rating' | 'popular' | 'newest') || 'popular',
      };

      const results = await serverRegistryService.searchServers(searchQuery);

      res.json(this.successResponse(results));
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * GET /api/marketplace/servers/:id
   * Get server details by ID
   */
  public async getServerById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const server = await serverRegistryService.getServerById(id);

      res.json(this.successResponse(server));
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * PUT /api/marketplace/servers/:id
   * Update server information
   *
   * @auth Required - Publisher (owner) or Admin
   */
  public async updateServer(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json(this.errorResponse('UNAUTHORIZED', 'Authentication required'));
        return;
      }

      const { id } = req.params;
      const updates = req.body;

      const server = await serverRegistryService.updateServer(id, updates, userId);

      res.json(
        this.successResponse(server, {
          message: 'Server updated successfully',
        })
      );
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * DELETE /api/marketplace/servers/:id
   * Delete/deactivate server
   *
   * @auth Required - Publisher (owner) or Admin
   */
  public async deleteServer(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json(this.errorResponse('UNAUTHORIZED', 'Authentication required'));
        return;
      }

      const { id } = req.params;
      const { reason = 'Deleted via API' } = req.body;
      await serverRegistryService.deleteServer(id, userId, reason);

      res.json(
        this.successResponse(null, {
          message: 'Server deleted successfully',
        })
      );
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * GET /api/marketplace/servers/trending
   * Get trending servers
   */
  public async getTrendingServers(req: Request, res: Response): Promise<void> {
    try {
      const { timeframe = 'week', limit = '10' } = req.query;
      let trending = await serverRegistryService.getTrendingServers(
        timeframe as 'day' | 'week' | 'month'
      );

      // Limit results after fetching
      const limitNum = parseInt(limit as string, 10);
      if (limitNum > 0) {
        trending = trending.slice(0, limitNum);
      }

      res.json(this.successResponse(trending));
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * GET /api/marketplace/publishers/:publisherId/servers
   * Get all servers by publisher
   */
  public async getPublisherServers(req: Request, res: Response): Promise<void> {
    try {
      const { publisherId } = req.params;
      // Search servers - method needs proper implementation
      const results = await serverRegistryService.searchServers({
        query: publisherId,
        page: 1,
        limit: 100,
      });
      const servers = results.servers || [];

      res.json(this.successResponse(servers));
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * GET /api/marketplace/publishers/:publisherId/dashboard
   * Get publisher dashboard statistics
   *
   * @auth Required - Publisher (owner) or Admin
   */
  public async getPublisherDashboard(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json(this.errorResponse('UNAUTHORIZED', 'Authentication required'));
        return;
      }

      const { publisherId } = req.params;

      // Verify user is the publisher or admin
      if (userId !== publisherId && req.user?.role !== 'admin') {
        res.status(403).json(this.errorResponse('FORBIDDEN', 'Access denied'));
        return;
      }

      // Method not implemented yet
      res.status(501).json(this.errorResponse('NOT_IMPLEMENTED', 'Feature not yet available'));
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // ==========================================================================
  // RATING ENDPOINTS
  // ==========================================================================

  /**
   * POST /api/marketplace/ratings
   * Submit a rating for a server
   *
   * @auth Required
   */
  public async submitRating(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json(this.errorResponse('UNAUTHORIZED', 'Authentication required'));
        return;
      }

      const submission = {
        ...req.body,
        userId, // Ensure rating is from authenticated user
      };

      const rating = await ratingService.submitRating(submission);

      res.status(201).json(
        this.successResponse(rating, {
          message: 'Rating submitted successfully',
        })
      );
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * PUT /api/marketplace/ratings/:id
   * Update own rating
   *
   * @auth Required - Author only
   */
  public async updateRating(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json(this.errorResponse('UNAUTHORIZED', 'Authentication required'));
        return;
      }

      const { id } = req.params;
      const updates = req.body;

      const rating = await ratingService.updateRating(id, updates, userId);

      res.json(
        this.successResponse(rating, {
          message: 'Rating updated successfully',
        })
      );
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * DELETE /api/marketplace/ratings/:id
   * Delete own rating
   *
   * @auth Required - Author only
   */
  public async deleteRating(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json(this.errorResponse('UNAUTHORIZED', 'Authentication required'));
        return;
      }

      const { id } = req.params;
      await ratingService.deleteRating(id, userId);

      res.json(
        this.successResponse(null, {
          message: 'Rating deleted successfully',
        })
      );
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * GET /api/marketplace/servers/:serverId/ratings
   * Get ratings for a server
   */
  public async getServerRatings(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const {
        minStars,
        verified,
        hasReview,
        page = '1',
        limit = '20',
        sortBy = 'recent',
      } = req.query;

      const filters = {
        minStars: minStars ? parseInt(minStars as string, 10) : undefined,
        // RatingFilters treats `undefined` as "no filter applied" (see
        // RatingService#applyFilters, which gates every filter behind
        // `!== undefined`). Coercing an absent query param straight to
        // `false` — as this used to do — set filters.verified/hasReview to
        // the boolean false whenever the caller omitted them, which
        // `applyFilters` then treats as an active "only unverified /
        // only no-review" filter. That silently hid verified ratings (and
        // ratings with reviews) from the default, unfiltered listing.
        verified: verified === undefined ? undefined : verified === 'true',
        hasReview: hasReview === undefined ? undefined : hasReview === 'true',
      };

      const pagination = {
        page: parseInt(page as string, 10),
        limit: Math.min(parseInt(limit as string, 10), 50),
        sortBy: sortBy as 'recent' | 'helpful' | 'rating',
      };

      const results = await ratingService.getRatings(
        serverId,
        filters,
        pagination.page,
        pagination.limit
      );

      res.json(this.successResponse(results));
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * GET /api/marketplace/servers/:serverId/ratings/aggregate
   * Get aggregate rating statistics
   */
  public async getAggregateRating(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const aggregate = await ratingService.getAggregateRating(serverId);

      res.json(this.successResponse(aggregate));
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * POST /api/marketplace/ratings/:id/helpful
   * Mark rating as helpful
   *
   * @auth Required
   */
  public async markRatingHelpful(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json(this.errorResponse('UNAUTHORIZED', 'Authentication required'));
        return;
      }

      // Method not implemented yet
      res.status(501).json(this.errorResponse('NOT_IMPLEMENTED', 'Feature not yet available'));
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * POST /api/marketplace/ratings/:id/report
   * Report rating for moderation
   *
   * @auth Required
   */
  public async reportRating(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json(this.errorResponse('UNAUTHORIZED', 'Authentication required'));
        return;
      }

      const { id } = req.params;
      const { reason, details } = req.body;

      if (!reason) {
        res.status(400).json(this.errorResponse('MISSING_REASON', 'Report reason is required'));
        return;
      }

      await ratingService.reportRating({
        ratingId: id,
        reporterId: userId,
        reason,
        details,
      });

      res.json(
        this.successResponse(null, {
          message: 'Rating reported successfully',
        })
      );
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * POST /api/marketplace/ratings/:id/moderate
   * Moderate a reported rating
   *
   * @auth Required - Moderator or Admin
   */
  public async moderateRating(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      const userRole = req.user?.role;

      if (!userId || (userRole !== 'moderator' && userRole !== 'admin')) {
        res.status(403).json(this.errorResponse('FORBIDDEN', 'Moderator access required'));
        return;
      }

      const { id } = req.params;
      const { action, notes } = req.body;

      if (!action || !['approve', 'delete'].includes(action)) {
        res
          .status(400)
          .json(this.errorResponse('INVALID_ACTION', 'Action must be approve or delete'));
        return;
      }

      await ratingService.moderateRating(id, userId, action, notes);

      res.json(
        this.successResponse(null, {
          message: `Rating ${action}d successfully`,
        })
      );
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // ==========================================================================
  // COMMISSION ENDPOINTS
  // ==========================================================================

  /**
   * POST /api/marketplace/commissions
   * Record a commission (internal use, typically called by payment system)
   *
   * @auth Required - System or Admin
   */
  public async recordCommission(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { invokeId, serverId, publisherId, grossAmount, affiliateId } = req.body;

      if (!invokeId || !serverId || !publisherId || !grossAmount) {
        res.status(400).json(this.errorResponse('MISSING_FIELDS', 'Required fields missing'));
        return;
      }

      const commission = await commissionService.recordCommission(
        invokeId,
        serverId,
        publisherId,
        grossAmount,
        affiliateId
      );

      res.status(201).json(
        this.successResponse(commission, {
          message: 'Commission recorded successfully',
        })
      );
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * GET /api/marketplace/commissions/:id
   * Get commission details
   *
   * @auth Required - Publisher (owner) or Admin
   */
  public async getCommission(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json(this.errorResponse('UNAUTHORIZED', 'Authentication required'));
        return;
      }

      const { id } = req.params;
      const commission = await commissionService.getCommissionById(id);

      // Verify user is the publisher or admin
      if (commission.publisherId !== userId && req.user?.role !== 'admin') {
        res.status(403).json(this.errorResponse('FORBIDDEN', 'Access denied'));
        return;
      }

      res.json(this.successResponse(commission));
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * GET /api/marketplace/publishers/:publisherId/commissions
   * Get publisher's commissions
   *
   * @auth Required - Publisher (owner) or Admin
   */
  public async getPublisherCommissions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json(this.errorResponse('UNAUTHORIZED', 'Authentication required'));
        return;
      }

      const { publisherId } = req.params;
      const { status } = req.query;

      // Verify user is the publisher or admin
      if (publisherId !== userId && req.user?.role !== 'admin') {
        res.status(403).json(this.errorResponse('FORBIDDEN', 'Access denied'));
        return;
      }

      const commissions = await commissionService.getPublisherCommissions(
        publisherId,
        status as any
      );

      res.json(this.successResponse(commissions));
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * GET /api/marketplace/publishers/:publisherId/revenue
   * Get publisher revenue report
   *
   * @auth Required - Publisher (owner) or Admin
   */
  public async getPublisherRevenue(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json(this.errorResponse('UNAUTHORIZED', 'Authentication required'));
        return;
      }

      const { publisherId } = req.params;
      const { startDate, endDate, type = 'month' } = req.query;

      // Verify user is the publisher or admin
      if (publisherId !== userId && req.user?.role !== 'admin') {
        res.status(403).json(this.errorResponse('FORBIDDEN', 'Access denied'));
        return;
      }

      const start = startDate
        ? new Date(startDate as string)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      const revenue = await commissionService.generateRevenueReport(
        publisherId,
        start,
        end,
        type as any
      );

      res.json(this.successResponse(revenue));
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * POST /api/marketplace/payouts/schedule
   * Schedule automated payouts
   *
   * @auth Required - Admin or System
   */
  public async schedulePayouts(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userRole = req.user?.role;
      if (userRole !== 'admin') {
        res.status(403).json(this.errorResponse('FORBIDDEN', 'Admin access required'));
        return;
      }

      const batches = await commissionService.schedulePayouts();

      res.json(
        this.successResponse(batches, {
          message: `Scheduled ${batches.length} payout batches`,
        })
      );
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * POST /api/marketplace/payouts/:batchId/process
   * Process a payout batch
   *
   * @auth Required - Admin
   */
  public async processPayoutBatch(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userRole = req.user?.role;
      if (userRole !== 'admin') {
        res.status(403).json(this.errorResponse('FORBIDDEN', 'Admin access required'));
        return;
      }

      const { batchId } = req.params;
      const result = await commissionService.processPayoutBatch(batchId);

      if (result.success) {
        res.json(
          this.successResponse(result, {
            message: 'Payout processed successfully',
          })
        );
      } else {
        res.status(500).json(this.errorResponse('PAYOUT_FAILED', result.error || 'Payout failed'));
      }
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * GET /api/marketplace/publishers/:publisherId/payouts
   * Get publisher's payout history
   *
   * @auth Required - Publisher (owner) or Admin
   */
  public async getPublisherPayouts(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json(this.errorResponse('UNAUTHORIZED', 'Authentication required'));
        return;
      }

      const { publisherId } = req.params;

      // Verify user is the publisher or admin
      if (publisherId !== userId && req.user?.role !== 'admin') {
        res.status(403).json(this.errorResponse('FORBIDDEN', 'Access denied'));
        return;
      }

      const payouts = await commissionService.getPublisherPayouts(publisherId);

      res.json(this.successResponse(payouts));
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // ==========================================================================
  // AFFILIATE ENDPOINTS
  // ==========================================================================

  /**
   * POST /api/marketplace/affiliates/links
   * Create an affiliate link
   *
   * @auth Required
   */
  public async createAffiliateLink(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json(this.errorResponse('UNAUTHORIZED', 'Authentication required'));
        return;
      }

      const { serverId } = req.body;

      if (!serverId) {
        res.status(400).json(this.errorResponse('MISSING_SERVER_ID', 'Server ID is required'));
        return;
      }

      const link = await commissionService.createAffiliateLink(userId, serverId);

      res.status(201).json(
        this.successResponse(link, {
          message: 'Affiliate link created successfully',
        })
      );
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * POST /api/marketplace/affiliates/track/:code
   * Track affiliate click
   */
  public async trackAffiliateClick(req: Request, res: Response): Promise<void> {
    try {
      const { code } = req.params;
      await commissionService.trackAffiliateClick(code);

      res.json(
        this.successResponse(null, {
          message: 'Click tracked successfully',
        })
      );
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * GET /api/marketplace/affiliates/links/:code
   * Get affiliate link by code
   */
  public async getAffiliateLink(req: Request, res: Response): Promise<void> {
    try {
      const { code } = req.params;
      const link = await commissionService.getAffiliateLinkByCode(code);

      res.json(this.successResponse(link));
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * GET /api/marketplace/affiliates/:affiliateId/stats
   * Get affiliate performance statistics
   *
   * @auth Required - Affiliate (owner) or Admin
   */
  public async getAffiliateStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json(this.errorResponse('UNAUTHORIZED', 'Authentication required'));
        return;
      }

      const { affiliateId } = req.params;

      // Verify user is the affiliate or admin
      if (affiliateId !== userId && req.user?.role !== 'admin') {
        res.status(403).json(this.errorResponse('FORBIDDEN', 'Access denied'));
        return;
      }

      const stats = await commissionService.getAffiliateStats(affiliateId);

      res.json(this.successResponse(stats));
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // ==========================================================================
  // PLATFORM ANALYTICS ENDPOINTS
  // ==========================================================================

  /**
   * GET /api/marketplace/analytics/platform
   * Get platform-wide revenue analytics
   *
   * @auth Required - Admin
   */
  public async getPlatformAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userRole = req.user?.role;
      if (userRole !== 'admin') {
        res.status(403).json(this.errorResponse('FORBIDDEN', 'Admin access required'));
        return;
      }

      const { startDate, endDate } = req.query;

      const start = startDate
        ? new Date(startDate as string)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      const revenue = await commissionService.generatePlatformRevenueReport(start, end);

      res.json(this.successResponse(revenue));
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * GET /api/marketplace/health
   * Health check endpoint
   */
  public async healthCheck(_req: Request, res: Response): Promise<void> {
    try {
      const serverStats = serverRegistryService.getServiceStats();
      const ratingStats = ratingService.getServiceStats();
      const commissionStats = commissionService.getServiceStats();

      res.json(
        this.successResponse({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          services: {
            serverRegistry: {
              totalServers: serverStats.totalServers,
              activeServers: serverStats.activeServers,
            },
            ratings: {
              totalRatings: ratingStats.totalRatings,
              averageRating: ratingStats.averageRating,
            },
            commissions: {
              totalCommissions: commissionStats.totalCommissions,
              totalRevenue: commissionStats.totalGrossRevenue,
            },
          },
        })
      );
    } catch (error) {
      res.status(503).json(this.errorResponse('SERVICE_UNAVAILABLE', 'Health check failed'));
    }
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  /**
   * Create success response
   */
  private successResponse<T>(data: T, meta?: any): ApiResponse<T> {
    return {
      success: true,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        ...meta,
      },
    };
  }

  /**
   * Create error response
   */
  private errorResponse(code: string, message: string, details?: any): ApiResponse {
    return {
      success: false,
      error: {
        code,
        message,
        details,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Centralized error handler
   */
  private handleError(error: unknown, res: Response): void {
    console.error('MarketplaceController Error:', error);

    // ServerRegistry errors
    if (error instanceof ServerNotFoundError) {
      res.status(404).json(this.errorResponse('SERVER_NOT_FOUND', error.message));
      return;
    }
    if (error instanceof InvalidServerError) {
      res.status(400).json(this.errorResponse('INVALID_SERVER', error.message));
      return;
    }
    if (error instanceof ServerUnauthorizedError) {
      res.status(403).json(this.errorResponse('UNAUTHORIZED', error.message));
      return;
    }

    // Rating errors
    if (error instanceof RatingNotFoundError) {
      res.status(404).json(this.errorResponse('RATING_NOT_FOUND', error.message));
      return;
    }
    if (error instanceof UnauthorizedRatingError) {
      res.status(403).json(this.errorResponse('UNAUTHORIZED', error.message));
      return;
    }
    if (error instanceof RateLimitError) {
      res.status(429).json(this.errorResponse('RATE_LIMIT_EXCEEDED', error.message));
      return;
    }
    if (error instanceof InvalidRatingError) {
      res.status(400).json(this.errorResponse('VALIDATION_ERROR', error.message));
      return;
    }

    // Commission errors
    if (error instanceof CommissionNotFoundError) {
      res.status(404).json(this.errorResponse('COMMISSION_NOT_FOUND', error.message));
      return;
    }
    if (error instanceof InvalidCommissionError) {
      res.status(400).json(this.errorResponse('INVALID_COMMISSION', error.message));
      return;
    }
    if (error instanceof PayoutError) {
      res.status(500).json(this.errorResponse('PAYOUT_ERROR', error.message));
      return;
    }
    if (error instanceof AffiliateError) {
      res.status(400).json(this.errorResponse('AFFILIATE_ERROR', error.message));
      return;
    }

    // Generic error
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    res.status(500).json(this.errorResponse('INTERNAL_SERVER_ERROR', message));
  }
}

// ============================================================================
// EXPORT SINGLETON INSTANCE
// ============================================================================

export const marketplaceController = new MarketplaceController();
