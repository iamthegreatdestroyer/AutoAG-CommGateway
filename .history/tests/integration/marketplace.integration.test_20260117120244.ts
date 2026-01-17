/**
 * Marketplace Integration Tests
 *
 * End-to-end workflow validation across all marketplace components:
 * - ServerRegistryService
 * - RatingService
 * - CommissionService
 * - MarketplaceController
 *
 * Test Coverage:
 * - Complete user workflows (register → rate → earn → payout)
 * - Service interactions and data flow
 * - Multi-step processes
 * - Event propagation
 * - Cache behavior across services
 * - Error handling through layers
 *
 * Copyright (c) 2026 AutoAG-CommGateway. All Rights Reserved.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { serverRegistryService } from '../../src/services/marketplace/server-registry.service';
import { ratingService } from '../../src/services/marketplace/rating.service';
import { commissionService } from '../../src/services/marketplace/commission.service';
import { marketplaceController } from '../../src/controllers/marketplace.controller';
import type { Request, Response } from 'express';

// ============================================================================
// TEST SETUP & UTILITIES
// ============================================================================

/**
 * Create mock Express request
 */
function createMockRequest(options: {
  body?: any;
  params?: any;
  query?: any;
  user?: any;
}): Partial<Request> {
  return {
    body: options.body || {},
    params: options.params || {},
    query: options.query || {},
    user: options.user,
  } as any;
}

/**
 * Create mock Express response with spy methods
 */
function createMockResponse(): Partial<Response> & {
  statusCode: number;
  jsonData: any;
  status: jest.Mock;
  json: jest.Mock;
} {
  const res = {
    statusCode: 200,
    jsonData: null,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockImplementation(function (this: any, data: any) {
      this.jsonData = data;
      return this;
    }),
  };

  return res as any;
}

/**
 * Wait for events to propagate
 */
async function waitForEvents(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

// ============================================================================
// INTEGRATION TEST SUITE
// ============================================================================

describe('Marketplace Integration Tests', () => {
  // ==========================================================================
  // SETUP & TEARDOWN
  // ==========================================================================

  beforeEach(() => {
    // Clear all service state
    (serverRegistryService as any).servers.clear();
    (serverRegistryService as any).categories.clear();
    (serverRegistryService as any).publisherServers.clear();
    (serverRegistryService as any).healthStatus.clear();
    (serverRegistryService as any).cache.clear();

    (ratingService as any).ratings.clear();
    (ratingService as any).serverRatings.clear();
    (ratingService as any).userRatings.clear();
    (ratingService as any).helpfulVotes.clear();
    (ratingService as any).reports.clear();
    (ratingService as any).userSubmissions.clear();
    (ratingService as any).userReports.clear();
    (ratingService as any).cache.clear();

    (commissionService as any).commissions.clear();
    (commissionService as any).payoutBatches.clear();
    (commissionService as any).affiliateLinks.clear();
    (commissionService as any).publisherCommissions.clear();
    (commissionService as any).serverCommissions.clear();
    (commissionService as any).affiliateCommissions.clear();
    (commissionService as any).cache.clear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // WORKFLOW 1: COMPLETE SERVER LIFECYCLE
  // ==========================================================================

  describe('Complete Server Lifecycle Workflow', () => {
    it('should handle full workflow: register → rate → commission → payout', async () => {
      const publisherId = 'publisher-1';
      const userId = 'user-1';

      // STEP 1: Register a server
      const serverRegistration = {
        name: 'AI Analytics Server',
        description: 'Advanced analytics MCP server',
        publisherId,
        endpoint: 'http://localhost:3000/mcp',
        category: ServerCategory.OTHER,
        tags: ['ai', 'analytics', 'data'],
        pricing: {
          defaultTier: 'usage',
          customPricing: false,
          freeTrialInvocations: 100,
          subscriptionAvailable: false,
        },
      };

      const server = await serverRegistryService.registerServer(serverRegistration);
      expect(server.id).toBeDefined();
      expect(server.status).toBe('pending');

      // STEP 2: Activate server (simulate approval)
      await serverRegistryService.updateServerStatus(server.id, ServerStatus.ACTIVE);
      const activeServer = await serverRegistryService.getServerById(server.id);
      expect(activeServer.status).toBe(ServerStatus.ACTIVE);

      // STEP 3: User rates the server
      const ratingSubmission = {
        toolId: server.id,
        userId,
        stars: 5 as 1 | 2 | 3 | 4 | 5,
        review: 'Excellent analytics capabilities! Highly recommend.',
        verified: true,
      };

      const rating = await ratingService.submitRating(ratingSubmission);
      expect(rating.stars).toBe(5);

      // Wait for reputation update to propagate
      await waitForEvents();

      // Verify rating appears in server ratings
      const serverRatings = await ratingService.getRatings(server.id, 1, 10);
      expect(serverRatings.ratings).toHaveLength(1);
      expect(serverRatings.ratings[0].id).toBe(rating.id);

      // STEP 4: User invokes server and commission is recorded
      const commission = await commissionService.recordCommission(
        'invoke-12345',
        server.id,
        publisherId,
        10000, // 10,000 Gwei (number, not bigint)
        undefined // No affiliate
      );

      expect(commission.serverId).toBe(server.id);
      expect(commission.publisherId).toBe(publisherId);
      expect(commission.platformFee).toBe(500); // 5%
      expect(commission.publisherRevenue).toBe(9500); // 95%

      // STEP 5: Confirm commission
      await commissionService.updateCommissionStatus(commission.id, CommissionStatus.CONFIRMED);
      const confirmedCommission = await commissionService.getCommissionById(commission.id);
      expect(confirmedCommission.status).toBe(CommissionStatus.CONFIRMED);

      // STEP 6: Record multiple commissions to reach payout threshold
      const commissions = [];
      for (let i = 0; i < 10; i++) {
        const c = await commissionService.recordCommission(
          `invoke-${i}`,
          server.id,
          publisherId,
          15000n
        );
        await commissionService.confirmCommission(c.id);
        commissions.push(c);
      }

      // STEP 7: Create payout batch (total > 100k Gwei threshold)
      const commissionIds = [confirmedCommission.id, ...commissions.map((c) => c.id)];
      const payoutBatch = await commissionService.createPayoutBatch(publisherId, commissionIds);

      expect(payoutBatch.publisherId).toBe(publisherId);
      expect(payoutBatch.status).toBe('pending');
      expect(payoutBatch.totalAmount).toBeGreaterThan(100000n);

      // STEP 8: Process payout
      const payoutResult = await commissionService.processPayoutBatch(payoutBatch.id);
      expect(payoutResult.success).toBe(true);

      const processedBatch = await commissionService.getPayoutBatchById(payoutBatch.id);
      expect(processedBatch.status).toBe('completed');
      expect(processedBatch.transactionHash).toBeDefined();

      // STEP 9: Verify publisher revenue report
      const revenueReport = await commissionService.generateRevenueReport(
        publisherId,
        new Date(Date.now() - 24 * 60 * 60 * 1000),
        new Date()
      );

      expect(revenueReport.totalEarned).toBeGreaterThan(0n);
      expect(revenueReport.totalPaid).toBeGreaterThan(0n);
      expect(revenueReport.transactionCount).toBe(11);
    });
  });

  // ==========================================================================
  // WORKFLOW 2: AFFILIATE CONVERSION FLOW
  // ==========================================================================

  describe('Affiliate Conversion Workflow', () => {
    it('should track complete affiliate flow: create → click → convert → earn', async () => {
      const affiliateId = 'affiliate-1';
      const publisherId = 'publisher-2';

      // STEP 1: Register server
      const server = await serverRegistryService.registerServer({
        name: 'Data Processing Server',
        description: 'Fast data processing',
        version: '1.0.0',
        author: 'Data Corp',
        category: 'data',
        tags: ['processing'],
        publisherId,
        pricing: { model: 'usage' as const, pricePerInvoke: 50n },
        capabilities: { tools: ['process'], resources: [] },
      });

      await serverRegistryService.updateServerStatus(server.id, 'active');

      // STEP 2: Create affiliate link
      const affiliateLink = await commissionService.createAffiliateLink(affiliateId, server.id);
      expect(affiliateLink.code).toHaveLength(8);
      expect(affiliateLink.clicks).toBe(0);
      expect(affiliateLink.conversions).toBe(0);

      // STEP 3: Track clicks
      for (let i = 0; i < 5; i++) {
        await commissionService.trackAffiliateClick(affiliateLink.code);
      }

      const clickedLink = await commissionService.getAffiliateLinkByCode(affiliateLink.code);
      expect(clickedLink.clicks).toBe(5);
      expect(clickedLink.lastClickAt).toBeDefined();

      // STEP 4: User converts (makes purchase via affiliate link)
      const commission = await commissionService.recordCommission(
        'invoke-affiliate-1',
        server.id,
        publisherId,
        20000n,
        affiliateId
      );

      // Verify affiliate gets their cut
      expect(commission.affiliateFee).toBe(400n); // 2%
      expect(commission.platformFee).toBe(1000n); // 5%
      expect(commission.publisherAmount).toBe(18600n); // 93%

      // STEP 5: Track conversion
      await commissionService.trackAffiliateConversion(affiliateLink.code, commission.id);

      const convertedLink = await commissionService.getAffiliateLinkByCode(affiliateLink.code);
      expect(convertedLink.conversions).toBe(1);
      expect(convertedLink.conversionRate).toBeCloseTo(0.2, 2); // 1/5 = 20%

      // STEP 6: Record more conversions
      for (let i = 0; i < 2; i++) {
        const c = await commissionService.recordCommission(
          `invoke-affiliate-${i + 2}`,
          server.id,
          publisherId,
          15000n,
          affiliateId
        );
        await commissionService.trackAffiliateConversion(affiliateLink.code, c.id);
      }

      // STEP 7: Check affiliate performance stats
      const affiliateStats = await commissionService.getAffiliateStats(affiliateId);
      expect(affiliateStats.totalClicks).toBe(5);
      expect(affiliateStats.totalConversions).toBe(3);
      expect(affiliateStats.totalEarnings).toBeGreaterThan(0n);
      expect(affiliateStats.conversionRate).toBeCloseTo(0.6, 2); // 3/5 = 60%
    });
  });

  // ==========================================================================
  // WORKFLOW 3: MULTI-SERVER PUBLISHER DASHBOARD
  // ==========================================================================

  describe('Multi-Server Publisher Dashboard', () => {
    it('should aggregate data across multiple servers', async () => {
      const publisherId = 'publisher-multi';

      // Register 3 servers
      const servers = [];
      for (let i = 0; i < 3; i++) {
        const server = await serverRegistryService.registerServer({
          name: `Server ${i + 1}`,
          description: `Description ${i + 1}`,
          version: '1.0.0',
          author: 'Multi Corp',
          category: 'utilities',
          tags: [`server${i + 1}`],
          publisherId,
          pricing: { model: 'usage' as const, pricePerInvoke: 100n },
          capabilities: { tools: [], resources: [] },
        });
        await serverRegistryService.updateServerStatus(server.id, 'active');
        servers.push(server);
      }

      // Add ratings to each server
      for (let i = 0; i < servers.length; i++) {
        for (let j = 0; j < 3; j++) {
          await ratingService.submitRating({
            serverId: servers[i].id,
            userId: `user-${i}-${j}`,
            stars: 4 + (j % 2), // Mix of 4 and 5 stars
            review: `Review for server ${i + 1}`,
            verified: true,
          });
        }
      }

      // Record commissions for each server
      for (let i = 0; i < servers.length; i++) {
        const amount = (i + 1) * 50000n; // Varying amounts
        const commission = await commissionService.recordCommission(
          `invoke-multi-${i}`,
          servers[i].id,
          publisherId,
          amount
        );
        await commissionService.confirmCommission(commission.id);
      }

      // Get publisher statistics
      const publisherStats = await serverRegistryService.getPublisherStatistics(publisherId);
      expect(publisherStats.totalServers).toBe(3);
      expect(publisherStats.activeServers).toBe(3);

      // Get publisher's servers
      const publisherServers = await serverRegistryService.getServersByPublisher(publisherId);
      expect(publisherServers).toHaveLength(3);

      // Check each server has ratings
      for (const server of publisherServers) {
        const aggregate = await ratingService.getAggregateRating(server.id);
        expect(aggregate.totalRatings).toBe(3);
        expect(aggregate.averageStars).toBeGreaterThanOrEqual(4);
      }

      // Get publisher commissions
      const commissions = await commissionService.getPublisherCommissions(publisherId, 'confirmed');
      expect(commissions).toHaveLength(3);

      // Revenue report should aggregate across all servers
      const revenue = await commissionService.generateRevenueReport(
        publisherId,
        new Date(Date.now() - 24 * 60 * 60 * 1000),
        new Date()
      );

      expect(revenue.totalEarned).toBeGreaterThan(0n);
      expect(revenue.transactionCount).toBe(3);
    });
  });

  // ==========================================================================
  // WORKFLOW 4: CONTROLLER INTEGRATION
  // ==========================================================================

  describe('Controller → Service Integration', () => {
    it('should handle HTTP request flow through controller', async () => {
      const publisherId = 'publisher-http';
      const userId = 'user-http';

      // STEP 1: Register server via controller
      const registerReq = createMockRequest({
        body: {
          name: 'HTTP Test Server',
          description: 'Testing HTTP flow',
          version: '1.0.0',
          author: 'Test Corp',
          category: 'testing',
          tags: ['test'],
          pricing: { model: 'usage', pricePerInvoke: 100 },
          capabilities: { tools: [], resources: [] },
        },
        user: { id: publisherId, role: 'publisher' },
      });
      const registerRes = createMockResponse();

      await marketplaceController.registerServer(registerReq as any, registerRes as any);

      expect(registerRes.status).toHaveBeenCalledWith(201);
      expect(registerRes.jsonData.success).toBe(true);
      expect(registerRes.jsonData.data.name).toBe('HTTP Test Server');

      const serverId = registerRes.jsonData.data.id;

      // Activate server for rating
      await serverRegistryService.updateServerStatus(serverId, 'active');

      // STEP 2: Submit rating via controller
      const ratingReq = createMockRequest({
        body: {
          serverId,
          stars: 5,
          review: 'Great server!',
          verified: true,
        },
        user: { id: userId, role: 'user' },
      });
      const ratingRes = createMockResponse();

      await marketplaceController.submitRating(ratingReq as any, ratingRes as any);

      expect(ratingRes.status).toHaveBeenCalledWith(201);
      expect(ratingRes.jsonData.success).toBe(true);
      expect(ratingRes.jsonData.data.stars).toBe(5);

      // STEP 3: Get server ratings via controller
      const getRatingsReq = createMockRequest({
        params: { serverId },
        query: { page: '1', limit: '10' },
      });
      const getRatingsRes = createMockResponse();

      await marketplaceController.getServerRatings(getRatingsReq as any, getRatingsRes as any);

      expect(getRatingsRes.jsonData.success).toBe(true);
      expect(getRatingsRes.jsonData.data.items).toHaveLength(1);
      expect(getRatingsRes.jsonData.data.items[0].stars).toBe(5);

      // STEP 4: Search servers via controller
      const searchReq = createMockRequest({
        query: { query: 'HTTP Test', limit: '10' },
      });
      const searchRes = createMockResponse();

      await marketplaceController.searchServers(searchReq as any, searchRes as any);

      expect(searchRes.jsonData.success).toBe(true);
      expect(searchRes.jsonData.data.items.length).toBeGreaterThan(0);
    });

    it('should enforce authorization in controller', async () => {
      const publisherId = 'publisher-auth';
      const otherUserId = 'other-user';

      // Register server
      const server = await serverRegistryService.registerServer({
        name: 'Auth Test Server',
        description: 'Testing authorization',
        version: '1.0.0',
        author: 'Auth Corp',
        category: 'testing',
        tags: ['auth'],
        publisherId,
        pricing: { model: 'usage' as const, pricePerInvoke: 100n },
        capabilities: { tools: [], resources: [] },
      });

      // Attempt to update server as different user (should fail)
      const updateReq = createMockRequest({
        params: { id: server.id },
        body: { description: 'Unauthorized change' },
        user: { id: otherUserId, role: 'user' },
      });
      const updateRes = createMockResponse();

      await marketplaceController.updateServer(updateReq as any, updateRes as any);

      expect(updateRes.status).toHaveBeenCalledWith(403);
      expect(updateRes.jsonData.success).toBe(false);
      expect(updateRes.jsonData.error.code).toBe('UNAUTHORIZED');

      // Attempt to update as owner (should succeed)
      const ownerUpdateReq = createMockRequest({
        params: { id: server.id },
        body: { description: 'Authorized change' },
        user: { id: publisherId, role: 'publisher' },
      });
      const ownerUpdateRes = createMockResponse();

      await marketplaceController.updateServer(ownerUpdateReq as any, ownerUpdateRes as any);

      expect(ownerUpdateRes.jsonData.success).toBe(true);
      expect(ownerUpdateRes.jsonData.data.description).toBe('Authorized change');
    });
  });

  // ==========================================================================
  // WORKFLOW 5: ERROR PROPAGATION
  // ==========================================================================

  describe('Error Propagation Through Layers', () => {
    it('should propagate validation errors from service to controller', async () => {
      const req = createMockRequest({
        body: {
          serverId: 'non-existent',
          stars: 0, // Invalid: must be 1-5
          verified: true,
        },
        user: { id: 'user-1', role: 'user' },
      });
      const res = createMockResponse();

      await marketplaceController.submitRating(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.jsonData.success).toBe(false);
      expect(res.jsonData.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle not found errors correctly', async () => {
      const req = createMockRequest({
        params: { id: 'non-existent-server' },
      });
      const res = createMockResponse();

      await marketplaceController.getServerById(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.jsonData.success).toBe(false);
      expect(res.jsonData.error.code).toBe('SERVER_NOT_FOUND');
    });

    it('should handle rate limit errors', async () => {
      const userId = 'rate-limit-user';
      const serverId = 'server-rate-limit';

      // Register server
      await serverRegistryService.registerServer({
        name: 'Rate Limit Test',
        description: 'Testing rate limits',
        version: '1.0.0',
        author: 'Test',
        category: 'test',
        tags: [],
        publisherId: 'pub-1',
        pricing: { model: 'usage' as const, pricePerInvoke: 100n },
        capabilities: { tools: [], resources: [] },
      });
      await serverRegistryService.updateServerStatus(serverId, 'active');

      // Submit 6 ratings (exceeds 5/hour limit)
      for (let i = 0; i < 6; i++) {
        const req = createMockRequest({
          body: {
            serverId,
            stars: 5,
            review: `Review ${i}`,
            verified: true,
          },
          user: { id: userId, role: 'user' },
        });
        const res = createMockResponse();

        await marketplaceController.submitRating(req as any, res as any);

        if (i < 5) {
          expect(res.jsonData.success).toBe(true);
        } else {
          expect(res.status).toHaveBeenCalledWith(429);
          expect(res.jsonData.error.code).toBe('RATE_LIMIT_EXCEEDED');
        }
      }
    });
  });

  // ==========================================================================
  // WORKFLOW 6: CACHE BEHAVIOR ACROSS SERVICES
  // ==========================================================================

  describe('Cache Behavior Across Services', () => {
    it('should invalidate caches when data changes', async () => {
      const serverId = 'cache-test-server';
      const publisherId = 'cache-pub';

      // Register and activate server
      await serverRegistryService.registerServer({
        name: 'Cache Test',
        description: 'Testing cache',
        version: '1.0.0',
        author: 'Test',
        category: 'test',
        tags: [],
        publisherId,
        pricing: { model: 'usage' as const, pricePerInvoke: 100n },
        capabilities: { tools: [], resources: [] },
      });
      await serverRegistryService.updateServerStatus(serverId, 'active');

      // First aggregate rating query (cold cache)
      const aggregate1 = await ratingService.getAggregateRating(serverId);
      expect(aggregate1.totalRatings).toBe(0);

      // Submit rating
      await ratingService.submitRating({
        serverId,
        userId: 'user-1',
        stars: 5,
        review: 'Great!',
        verified: true,
      });

      // Cache should be invalidated, new query should show updated count
      const aggregate2 = await ratingService.getAggregateRating(serverId);
      expect(aggregate2.totalRatings).toBe(1);
      expect(aggregate2.averageStars).toBe(5);

      // Record commission
      const commission = await commissionService.recordCommission(
        'cache-test-1',
        serverId,
        publisherId,
        50000n
      );
      await commissionService.confirmCommission(commission.id);

      // Revenue report should reflect new commission
      const revenue = await commissionService.generateRevenueReport(
        publisherId,
        new Date(Date.now() - 24 * 60 * 60 * 1000),
        new Date()
      );
      expect(revenue.transactionCount).toBe(1);
      expect(revenue.totalEarned).toBeGreaterThan(0n);
    });
  });

  // ==========================================================================
  // WORKFLOW 7: HEALTH CHECK INTEGRATION
  // ==========================================================================

  describe('Health Check Integration', () => {
    it('should aggregate health status from all services', async () => {
      // Register some data in each service
      const server = await serverRegistryService.registerServer({
        name: 'Health Test',
        description: 'Test',
        version: '1.0.0',
        author: 'Test',
        category: 'test',
        tags: [],
        publisherId: 'pub-health',
        pricing: { model: 'usage' as const, pricePerInvoke: 100n },
        capabilities: { tools: [], resources: [] },
      });
      await serverRegistryService.updateServerStatus(server.id, 'active');

      await ratingService.submitRating({
        serverId: server.id,
        userId: 'user-health',
        stars: 5,
        review: 'Test',
        verified: true,
      });

      const commission = await commissionService.recordCommission(
        'health-test-1',
        server.id,
        'pub-health',
        10000n
      );

      // Health check via controller
      const req = createMockRequest({});
      const res = createMockResponse();

      await marketplaceController.healthCheck(req as any, res as any);

      expect(res.jsonData.success).toBe(true);
      expect(res.jsonData.data.status).toBe('healthy');
      expect(res.jsonData.data.services.serverRegistry.totalServers).toBeGreaterThan(0);
      expect(res.jsonData.data.services.ratings.totalRatings).toBeGreaterThan(0);
      expect(res.jsonData.data.services.commissions.totalCommissions).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // WORKFLOW 8: EVENT PROPAGATION
  // ==========================================================================

  describe('Event Propagation Across Services', () => {
    it('should emit and receive events across service boundaries', async () => {
      const events: any[] = [];

      // Listen to events from all services
      serverRegistryService.on('server:registered', (e) =>
        events.push({ service: 'registry', event: 'registered', data: e })
      );
      ratingService.on('rating:submitted', (e) =>
        events.push({ service: 'rating', event: 'submitted', data: e })
      );
      commissionService.on('commission:recorded', (e) =>
        events.push({ service: 'commission', event: 'recorded', data: e })
      );

      // Trigger workflow
      const server = await serverRegistryService.registerServer({
        name: 'Event Test',
        description: 'Test',
        version: '1.0.0',
        author: 'Test',
        category: 'test',
        tags: [],
        publisherId: 'pub-event',
        pricing: { model: 'usage' as const, pricePerInvoke: 100n },
        capabilities: { tools: [], resources: [] },
      });
      await serverRegistryService.updateServerStatus(server.id, 'active');

      await ratingService.submitRating({
        serverId: server.id,
        userId: 'user-event',
        stars: 5,
        review: 'Test',
        verified: true,
      });

      await commissionService.recordCommission('event-test-1', server.id, 'pub-event', 10000n);

      await waitForEvents();

      // Verify events were emitted
      expect(events).toHaveLength(3);
      expect(events[0].service).toBe('registry');
      expect(events[1].service).toBe('rating');
      expect(events[2].service).toBe('commission');
    });
  });
});
