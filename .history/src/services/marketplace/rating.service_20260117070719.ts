/**
 * RatingService - Review and Reputation Management
 *
 * Handles user ratings, reviews, and reputation tracking for MCP servers.
 * Implements weighted reputation algorithm with recency bias.
 *
 * Features:
 * - 1-5 star ratings with optional reviews
 * - Weighted reputation algorithm with time decay
 * - Anti-spam protection (rate limiting)
 * - Review verification (purchase required)
 * - Moderation system
 * - Automatic ServerRegistry statistics updates
 *
 * Copyright (c) 2026 AutoAG-CommGateway. All Rights Reserved.
 */

import { EventEmitter } from 'events';
import { serverRegistryService } from './server-registry.service';

// ============================================================================
// INTERFACES & TYPES
// ============================================================================

/**
 * Rating record
 */
export interface Rating {
  id: string;
  toolId: string;
  userId: string;
  stars: 1 | 2 | 3 | 4 | 5;
  review?: string;
  verified: boolean; // User purchased/used the tool
  helpful: number; // Helpful votes count
  reported: boolean; // Flagged for moderation
  moderatorReviewed: boolean;
  moderatorNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Rating submission request
 */
export interface RatingSubmission {
  toolId: string;
  userId: string;
  stars: 1 | 2 | 3 | 4 | 5;
  review?: string;
  verified: boolean;
}

/**
 * Rating update request
 */
export interface RatingUpdate {
  stars?: 1 | 2 | 3 | 4 | 5;
  review?: string;
}

/**
 * Aggregate rating statistics
 */
export interface AggregateRating {
  toolId: string;
  averageRating: number; // Weighted average
  simpleAverage: number; // Unweighted average
  totalRatings: number;
  totalReviews: number; // Ratings with text reviews
  distribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
  recencyWeight: number; // Current decay factor
  lastUpdated: Date;
}

/**
 * Rating filters for queries
 */
export interface RatingFilters {
  minStars?: number;
  maxStars?: number;
  verified?: boolean;
  hasReview?: boolean;
  reported?: boolean;
}

/**
 * Paginated rating results
 */
export interface RatingPage {
  ratings: Rating[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Report reason types
 */
export enum ReportReason {
  SPAM = 'spam',
  OFFENSIVE = 'offensive',
  FAKE = 'fake',
  IRRELEVANT = 'irrelevant',
  OTHER = 'other',
}

/**
 * Report submission
 */
export interface RatingReport {
  ratingId: string;
  reporterId: string;
  reason: ReportReason;
  details?: string;
}

// ============================================================================
// ERROR CLASSES
// ============================================================================

export class RatingError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'RatingError';
  }
}

export class RatingNotFoundError extends RatingError {
  constructor(ratingId: string) {
    super(`Rating not found: ${ratingId}`, 'RATING_NOT_FOUND', 404);
  }
}

export class DuplicateRatingError extends RatingError {
  constructor() {
    super('User has already rated this tool', 'DUPLICATE_RATING', 409);
  }
}

export class UnauthorizedRatingError extends RatingError {
  constructor(message: string = 'Unauthorized to modify this rating') {
    super(message, 'UNAUTHORIZED', 403);
  }
}

export class InvalidRatingError extends RatingError {
  constructor(message: string) {
    super(message, 'INVALID_RATING', 400);
  }
}

export class RateLimitError extends RatingError {
  constructor() {
    super('Rate limit exceeded for rating submissions', 'RATE_LIMIT', 429);
  }
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Reputation Algorithm
  RECENCY_DECAY_LAMBDA: Math.log(2) / 30, // Half-life of 30 days
  MIN_RATINGS_FOR_DISPLAY: 3,

  // Rate Limiting
  MAX_RATINGS_PER_HOUR: 5,
  MAX_REPORTS_PER_DAY: 10,

  // Validation
  MIN_REVIEW_LENGTH: 10,
  MAX_REVIEW_LENGTH: 1000,

  // Pagination
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,

  // Cache
  CACHE_TTL_MINUTES: 15,
  AGGREGATE_CACHE_TTL_MINUTES: 30,
};

// ============================================================================
// RATING SERVICE
// ============================================================================

export class RatingService extends EventEmitter {
  private static instance: RatingService;

  // Storage
  private ratings: Map<string, Rating>;
  private toolRatings: Map<string, Set<string>>;
  private userRatings: Map<string, Set<string>>;
  private userToolRatings: Map<string, Map<string, string>>; // userId → toolId → ratingId

  // Rate limiting
  private userRatingTimestamps: Map<string, number[]>;
  private userReportTimestamps: Map<string, number[]>;

  // Cache
  private cache: Map<string, { data: unknown; expiry: number }>;

  private constructor() {
    super();
    this.ratings = new Map();
    this.toolRatings = new Map();
    this.userRatings = new Map();
    this.userToolRatings = new Map();
    this.userRatingTimestamps = new Map();
    this.userReportTimestamps = new Map();
    this.cache = new Map();
  }

  public static getInstance(): RatingService {
    if (!RatingService.instance) {
      RatingService.instance = new RatingService();
    }
    return RatingService.instance;
  }

  // ==========================================================================
  // RATING SUBMISSION & MANAGEMENT
  // ==========================================================================

  /**
   * Submit a new rating for a tool
   */
  public async submitRating(submission: RatingSubmission): Promise<Rating> {
    // Validate submission
    this.validateRatingSubmission(submission);

    // Check rate limiting
    this.checkRateLimit(submission.userId);

    // Check for duplicate rating
    const existingRatingId = this.userToolRatings.get(submission.userId)?.get(submission.toolId);
    if (existingRatingId) {
      throw new DuplicateRatingError();
    }

    // Verify tool exists
    try {
      await serverRegistryService.getServerById(submission.toolId);
    } catch (error) {
      throw new InvalidRatingError(`Tool not found: ${submission.toolId}`);
    }

    // Create rating record
    const rating: Rating = {
      id: this.generateRatingId(),
      toolId: submission.toolId,
      userId: submission.userId,
      stars: submission.stars,
      review: submission.review,
      verified: submission.verified,
      helpful: 0,
      reported: false,
      moderatorReviewed: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Store rating
    this.ratings.set(rating.id, rating);

    // Update indices
    this.indexRating(rating);

    // Record timestamp for rate limiting
    this.recordRatingTimestamp(submission.userId);

    // Update aggregate statistics
    await this.updateAggregateRating(submission.toolId);

    // Clear caches
    this.clearCaches(['rating', 'aggregate']);

    // Emit event
    this.emit('rating:submitted', {
      ratingId: rating.id,
      toolId: rating.toolId,
      userId: rating.userId,
      stars: rating.stars,
      hasReview: !!rating.review,
      verified: rating.verified,
    });

    return rating;
  }

  /**
   * Update an existing rating
   */
  public async updateRating(
    ratingId: string,
    updates: RatingUpdate,
    requesterId: string
  ): Promise<Rating> {
    const rating = this.ratings.get(ratingId);
    if (!rating) {
      throw new RatingNotFoundError(ratingId);
    }

    // Authorization check
    if (rating.userId !== requesterId) {
      throw new UnauthorizedRatingError();
    }

    // Validate updates
    if (updates.stars !== undefined && (updates.stars < 1 || updates.stars > 5)) {
      throw new InvalidRatingError('Stars must be between 1 and 5');
    }

    if (updates.review !== undefined && updates.review.length > 0) {
      if (updates.review.length < CONFIG.MIN_REVIEW_LENGTH) {
        throw new InvalidRatingError(
          `Review must be at least ${CONFIG.MIN_REVIEW_LENGTH} characters`
        );
      }
      if (updates.review.length > CONFIG.MAX_REVIEW_LENGTH) {
        throw new InvalidRatingError(
          `Review must not exceed ${CONFIG.MAX_REVIEW_LENGTH} characters`
        );
      }
    }

    // Apply updates
    const oldStars = rating.stars;
    if (updates.stars !== undefined) {
      rating.stars = updates.stars;
    }
    if (updates.review !== undefined) {
      rating.review = updates.review;
    }
    rating.updatedAt = new Date();

    // Update aggregate if stars changed
    if (oldStars !== rating.stars) {
      await this.updateAggregateRating(rating.toolId);
    }

    // Clear caches
    this.clearCaches(['rating', 'aggregate']);

    // Emit event
    this.emit('rating:updated', {
      ratingId: rating.id,
      toolId: rating.toolId,
      userId: rating.userId,
      changes: {
        stars: oldStars !== rating.stars,
        review: updates.review !== undefined,
      },
    });

    return rating;
  }

  /**
   * Delete a rating (user or moderator)
   */
  public async deleteRating(
    ratingId: string,
    requesterId: string,
    moderatorDelete: boolean = false
  ): Promise<void> {
    const rating = this.ratings.get(ratingId);
    if (!rating) {
      throw new RatingNotFoundError(ratingId);
    }

    // Authorization check
    if (!moderatorDelete && rating.userId !== requesterId) {
      throw new UnauthorizedRatingError();
    }

    // Remove from storage
    this.ratings.delete(ratingId);

    // Remove from indices
    this.unindexRating(rating);

    // Update aggregate statistics
    await this.updateAggregateRating(rating.toolId);

    // Clear caches
    this.clearCaches(['rating', 'aggregate']);

    // Emit event
    this.emit('rating:deleted', {
      ratingId: rating.id,
      toolId: rating.toolId,
      userId: rating.userId,
      moderatorDelete,
    });
  }

  // ==========================================================================
  // RATING RETRIEVAL
  // ==========================================================================

  /**
   * Get ratings for a tool with filters and pagination
   */
  public async getRatings(
    toolId: string,
    filters: RatingFilters = {},
    page: number = 1,
    limit: number = CONFIG.DEFAULT_PAGE_SIZE
  ): Promise<RatingPage> {
    // Validate pagination
    if (page < 1) page = 1;
    if (limit < 1 || limit > CONFIG.MAX_PAGE_SIZE) {
      limit = CONFIG.DEFAULT_PAGE_SIZE;
    }

    // Get all ratings for tool
    const ratingIds = this.toolRatings.get(toolId) || new Set();
    let ratings = Array.from(ratingIds)
      .map((id) => this.ratings.get(id)!)
      .filter((r) => r !== undefined);

    // Apply filters
    ratings = this.applyFilters(ratings, filters);

    // Sort by creation date (newest first)
    ratings.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Paginate
    const total = ratings.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedRatings = ratings.slice(startIndex, endIndex);

    return {
      ratings: paginatedRatings,
      total,
      page,
      limit,
      hasMore: endIndex < total,
    };
  }

  /**
   * Get a single rating by ID
   */
  public async getRatingById(ratingId: string): Promise<Rating> {
    const rating = this.ratings.get(ratingId);
    if (!rating) {
      throw new RatingNotFoundError(ratingId);
    }
    return rating;
  }

  /**
   * Get all ratings by a user
   */
  public async getUserRatings(
    userId: string,
    page: number = 1,
    limit: number = CONFIG.DEFAULT_PAGE_SIZE
  ): Promise<RatingPage> {
    const ratingIds = this.userRatings.get(userId) || new Set();
    let ratings = Array.from(ratingIds)
      .map((id) => this.ratings.get(id)!)
      .filter((r) => r !== undefined);

    // Sort by creation date (newest first)
    ratings.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Paginate
    const total = ratings.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedRatings = ratings.slice(startIndex, endIndex);

    return {
      ratings: paginatedRatings,
      total,
      page,
      limit,
      hasMore: endIndex < total,
    };
  }

  // ==========================================================================
  // AGGREGATE RATING & REPUTATION
  // ==========================================================================

  /**
   * Calculate aggregate rating with weighted recency algorithm
   *
   * Formula:
   * weighted_avg = Σ(rating × recency_weight) / Σ(recency_weight)
   * recency_weight = exp(-λ × days_old)
   * where λ = ln(2) / 30 (half-life of 30 days)
   */
  public async getAggregateRating(toolId: string): Promise<AggregateRating> {
    // Check cache
    const cacheKey = `aggregate:${toolId}`;
    const cached = this.getFromCache<AggregateRating>(cacheKey);
    if (cached) {
      return cached;
    }

    // Get all ratings for tool
    const ratingIds = this.toolRatings.get(toolId) || new Set();
    const ratings = Array.from(ratingIds)
      .map((id) => this.ratings.get(id)!)
      .filter((r) => r !== undefined && !r.reported);

    if (ratings.length === 0) {
      return {
        toolId,
        averageRating: 0,
        simpleAverage: 0,
        totalRatings: 0,
        totalReviews: 0,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        recencyWeight: 1,
        lastUpdated: new Date(),
      };
    }

    // Calculate distribution
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    ratings.forEach((r) => {
      distribution[r.stars]++;
    });

    // Calculate simple average
    const totalStars = ratings.reduce((sum, r) => sum + r.stars, 0);
    const simpleAverage = totalStars / ratings.length;

    // Calculate weighted average with recency
    const now = Date.now();
    let weightedSum = 0;
    let weightSum = 0;

    ratings.forEach((rating) => {
      const ageInDays = (now - rating.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      const recencyWeight = Math.exp(-CONFIG.RECENCY_DECAY_LAMBDA * ageInDays);
      weightedSum += rating.stars * recencyWeight;
      weightSum += recencyWeight;
    });

    const weightedAverage = weightedSum / weightSum;
    const totalReviews = ratings.filter((r) => r.review && r.review.length > 0).length;

    const aggregate: AggregateRating = {
      toolId,
      averageRating: Math.round(weightedAverage * 100) / 100,
      simpleAverage: Math.round(simpleAverage * 100) / 100,
      totalRatings: ratings.length,
      totalReviews,
      distribution,
      recencyWeight: Math.round((weightSum / ratings.length) * 100) / 100,
      lastUpdated: new Date(),
    };

    // Cache result
    this.setCache(cacheKey, aggregate, CONFIG.AGGREGATE_CACHE_TTL_MINUTES);

    return aggregate;
  }

  /**
   * Update aggregate rating and sync with ServerRegistry
   */
  private async updateAggregateRating(toolId: string): Promise<void> {
    const aggregate = await this.getAggregateRating(toolId);

    // Update ServerRegistry statistics
    try {
      await serverRegistryService.updateServerStatistics(toolId, {
        averageRating: aggregate.averageRating,
        totalReviews: aggregate.totalReviews,
      });
    } catch (error) {
      // Tool might have been deleted, log but don't fail
      console.error(`Failed to update server statistics for ${toolId}:`, error);
    }
  }

  // ==========================================================================
  // HELPFUL VOTES
  // ==========================================================================

  /**
   * Mark a rating as helpful
   */
  public async markHelpful(ratingId: string, userId: string): Promise<Rating> {
    const rating = this.ratings.get(ratingId);
    if (!rating) {
      throw new RatingNotFoundError(ratingId);
    }

    // Increment helpful count
    rating.helpful++;

    // Emit event
    this.emit('rating:helpful', {
      ratingId: rating.id,
      userId,
      totalHelpful: rating.helpful,
    });

    return rating;
  }

  // ==========================================================================
  // REPORTING & MODERATION
  // ==========================================================================

  /**
   * Report a rating for moderation
   */
  public async reportRating(report: RatingReport): Promise<void> {
    const rating = this.ratings.get(report.ratingId);
    if (!rating) {
      throw new RatingNotFoundError(report.ratingId);
    }

    // Check rate limiting
    this.checkReportRateLimit(report.reporterId);

    // Mark as reported
    rating.reported = true;

    // Record timestamp
    this.recordReportTimestamp(report.reporterId);

    // Emit event
    this.emit('rating:reported', {
      ratingId: report.ratingId,
      reporterId: report.reporterId,
      reason: report.reason,
      details: report.details,
    });
  }

  /**
   * Moderate a reported rating (admin/moderator only)
   */
  public async moderateRating(
    ratingId: string,
    moderatorId: string,
    action: 'approve' | 'remove',
    notes?: string
  ): Promise<Rating> {
    const rating = this.ratings.get(ratingId);
    if (!rating) {
      throw new RatingNotFoundError(ratingId);
    }

    rating.moderatorReviewed = true;
    rating.moderatorNotes = notes;

    if (action === 'remove') {
      await this.deleteRating(ratingId, moderatorId, true);

      this.emit('rating:moderated', {
        ratingId,
        moderatorId,
        action: 'removed',
        notes,
      });

      // Return deleted rating info
      return rating;
    } else {
      // Approve: clear reported flag
      rating.reported = false;

      this.emit('rating:moderated', {
        ratingId,
        moderatorId,
        action: 'approved',
        notes,
      });

      return rating;
    }
  }

  /**
   * Get reported ratings for moderation queue
   */
  public async getReportedRatings(
    page: number = 1,
    limit: number = CONFIG.DEFAULT_PAGE_SIZE
  ): Promise<RatingPage> {
    let reported = Array.from(this.ratings.values()).filter(
      (r) => r.reported && !r.moderatorReviewed
    );

    // Sort by creation date (oldest first for FIFO processing)
    reported.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Paginate
    const total = reported.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedRatings = reported.slice(startIndex, endIndex);

    return {
      ratings: paginatedRatings,
      total,
      page,
      limit,
      hasMore: endIndex < total,
    };
  }

  // ==========================================================================
  // PRIVATE HELPER METHODS
  // ==========================================================================

  /**
   * Index a rating for fast lookups
   */
  private indexRating(rating: Rating): void {
    // Tool index
    if (!this.toolRatings.has(rating.toolId)) {
      this.toolRatings.set(rating.toolId, new Set());
    }
    this.toolRatings.get(rating.toolId)!.add(rating.id);

    // User index
    if (!this.userRatings.has(rating.userId)) {
      this.userRatings.set(rating.userId, new Set());
    }
    this.userRatings.get(rating.userId)!.add(rating.id);

    // User-tool index (for duplicate detection)
    if (!this.userToolRatings.has(rating.userId)) {
      this.userToolRatings.set(rating.userId, new Map());
    }
    this.userToolRatings.get(rating.userId)!.set(rating.toolId, rating.id);
  }

  /**
   * Remove rating from indices
   */
  private unindexRating(rating: Rating): void {
    // Tool index
    this.toolRatings.get(rating.toolId)?.delete(rating.id);

    // User index
    this.userRatings.get(rating.userId)?.delete(rating.id);

    // User-tool index
    this.userToolRatings.get(rating.userId)?.delete(rating.toolId);
  }

  /**
   * Validate rating submission
   */
  private validateRatingSubmission(submission: RatingSubmission): void {
    if (submission.stars < 1 || submission.stars > 5) {
      throw new InvalidRatingError('Stars must be between 1 and 5');
    }

    if (submission.review) {
      if (submission.review.length < CONFIG.MIN_REVIEW_LENGTH) {
        throw new InvalidRatingError(
          `Review must be at least ${CONFIG.MIN_REVIEW_LENGTH} characters`
        );
      }
      if (submission.review.length > CONFIG.MAX_REVIEW_LENGTH) {
        throw new InvalidRatingError(
          `Review must not exceed ${CONFIG.MAX_REVIEW_LENGTH} characters`
        );
      }
    }
  }

  /**
   * Apply filters to ratings
   */
  private applyFilters(ratings: Rating[], filters: RatingFilters): Rating[] {
    let filtered = [...ratings];

    if (filters.minStars !== undefined) {
      filtered = filtered.filter((r) => r.stars >= filters.minStars!);
    }

    if (filters.maxStars !== undefined) {
      filtered = filtered.filter((r) => r.stars <= filters.maxStars!);
    }

    if (filters.verified !== undefined) {
      filtered = filtered.filter((r) => r.verified === filters.verified);
    }

    if (filters.hasReview !== undefined) {
      filtered = filtered.filter((r) =>
        filters.hasReview ? r.review && r.review.length > 0 : !r.review
      );
    }

    if (filters.reported !== undefined) {
      filtered = filtered.filter((r) => r.reported === filters.reported);
    }

    return filtered;
  }

  /**
   * Check rate limiting for rating submissions
   */
  private checkRateLimit(userId: string): void {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    const timestamps = this.userRatingTimestamps.get(userId) || [];
    const recentTimestamps = timestamps.filter((t) => t > oneHourAgo);

    if (recentTimestamps.length >= CONFIG.MAX_RATINGS_PER_HOUR) {
      throw new RateLimitError();
    }
  }

  /**
   * Record rating timestamp for rate limiting
   */
  private recordRatingTimestamp(userId: string): void {
    const now = Date.now();
    if (!this.userRatingTimestamps.has(userId)) {
      this.userRatingTimestamps.set(userId, []);
    }
    this.userRatingTimestamps.get(userId)!.push(now);

    // Cleanup old timestamps (keep only last hour)
    const oneHourAgo = now - 60 * 60 * 1000;
    const timestamps = this.userRatingTimestamps.get(userId)!;
    this.userRatingTimestamps.set(
      userId,
      timestamps.filter((t) => t > oneHourAgo)
    );
  }

  /**
   * Check rate limiting for reports
   */
  private checkReportRateLimit(userId: string): void {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const timestamps = this.userReportTimestamps.get(userId) || [];
    const recentTimestamps = timestamps.filter((t) => t > oneDayAgo);

    if (recentTimestamps.length >= CONFIG.MAX_REPORTS_PER_DAY) {
      throw new RateLimitError();
    }
  }

  /**
   * Record report timestamp for rate limiting
   */
  private recordReportTimestamp(userId: string): void {
    const now = Date.now();
    if (!this.userReportTimestamps.has(userId)) {
      this.userReportTimestamps.set(userId, []);
    }
    this.userReportTimestamps.get(userId)!.push(now);

    // Cleanup old timestamps (keep only last day)
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const timestamps = this.userReportTimestamps.get(userId)!;
    this.userReportTimestamps.set(
      userId,
      timestamps.filter((t) => t > oneDayAgo)
    );
  }

  /**
   * Generate unique rating ID
   */
  private generateRatingId(): string {
    return `rating-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Get data from cache
   */
  private getFromCache<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    if (Date.now() > cached.expiry) {
      this.cache.delete(key);
      return null;
    }

    return cached.data as T;
  }

  /**
   * Store data in cache
   */
  private setCache(key: string, data: unknown, ttlMinutes: number): void {
    const expiry = Date.now() + ttlMinutes * 60 * 1000;
    this.cache.set(key, { data, expiry });
  }

  /**
   * Clear caches by prefix
   */
  private clearCaches(prefixes: string[]): void {
    for (const [key] of this.cache.entries()) {
      if (prefixes.some((prefix) => key.startsWith(prefix))) {
        this.cache.delete(key);
      }
    }
  }

  // ==========================================================================
  // SERVICE STATISTICS
  // ==========================================================================

  /**
   * Get service-wide statistics
   */
  public getServiceStats(): {
    totalRatings: number;
    totalReviews: number;
    averageRating: number;
    reportedRatings: number;
    verifiedRatings: number;
  } {
    const allRatings = Array.from(this.ratings.values());

    return {
      totalRatings: allRatings.length,
      totalReviews: allRatings.filter((r) => r.review && r.review.length > 0).length,
      averageRating:
        allRatings.length > 0
          ? allRatings.reduce((sum, r) => sum + r.stars, 0) / allRatings.length
          : 0,
      reportedRatings: allRatings.filter((r) => r.reported).length,
      verifiedRatings: allRatings.filter((r) => r.verified).length,
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const ratingService = RatingService.getInstance();

/**
 * Type guard for Rating
 */
export function isRating(obj: unknown): obj is Rating {
  if (!obj || typeof obj !== 'object') return false;
  const r = obj as Rating;
  return (
    typeof r.id === 'string' &&
    typeof r.toolId === 'string' &&
    typeof r.userId === 'string' &&
    typeof r.stars === 'number' &&
    r.stars >= 1 &&
    r.stars <= 5 &&
    r.createdAt instanceof Date
  );
}
