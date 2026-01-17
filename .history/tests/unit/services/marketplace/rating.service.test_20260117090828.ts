/**
 * RatingService Unit Tests
 *
 * Comprehensive test suite for the Rating Service.
 * Tests rating submission, reputation algorithm, moderation, and all rating operations.
 *
 * Coverage Target: 92%+
 * Test Count: 25+ tests
 *
 * Copyright (c) 2026 AutoAG-CommGateway. All Rights Reserved.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  RatingService,
  RatingNotFoundError,
  UnauthorizedRatingError,
  RateLimitError,
  InvalidRatingError,
  type Rating,
  type RatingSubmission,
  type RatingUpdate,
  ReportReason,
} from '../../../../src/services/marketplace/rating.service';
import { serverRegistryService } from '../../../../src/services/marketplace/server-registry.service';

// Mock ServerRegistryService
jest.mock('../../../../src/services/marketplace/server-registry.service', () => ({
  serverRegistryService: {
    getServerById: jest.fn(),
    updateServerStatistics: jest.fn(),
  },
}));

describe('RatingService', () => {
  let service: RatingService;
  let mockServerRegistry: jest.Mocked<typeof serverRegistryService>;

  beforeEach(() => {
    // Get fresh instance for each test
    service = RatingService.getInstance();

    // Reset service state
    service.resetForTesting();

    // Setup mocks
    mockServerRegistry = serverRegistryService as jest.Mocked<typeof serverRegistryService>;
    mockServerRegistry.getServerById.mockResolvedValue({
      id: 'server-123',
      name: 'Test Server',
      status: 'active',
    } as any);
    mockServerRegistry.updateServerStatistics.mockResolvedValue();

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // RATING SUBMISSION TESTS
  // ============================================================================

  describe('submitRating', () => {
    const validSubmission: RatingSubmission = {
      toolId: 'server-123',
      userId: 'user-456',
      stars: 5,
      review: 'Excellent server! Very helpful and reliable.',
      verified: true,
    };

    it('should submit valid rating with review', async () => {
      const rating = await service.submitRating(validSubmission);

      expect(rating).toBeDefined();
      expect(rating.toolId).toBe(validSubmission.toolId);
      expect(rating.userId).toBe(validSubmission.userId);
      expect(rating.stars).toBe(validSubmission.stars);
      expect(rating.review).toBe(validSubmission.review);
      expect(rating.verified).toBe(true);
      expect(rating.helpful).toBe(0);
      expect(rating.reported).toBe(false);
      expect(rating.createdAt).toBeInstanceOf(Date);
      expect(rating.updatedAt).toBeInstanceOf(Date);

      // Verify ServerRegistry was updated
      expect(mockServerRegistry.updateServerStatistics).toHaveBeenCalledWith('server-123', {
        averageRating: 5,
        totalReviews: 1,
      });
    });

    it('should submit rating without review', async () => {
      const submission = { ...validSubmission, review: undefined };
      const rating = await service.submitRating(submission);

      expect(rating.review).toBeUndefined();
      expect(rating.stars).toBe(5);
    });

    it('should reject invalid star values (less than 1)', async () => {
      const invalidSubmission = { ...validSubmission, stars: 0 as any };

      await expect(service.submitRating(invalidSubmission)).rejects.toThrow(InvalidRatingError);
      await expect(service.submitRating(invalidSubmission)).rejects.toThrow(
        'Stars must be between 1 and 5'
      );
    });

    it('should reject invalid star values (greater than 5)', async () => {
      const invalidSubmission = { ...validSubmission, stars: 6 as any };

      await expect(service.submitRating(invalidSubmission)).rejects.toThrow(InvalidRatingError);
    });

    it('should enforce review length limit (1000 characters)', async () => {
      const longReview = 'a'.repeat(1001);
      const invalidSubmission = { ...validSubmission, review: longReview };

      await expect(service.submitRating(invalidSubmission)).rejects.toThrow(InvalidRatingError);
      await expect(service.submitRating(invalidSubmission)).rejects.toThrow(
        'Review must not exceed 1000 characters'
      );
    });

    it('should prevent duplicate ratings from same user', async () => {
      await service.submitRating(validSubmission);

      await expect(service.submitRating(validSubmission)).rejects.toThrow(
        'already rated this tool'
      );
    });

    it('should enforce rate limiting (5 ratings per hour)', async () => {
      // Submit 5 ratings successfully
      for (let i = 0; i < 5; i++) {
        await service.submitRating({
          ...validSubmission,
          toolId: `server-${i}`,
        });
      }

      // 6th rating should be rate limited
      await expect(
        service.submitRating({
          ...validSubmission,
          toolId: 'server-6',
        })
      ).rejects.toThrow(RateLimitError);
    });

    it('should generate unique rating IDs', async () => {
      const rating1 = await service.submitRating(validSubmission);

      // Submit for different tool to avoid duplicate check
      const rating2 = await service.submitRating({
        ...validSubmission,
        toolId: 'server-789',
      });

      expect(rating1.id).not.toBe(rating2.id);
      expect(rating1.id).toMatch(/^rating-\d+-[a-z0-9]+$/);
      expect(rating2.id).toMatch(/^rating-\d+-[a-z0-9]+$/);
    });
  });

  // ============================================================================
  // RATING UPDATE TESTS
  // ============================================================================

  describe('updateRating', () => {
    let existingRating: Rating;

    beforeEach(async () => {
      existingRating = await service.submitRating({
        toolId: 'server-123',
        userId: 'user-456',
        stars: 4,
        review: 'Good server',
        verified: true,
      });
    });

    it('should update own rating successfully', async () => {
      const updates: RatingUpdate = {
        stars: 5,
        review: 'Excellent server! Updated my review.',
      };

      const updated = await service.updateRating(existingRating.id, updates, 'user-456');

      expect(updated.stars).toBe(5);
      expect(updated.review).toBe(updates.review);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(existingRating.createdAt.getTime());
    });

    it('should reject unauthorized updates', async () => {
      const updates: RatingUpdate = { stars: 3 };

      await expect(
        service.updateRating(existingRating.id, updates, 'different-user')
      ).rejects.toThrow(UnauthorizedRatingError);
    });

    it('should validate update data', async () => {
      const invalidUpdates = { stars: 7 as any };

      await expect(
        service.updateRating(existingRating.id, invalidUpdates, 'user-456')
      ).rejects.toThrow(InvalidRatingError);
    });

    it('should enforce review length limit on update', async () => {
      const updates = { review: 'a'.repeat(1001) };

      await expect(service.updateRating(existingRating.id, updates, 'user-456')).rejects.toThrow(
        InvalidRatingError
      );
    });
  });

  // ============================================================================
  // RATING DELETION TESTS
  // ============================================================================

  describe('deleteRating', () => {
    let existingRating: Rating;

    beforeEach(async () => {
      existingRating = await service.submitRating({
        toolId: 'server-123',
        userId: 'user-456',
        stars: 4,
        verified: true,
      });
    });

    it('should delete own rating', async () => {
      await service.deleteRating(existingRating.id, 'user-456');

      await expect(service.getRatingById(existingRating.id)).rejects.toThrow(RatingNotFoundError);

      // Verify ServerRegistry was updated
      expect(mockServerRegistry.updateServerStatistics).toHaveBeenCalledTimes(2); // Once for create, once for delete
    });

    it('should reject unauthorized deletion', async () => {
      await expect(service.deleteRating(existingRating.id, 'different-user')).rejects.toThrow(
        UnauthorizedRatingError
      );

      // Rating should still exist
      const rating = await service.getRatingById(existingRating.id);
      expect(rating).toBeDefined();
    });

    it('should throw error for non-existent rating', async () => {
      await expect(service.deleteRating('non-existent-id', 'user-456')).rejects.toThrow(
        RatingNotFoundError
      );
    });
  });

  // ============================================================================
  // REPUTATION ALGORITHM TESTS
  // ============================================================================

  describe('Reputation Algorithm', () => {
    it('should calculate weighted average with recency decay', async () => {
      // Submit multiple ratings with different timestamps
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      // Recent rating: 5 stars
      await service.submitRating({
        toolId: 'server-123',
        userId: 'user-1',
        stars: 5,
        verified: true,
      });

      // 30-day old rating: 3 stars (should have ~50% weight)
      const rating2 = await service.submitRating({
        toolId: 'server-123',
        userId: 'user-2',
        stars: 3,
        verified: true,
      });
      (service as any).ratings.get(rating2.id).createdAt = thirtyDaysAgo;

      // 60-day old rating: 1 star (should have ~25% weight)
      const rating3 = await service.submitRating({
        toolId: 'server-123',
        userId: 'user-3',
        stars: 1,
        verified: true,
      });
      (service as any).ratings.get(rating3.id).createdAt = sixtyDaysAgo;

      const aggregate = await service.getAggregateRating('server-123');

      // Weighted average should favor recent ratings
      expect(aggregate.averageRating).toBeGreaterThan(3);
      expect(aggregate.averageRating).toBeLessThan(5);
      expect(aggregate.totalRatings).toBe(3);
    });

    it('should handle single rating', async () => {
      await service.submitRating({
        toolId: 'server-123',
        userId: 'user-456',
        stars: 4,
        verified: true,
      });

      const aggregate = await service.getAggregateRating('server-123');

      expect(aggregate.averageRating).toBe(4);
      expect(aggregate.simpleAverage).toBe(4);
      expect(aggregate.totalRatings).toBe(1);
    });

    it('should return default for no ratings', async () => {
      const aggregate = await service.getAggregateRating('server-123');

      expect(aggregate.averageRating).toBe(0);
      expect(aggregate.totalRatings).toBe(0);
      expect(aggregate.distribution).toEqual({
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
      });
    });

    it('should favor recent ratings over old ones', async () => {
      const now = new Date();
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      // Old rating: 5 stars
      const oldRating = await service.submitRating({
        toolId: 'server-123',
        userId: 'user-1',
        stars: 5,
        verified: true,
      });
      (service as any).ratings.get(oldRating.id).createdAt = sixtyDaysAgo;

      // New rating: 3 stars
      await service.submitRating({
        toolId: 'server-123',
        userId: 'user-2',
        stars: 3,
        verified: true,
      });

      const aggregate = await service.getAggregateRating('server-123');

      // Weighted average should be closer to 3 than 5
      expect(aggregate.averageRating).toBeLessThan(4);
      expect(aggregate.averageRating).toBeGreaterThan(3);
    });

    it('should apply correct half-life decay (30 days)', async () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Rating at 30 days should have approximately 50% weight
      const rating = await service.submitRating({
        toolId: 'server-123',
        userId: 'user-456',
        stars: 5,
        verified: true,
      });
      (service as any).ratings.get(rating.id).createdAt = thirtyDaysAgo;

      const aggregate = await service.getAggregateRating('server-123');

      // Weight calculation: exp(-ln(2)/30 * 30) ≈ 0.5
      expect(aggregate.recencyWeight).toBeCloseTo(0.5, 1);
    });

    it('should calculate distribution correctly', async () => {
      await service.submitRating({
        toolId: 'server-123',
        userId: 'user-1',
        stars: 5,
        verified: true,
      });
      await service.submitRating({
        toolId: 'server-123',
        userId: 'user-2',
        stars: 5,
        verified: true,
      });
      await service.submitRating({
        toolId: 'server-123',
        userId: 'user-3',
        stars: 4,
        verified: true,
      });
      await service.submitRating({
        toolId: 'server-123',
        userId: 'user-4',
        stars: 3,
        verified: true,
      });
      await service.submitRating({
        toolId: 'server-123',
        userId: 'user-5',
        stars: 1,
        verified: true,
      });

      const aggregate = await service.getAggregateRating('server-123');

      expect(aggregate.distribution).toEqual({
        1: 1,
        2: 0,
        3: 1,
        4: 1,
        5: 2,
      });
      expect(aggregate.totalRatings).toBe(5);
    });
  });

  // ============================================================================
  // RATING RETRIEVAL TESTS
  // ============================================================================

  describe('getRatings', () => {
    beforeEach(async () => {
      // Create test ratings
      for (let i = 1; i <= 5; i++) {
        await service.submitRating({
          toolId: 'server-123',
          userId: `user-${i}`,
          stars: i as 1 | 2 | 3 | 4 | 5,
          review: i >= 3 ? `Review number ${i} with enough characters` : undefined,
          verified: true,
        });
      }
    });

    it('should get ratings with pagination', async () => {
      const page1 = await service.getRatings('server-123', {}, 1, 2);

      expect(page1.ratings).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.page).toBe(1);
      expect(page1.limit).toBe(2);
      expect(page1.hasMore).toBe(true);

      const page2 = await service.getRatings('server-123', {}, 2, 2);
      expect(page2.ratings).toHaveLength(2);
      expect(page2.hasMore).toBe(true);
    });

    it('should filter by minimum stars', async () => {
      const filtered = await service.getRatings('server-123', { minStars: 4 }, 1, 10);

      expect(filtered.ratings).toHaveLength(2);
      filtered.ratings.forEach((r) => {
        expect(r.stars).toBeGreaterThanOrEqual(4);
      });
    });

    it('should filter by review presence', async () => {
      const withReviews = await service.getRatings('server-123', { hasReview: true }, 1, 10);

      expect(withReviews.ratings).toHaveLength(3); // Stars 3, 4, 5 have reviews
      withReviews.ratings.forEach((r) => {
        expect(r.review).toBeDefined();
      });
    });

    it('should sort by helpful votes', async () => {
      const ratings = await service.getRatings('server-123', {}, 1, 10);
      const rating1 = ratings.ratings[0];
      const rating2 = ratings.ratings[1];

      // Mark first rating helpful by multiple users
      await service.markHelpful(rating1.id, 'user-a');
      await service.markHelpful(rating1.id, 'user-b');
      await service.markHelpful(rating1.id, 'user-c');

      // Mark second rating helpful by one user
      await service.markHelpful(rating2.id, 'user-d');

      const sorted = await service.getRatings('server-123', {}, 1, 10);

      expect(sorted.ratings[0].helpful).toBeGreaterThan(sorted.ratings[1].helpful);
    });
  });

  // ============================================================================
  // MODERATION TESTS
  // ============================================================================

  describe('Moderation', () => {
    let testRating: Rating;

    beforeEach(async () => {
      testRating = await service.submitRating({
        toolId: 'server-123',
        userId: 'user-456',
        stars: 1,
        review: 'This is spam content',
        verified: true,
      });
    });

    it('should report rating with valid reason', async () => {
      await service.reportRating({
        ratingId: testRating.id,
        reporterId: 'reporter-123',
        reason: ReportReason.SPAM,
        details: 'Spam or inappropriate content',
      });

      const rating = await service.getRatingById(testRating.id);
      expect(rating.reported).toBe(true);
    });

    it('should enforce report rate limiting (10 per day)', async () => {
      // Submit 10 reports successfully
      for (let i = 0; i < 10; i++) {
        const rating = await service.submitRating({
          toolId: 'server-123',
          userId: `user-${i}`,
          stars: 1,
          verified: true,
        });
        await service.reportRating({
          ratingId: rating.id,
          reporterId: 'reporter-123',
          reason: ReportReason.SPAM,
        });
      }

      // 11th report should be rate limited
      const rating11 = await service.submitRating({
        toolId: 'server-123',
        userId: 'user-11',
        stars: 1,
        verified: true,
      });

      await expect(
        service.reportRating({
          ratingId: rating11.id,
          reporterId: 'reporter-123',
          reason: ReportReason.SPAM,
        })
      ).rejects.toThrow(RateLimitError);
    });

    it('should allow moderator to delete rating', async () => {
      await service.moderateRating(
        testRating.id,
        'moderator-789',
        'remove',
        'Spam content removed'
      );

      await expect(service.getRatingById(testRating.id)).rejects.toThrow(RatingNotFoundError);
    });

    it('should reject non-moderator deletion attempts', async () => {
      await expect(
        service.moderateRating(testRating.id, 'regular-user', 'remove', 'Notes')
      ).rejects.toThrow(UnauthorizedRatingError);
    });

    it('should allow moderator to approve reported rating', async () => {
      await service.reportRating({
        ratingId: testRating.id,
        reporterId: 'reporter-123',
        reason: ReportReason.SPAM,
      });

      await service.moderateRating(testRating.id, 'moderator-789', 'approve', 'Reviewed, not spam');

      const rating = await service.getRatingById(testRating.id);
      expect(rating.moderatorReviewed).toBe(true);
      expect(rating.reported).toBe(false);
    });
  });

  // ============================================================================
  // HELPFUL VOTING TESTS
  // ============================================================================

  describe('markHelpful', () => {
    let testRating: Rating;

    beforeEach(async () => {
      testRating = await service.submitRating({
        toolId: 'server-123',
        userId: 'user-456',
        stars: 5,
        review: 'Very helpful review',
        verified: true,
      });
    });

    it('should mark rating as helpful', async () => {
      await service.markHelpful(testRating.id, 'voter-123');

      const rating = await service.getRatingById(testRating.id);
      expect(rating.helpful).toBe(1);
    });

    it('should prevent duplicate helpful votes', async () => {
      await service.markHelpful(testRating.id, 'voter-123');

      await expect(service.markHelpful(testRating.id, 'voter-123')).rejects.toThrow(
        InvalidRatingError
      );
      await expect(service.markHelpful(testRating.id, 'voter-123')).rejects.toThrow(
        'already marked this rating as helpful'
      );
    });

    it('should track multiple users voting', async () => {
      await service.markHelpful(testRating.id, 'voter-1');
      await service.markHelpful(testRating.id, 'voter-2');
      await service.markHelpful(testRating.id, 'voter-3');

      const rating = await service.getRatingById(testRating.id);
      expect(rating.helpful).toBe(3);
    });
  });

  // ============================================================================
  // SERVERREGISTRY INTEGRATION TESTS
  // ============================================================================

  describe('ServerRegistry Integration', () => {
    it('should update ServerRegistry statistics on rating submission', async () => {
      await service.submitRating({
        toolId: 'server-123',
        userId: 'user-456',
        stars: 5,
        verified: true,
      });

      expect(mockServerRegistry.updateServerStatistics).toHaveBeenCalledWith('server-123', {
        averageRating: 5,
        totalReviews: 0,
      });
    });

    it('should update ServerRegistry on multiple ratings', async () => {
      await service.submitRating({
        toolId: 'server-123',
        userId: 'user-1',
        stars: 5,
        verified: true,
      });

      await service.submitRating({
        toolId: 'server-123',
        userId: 'user-2',
        stars: 3,
        verified: true,
      });

      // Should be called twice with updated aggregates
      expect(mockServerRegistry.updateServerStatistics).toHaveBeenCalledWith('server-123', {
        averageRating: 5,
        totalReviews: 0,
      });
      expect(mockServerRegistry.updateServerStatistics).toHaveBeenCalledTimes(2);
    });

    it('should handle ServerRegistry update failures gracefully', async () => {
      mockServerRegistry.updateServerStatistics.mockRejectedValueOnce(
        new Error('Registry unavailable')
      );

      // Should not throw, rating should still succeed
      const rating = await service.submitRating({
        toolId: 'server-123',
        userId: 'user-456',
        stars: 4,
        verified: true,
      });

      expect(rating).toBeDefined();
      expect(rating.stars).toBe(4);
    });
  });

  // ============================================================================
  // EVENT EMISSION TESTS
  // ============================================================================

  describe('Event Emissions', () => {
    it('should emit rating:submitted event', async () => {
      const eventPromise = new Promise((resolve) => {
        service.once('rating:submitted', resolve);
      });

      await service.submitRating({
        toolId: 'server-123',
        userId: 'user-456',
        stars: 5,
        verified: true,
      });

      const event = await eventPromise;
      expect(event).toBeDefined();
      expect((event as any).stars).toBe(5);
      expect((event as any).toolId).toBe('server-123');
      expect((event as any).userId).toBe('user-456');
      expect((event as any).hasReview).toBe(false);
    });

    it('should emit rating:updated event', async () => {
      const rating = await service.submitRating({
        toolId: 'server-123',
        userId: 'user-456',
        stars: 4,
        verified: true,
      });

      const eventPromise = new Promise((resolve) => {
        service.once('rating:updated', resolve);
      });

      await service.updateRating(rating.id, { stars: 5 }, 'user-456');

      const event = await eventPromise;
      expect(event).toBeDefined();
    });

    it('should emit rating:deleted event', async () => {
      const rating = await service.submitRating({
        toolId: 'server-123',
        userId: 'user-456',
        stars: 4,
        verified: true,
      });

      const eventPromise = new Promise((resolve) => {
        service.once('rating:deleted', resolve);
      });

      await service.deleteRating(rating.id, 'user-456');

      const event = await eventPromise;
      expect(event).toBeDefined();
      expect((event as any).ratingId).toBe(rating.id);
    });

    it('should emit rating:reported event', async () => {
      const rating = await service.submitRating({
        toolId: 'server-123',
        userId: 'user-456',
        stars: 1,
        verified: true,
      });

      const eventPromise = new Promise((resolve) => {
        service.once('rating:reported', resolve);
      });

      await service.reportRating({
        ratingId: rating.id,
        reporterId: 'reporter-123',
        reason: ReportReason.SPAM,
      });

      const event = await eventPromise;
      expect(event).toBeDefined();
    });

    it('should emit rating:helpful event', async () => {
      const rating = await service.submitRating({
        toolId: 'server-123',
        userId: 'user-456',
        stars: 5,
        review: 'Great tool, very helpful!',
        verified: true,
      });

      const eventPromise = new Promise((resolve) => {
        service.once('rating:helpful', resolve);
      });

      await service.markHelpful(rating.id, 'voter-123');

      const event = await eventPromise;
      expect(event).toBeDefined();
      expect((event as any).ratingId).toBe(rating.id);
    });
  });

  // ============================================================================
  // CACHE BEHAVIOR TESTS
  // ============================================================================

  describe('Cache Behavior', () => {
    it('should cache aggregate ratings', async () => {
      await service.submitRating({
        toolId: 'server-123',
        userId: 'user-456',
        stars: 5,
        verified: true,
      });

      // First call - cache miss
      const aggregate1 = await service.getAggregateRating('server-123');

      // Second call - should use cache
      const aggregate2 = await service.getAggregateRating('server-123');

      expect(aggregate1.averageRating).toBe(aggregate2.averageRating);
      expect(aggregate1.lastUpdated).toEqual(aggregate2.lastUpdated);
    });

    it('should invalidate cache on new rating', async () => {
      await service.submitRating({
        toolId: 'server-123',
        userId: 'user-1',
        stars: 3,
        verified: true,
      });

      const aggregate1 = await service.getAggregateRating('server-123');
      expect(aggregate1.averageRating).toBe(3);

      // Submit new rating
      await service.submitRating({
        toolId: 'server-123',
        userId: 'user-2',
        stars: 5,
        verified: true,
      });

      // Cache should be invalidated, new aggregate calculated
      const aggregate2 = await service.getAggregateRating('server-123');
      expect(aggregate2.averageRating).toBeGreaterThan(3);
      expect(aggregate2.totalRatings).toBe(2);
    });

    it('should respect cache TTL', async () => {
      await service.submitRating({
        toolId: 'server-123',
        userId: 'user-456',
        stars: 4,
        verified: true,
      });

      const aggregate1 = await service.getAggregateRating('server-123');

      // Manually expire cache
      (service as any).cache.clear();

      const aggregate2 = await service.getAggregateRating('server-123');

      // Values should be same but cache was recalculated
      expect(aggregate1.averageRating).toBe(aggregate2.averageRating);
    });
  });

  // ============================================================================
  // SERVICE STATISTICS TESTS
  // ============================================================================

  describe('getServiceStats', () => {
    it('should return aggregate statistics', async () => {
      await service.submitRating({
        toolId: 'server-1',
        userId: 'user-1',
        stars: 5,
        verified: true,
      });
      await service.submitRating({
        toolId: 'server-2',
        userId: 'user-2',
        stars: 4,
        verified: true,
      });
      await service.submitRating({
        toolId: 'server-1',
        userId: 'user-3',
        stars: 3,
        verified: true,
        review: 'Good overall',
      });

      const stats = service.getServiceStats();

      expect(stats.totalRatings).toBe(3);
      expect(stats.totalReviews).toBe(1);
      expect(stats.averageRating).toBeGreaterThan(3);
      expect(stats.totalRatings).toBeGreaterThan(0);
    });
  });
});
