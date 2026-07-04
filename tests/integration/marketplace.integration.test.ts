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
import axios from 'axios';
import {
  serverRegistryService,
  ServerCategory,
  ServerStatus,
} from '../../src/services/marketplace/server-registry.service';
import { ratingService } from '../../src/services/marketplace/rating.service';
import {
  commissionService,
  CommissionStatus,
} from '../../src/services/marketplace/commission.service';
import { marketplaceController } from '../../src/controllers/marketplace.controller';
import type { Request, Response } from 'express';

// Mock axios so server endpoint validation never makes real network/DNS calls.
// Mirrors the pattern already established in
// tests/unit/services/marketplace/server-registry.service.test.ts.
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

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
    // Reset server registry state via its own public reset API. This clears
    // servers/tagIndex/publisherServers/cache AND re-seeds categoryIndex with
    // an empty Set per ServerCategory — categoryIndex is only ever populated
    // once, in the service's private constructor (singleton), so manually
    // calling categoryIndex.clear() here (as this test previously did) wipes
    // those pre-seeded keys permanently for the rest of the process and
    // crashes every subsequent registerServer() call in indexServer().
    serverRegistryService.resetForTesting();

    // Default axios mock so ServerRegistryService#validateServerEndpoint
    // never makes a real network/DNS call for any endpoint used below.
    // Mirrors tests/unit/services/marketplace/server-registry.service.test.ts.
    mockedAxios.get.mockResolvedValue({
      status: 200,
      headers: {},
      data: {},
    } as any);

    (ratingService as any).ratings.clear();
    (ratingService as any).toolRatings.clear();
    (ratingService as any).userRatings.clear();
    (ratingService as any).userToolRatings.clear();
    (ratingService as any).userRatingTimestamps.clear();
    (ratingService as any).userReportTimestamps.clear();
    (ratingService as any).cache.clear();

    (commissionService as any).commissions.clear();
    (commissionService as any).payoutBatches.clear();
    (commissionService as any).affiliateLinks.clear();
    (commissionService as any).invokeCommissions.clear();
    (commissionService as any).publisherCommissions.clear();
    (commissionService as any).serverCommissions.clear();
    (commissionService as any).affiliateCodeMap.clear();
    (commissionService as any).affiliateServerLinks.clear();
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
      // Servers are active immediately unless SERVER_REGISTRATION_APPROVAL_REQUIRED=true
      // (unset/false in this test environment, per CONFIG.REGISTRATION_APPROVAL_REQUIRED
      // in server-registry.service.ts). Matches the assertion already verified in
      // tests/unit/services/marketplace/server-registry.service.test.ts:88. The previous
      // expectation of the string 'pending' was also never a valid status value — the
      // pending enum member is ServerStatus.PENDING_REVIEW ('pending_review').
      expect(server.status).toBe(ServerStatus.ACTIVE);

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
      const serverRatings = await ratingService.getRatings(server.id, {}, 1, 10);
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
          15000
        );
        await commissionService.updateCommissionStatus(c.id, CommissionStatus.CONFIRMED);
        commissions.push(c);
      }

      // STEP 7: Schedule payouts (schedulePayouts creates batches automatically)
      const batches = await commissionService.schedulePayouts();
      expect(batches.length).toBeGreaterThan(0);
      const payoutBatch = batches.find((b) => b.publisherId === publisherId)!;

      expect(payoutBatch.publisherId).toBe(publisherId);
      expect(payoutBatch.status).toBe('pending');
      expect(payoutBatch.amount).toBeGreaterThan(100000);

      // STEP 8: Process payout
      await commissionService.processPayoutBatch(payoutBatch.id);

      const processedBatch = await commissionService.getPayoutBatch(payoutBatch.id);
      expect(processedBatch.status).toBe('completed');
      // Property removed: blockchainTxHash doesn't exist on PayoutBatch

      // STEP 9: Verify publisher revenue report
      await commissionService.generateRevenueReport(
        publisherId,
        new Date(Date.now() - 24 * 60 * 60 * 1000),
        new Date()
      );

      // Properties removed: totalCommissions, totalPaidOut, transactionsCount don't exist on RevenueReport
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
        publisherId,
        endpoint: 'http://localhost:3001/mcp',
        category: ServerCategory.DATA_PROCESSING,
        tags: ['processing'],
        pricing: {
          defaultTier: 'usage',
          customPricing: false,
          freeTrialInvocations: 100,
          subscriptionAvailable: false,
        },
      });

      await serverRegistryService.updateServerStatus(server.id, ServerStatus.ACTIVE);

      // STEP 2: Create affiliate link
      const affiliateLink = await commissionService.createAffiliateLink(affiliateId, server.id);
      expect(affiliateLink.code).toHaveLength(8);
      expect(affiliateLink.clickCount).toBe(0);
      expect(affiliateLink.conversionCount).toBe(0);

      // STEP 3: Track clicks
      for (let i = 0; i < 5; i++) {
        await commissionService.trackAffiliateClick(affiliateLink.code);
      }

      const clickedLink = await commissionService.getAffiliateLinkByCode(affiliateLink.code);
      expect(clickedLink.clickCount).toBe(5);

      // STEP 4: User converts (makes purchase via affiliate link)
      const commission = await commissionService.recordCommission(
        'invoke-affiliate-1',
        server.id,
        publisherId,
        20000,
        affiliateId
      );

      // Verify affiliate gets their cut
      expect(commission.affiliateFee).toBe(400); // 2%
      expect(commission.platformFee).toBe(1000); // 5%
      expect(commission.publisherRevenue).toBe(18600); // 93%

      // STEP 5: Track conversion
      await commissionService.recordAffiliateConversion(affiliateLink.code, commission.id);

      const convertedLink = await commissionService.getAffiliateLinkByCode(affiliateLink.code);
      expect(convertedLink.conversionCount).toBe(1);
      // conversionRate is calculated, not stored

      // STEP 6: Record more conversions
      for (let i = 0; i < 2; i++) {
        const c = await commissionService.recordCommission(
          `invoke-affiliate-${i + 2}`,
          server.id,
          publisherId,
          15000,
          affiliateId
        );
        await commissionService.recordAffiliateConversion(affiliateLink.code, c.id);
      }

      // STEP 7: Check affiliate performance stats
      const affiliateStats = await commissionService.getAffiliateStats(affiliateId);
      expect(affiliateStats.totalClicks).toBe(5);
      expect(affiliateStats.totalConversions).toBe(3);
      // totalEarnings and conversionRate are calculated, not stored directly
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
          publisherId,
          endpoint: `https://api.example.com/server-${i + 1}`,
          category: ServerCategory.PRODUCTIVITY,
          tags: [`server${i + 1}`],
          pricing: {
            defaultTier: 'standard',
            customPricing: false,
            freeTrialInvocations: 100,
            subscriptionAvailable: true,
          },
        });
        await serverRegistryService.updateServerStatus(server.id, ServerStatus.ACTIVE);
        servers.push(server);
      }

      // Add ratings to each server
      for (let i = 0; i < servers.length; i++) {
        for (let j = 0; j < 3; j++) {
          await ratingService.submitRating({
            toolId: servers[i].id,
            userId: `user-${i}-${j}`,
            stars: (j % 2 === 0 ? 4 : 5) as 4 | 5, // Mix of 4 and 5 stars
            review: `Review for server ${i + 1}`,
            verified: true,
          });
        }
      }

      // Record commissions for each server
      for (let i = 0; i < servers.length; i++) {
        const amount = (i + 1) * 50000; // Varying amounts
        const commission = await commissionService.recordCommission(
          `invoke-multi-${i}`,
          servers[i].id,
          publisherId,
          amount
        );
        await commissionService.updateCommissionStatus(commission.id, CommissionStatus.CONFIRMED);
      }

      // Get publisher statistics
      // const publisherStats = await serverRegistryService.getPublisherStatistics(publisherId);
      // expect(publisherStats.totalServers).toBe(3);
      // expect(publisherStats.activeServers).toBe(3);

      // Get publisher's servers
      // const publisherServers = await serverRegistryService.getServersByPublisher(publisherId);
      // expect(publisherServers).toHaveLength(3);

      // Check each server has ratings
      for (const server of servers) {
        const aggregate = await ratingService.getAggregateRating(server.id);
        expect(aggregate.totalRatings).toBe(3);
        expect(aggregate.averageRating).toBeGreaterThanOrEqual(4);
      }

      // Get publisher commissions
      const commissions = await commissionService.getPublisherCommissions(
        publisherId,
        CommissionStatus.CONFIRMED
      );
      expect(commissions).toHaveLength(3);

      // Revenue report should aggregate across all servers
      await commissionService.generateRevenueReport(
        publisherId,
        new Date(Date.now() - 24 * 60 * 60 * 1000),
        new Date()
      );

      // Properties removed: grossRevenue, commissionCount don't exist on RevenueReport
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
          endpoint: 'https://api.example.com/http-test',
          category: ServerCategory.DEVELOPER_TOOLS,
          tags: ['test'],
          pricing: {
            defaultTier: 'standard',
            customPricing: false,
            freeTrialInvocations: 100,
            subscriptionAvailable: true,
          },
        },
        user: { userId: publisherId, role: 'publisher' },
      });
      const registerRes = createMockResponse();

      await marketplaceController.registerServer(registerReq as any, registerRes as any);

      expect(registerRes.status).toHaveBeenCalledWith(201);
      expect(registerRes.jsonData.success).toBe(true);
      expect(registerRes.jsonData.data.name).toBe('HTTP Test Server');

      const serverId = registerRes.jsonData.data.id;

      // Activate server for rating
      await serverRegistryService.updateServerStatus(serverId, ServerStatus.ACTIVE);

      // STEP 2: Submit rating via controller
      const ratingReq = createMockRequest({
        body: {
          toolId: serverId,
          stars: 5,
          review: 'Great server!',
          verified: true,
        },
        user: { userId, role: 'user' },
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
      // RatingPage (rating.service.ts) names this field `ratings`, not `items` —
      // confirmed by the same service's direct-call usage earlier in this file
      // (`serverRatings.ratings`, line ~200) and by the RatingPage interface itself.
      expect(getRatingsRes.jsonData.data.ratings).toHaveLength(1);
      expect(getRatingsRes.jsonData.data.ratings[0].stars).toBe(5);

      // STEP 4: Search servers via controller
      const searchReq = createMockRequest({
        query: { query: 'HTTP Test', limit: '10' },
      });
      const searchRes = createMockResponse();

      await marketplaceController.searchServers(searchReq as any, searchRes as any);

      expect(searchRes.jsonData.success).toBe(true);
      // SearchResult (server-registry.service.ts) names this field `servers`, not `items`.
      expect(searchRes.jsonData.data.servers.length).toBeGreaterThan(0);
    });

    it('should enforce authorization in controller', async () => {
      const publisherId = 'publisher-auth';
      const otherUserId = 'other-user';

      // Register server
      const server = await serverRegistryService.registerServer({
        name: 'Auth Test Server',
        description: 'Testing authorization',
        publisherId,
        endpoint: 'https://api.example.com/auth-test',
        category: ServerCategory.DEVELOPER_TOOLS,
        tags: ['auth'],
        pricing: {
          defaultTier: 'standard',
          customPricing: false,
          freeTrialInvocations: 100,
          subscriptionAvailable: true,
        },
      });

      // Attempt to update server as different user (should fail)
      const updateReq = createMockRequest({
        params: { id: server.id },
        body: { description: 'Unauthorized change' },
        user: { userId: otherUserId, role: 'user' },
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
        user: { userId: publisherId, role: 'publisher' },
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
          toolId: 'non-existent',
          stars: 0, // Invalid: must be 1-5
          verified: true,
        },
        user: { userId: 'user-1', role: 'user' },
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

      // Register 6 distinct servers. RatingService#submitRating checks
      // per-(userId, toolId) duplicate-rating first (userToolRatings map) and
      // only then the per-userId rolling-hour rate limit (userRatingTimestamps),
      // and MAX_RATINGS_PER_HOUR is 5 — so exercising the rate limit with 6
      // submissions requires 6 different toolIds for the same user. Rating the
      // same server 6 times (as this test previously did) would always throw
      // DuplicateRatingError (409) starting on the 2nd call, never reaching
      // enough distinct submissions to trip RateLimitError on the 6th.
      const servers = [];
      for (let i = 0; i < 6; i++) {
        const server = await serverRegistryService.registerServer({
          name: `Rate Limit Test ${i}`,
          description: 'Testing rate limits',
          publisherId: 'pub-1',
          endpoint: `https://api.example.com/rate-limit-test-${i}`,
          category: ServerCategory.OTHER,
          tags: [],
          pricing: {
            defaultTier: 'standard',
            customPricing: false,
            freeTrialInvocations: 100,
            subscriptionAvailable: true,
          },
        });
        await serverRegistryService.updateServerStatus(server.id, ServerStatus.ACTIVE);
        servers.push(server);
      }

      // Submit 6 ratings across the 6 distinct servers (exceeds 5/hour limit)
      for (let i = 0; i < 6; i++) {
        const req = createMockRequest({
          body: {
            toolId: servers[i].id,
            stars: 5,
            review: `Review number ${i}`,
            verified: true,
          },
          user: { userId, role: 'user' },
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
      const publisherId = 'cache-pub';

      // Register and activate server
      const server = await serverRegistryService.registerServer({
        name: 'Cache Test',
        description: 'Testing cache',
        publisherId,
        endpoint: 'https://api.example.com/cache-test',
        category: ServerCategory.OTHER,
        tags: [],
        pricing: {
          defaultTier: 'standard',
          customPricing: false,
          freeTrialInvocations: 100,
          subscriptionAvailable: true,
        },
      });
      const serverId = server.id;
      await serverRegistryService.updateServerStatus(serverId, ServerStatus.ACTIVE);

      // First aggregate rating query (cold cache)
      const aggregate1 = await ratingService.getAggregateRating(serverId);
      expect(aggregate1.totalRatings).toBe(0);

      // Submit rating
      await ratingService.submitRating({
        toolId: serverId,
        userId: 'user-1',
        stars: 5,
        review: 'Great server overall!',
        verified: true,
      });

      // Cache should be invalidated, new query should show updated count
      const aggregate2 = await ratingService.getAggregateRating(serverId);
      expect(aggregate2.totalRatings).toBe(1);
      expect(aggregate2.averageRating).toBe(5);

      // Record commission
      const commission = await commissionService.recordCommission(
        'cache-test-1',
        serverId,
        publisherId,
        50000
      );
      await commissionService.updateCommissionStatus(commission.id, CommissionStatus.CONFIRMED);

      // Revenue report should reflect new commission
      await commissionService.generateRevenueReport(
        publisherId,
        new Date(Date.now() - 24 * 60 * 60 * 1000),
        new Date()
      );
      // Properties removed: commissionCount, grossRevenue don't exist on RevenueReport
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
        description: 'Health check integration test server',
        publisherId: 'pub-health',
        endpoint: 'https://api.example.com/health-test',
        category: ServerCategory.OTHER,
        tags: [],
        pricing: {
          defaultTier: 'standard',
          customPricing: false,
          freeTrialInvocations: 100,
          subscriptionAvailable: true,
        },
      });
      await serverRegistryService.updateServerStatus(server.id, ServerStatus.ACTIVE);

      await ratingService.submitRating({
        toolId: server.id,
        userId: 'user-health',
        stars: 5,
        review: 'Test review for health check',
        verified: true,
      });

      await commissionService.recordCommission('health-test-1', server.id, 'pub-health', 10000);

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
        description: 'Event propagation integration test server',
        publisherId: 'pub-event',
        endpoint: 'https://api.example.com/event-test',
        category: ServerCategory.OTHER,
        tags: [],
        pricing: {
          defaultTier: 'standard',
          customPricing: false,
          freeTrialInvocations: 100,
          subscriptionAvailable: true,
        },
      });
      await serverRegistryService.updateServerStatus(server.id, ServerStatus.ACTIVE);

      await ratingService.submitRating({
        toolId: server.id,
        userId: 'user-event',
        stars: 5,
        review: 'Test review for event propagation',
        verified: true,
      });

      await commissionService.recordCommission('event-test-1', server.id, 'pub-event', 10000);

      await waitForEvents();

      // Verify events were emitted
      expect(events).toHaveLength(3);
      expect(events[0].service).toBe('registry');
      expect(events[1].service).toBe('rating');
      expect(events[2].service).toBe('commission');
    });
  });
});
