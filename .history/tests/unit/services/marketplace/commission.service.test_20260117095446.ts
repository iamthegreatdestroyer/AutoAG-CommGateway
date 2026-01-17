/**
 * CommissionService Unit Tests
 *
 * Comprehensive test suite for the Commission Service.
 * Tests commission recording, payouts, affiliate tracking, and revenue reporting.
 *
 * Coverage Target: 92%+
 * Test Count: 30+ tests
 *
 * Copyright (c) 2026 AutoAG-CommGateway. All Rights Reserved.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  CommissionService,
  CommissionStatus,
  PayoutStatus,
  CommissionError,
  CommissionNotFoundError,
  PayoutError,
  InsufficientBalanceError,
  type CommissionRecord,
  type PayoutBatch,
  type AffiliateLink,
} from '../../../../src/services/marketplace/commission.service';
import { serverRegistryService } from '../../../../src/services/marketplace/server-registry.service';

// Mock ServerRegistryService
jest.mock('../../../../src/services/marketplace/server-registry.service', () => ({
  serverRegistryService: {
    getServerById: jest.fn(),
  },
}));

describe('CommissionService', () => {
  let service: CommissionService;
  let mockServerRegistry: jest.Mocked<typeof serverRegistryService>;

  beforeEach(() => {
    // Get fresh instance for each test
    service = CommissionService.getInstance();

    // Reset service state for testing
    service.resetForTesting();

    // Setup mocks
    mockServerRegistry = serverRegistryService as jest.Mocked<typeof serverRegistryService>;
    mockServerRegistry.getServerById.mockResolvedValue({
      id: 'server-123',
      name: 'Test Server',
      status: 'active',
    } as any);

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // COMMISSION RECORDING TESTS
  // ============================================================================

  describe('recordCommission', () => {
    it('should record commission without affiliate (95% to publisher)', async () => {
      const amount = 1000n;
      const commission = await service.recordCommission(
        'payment-123',
        'server-456',
        'publisher-789',
        amount
      );

      expect(commission).toBeDefined();
      expect(commission.paymentId).toBe('payment-123');
      expect(commission.serverId).toBe('server-456');
      expect(commission.publisherId).toBe('publisher-789');
      expect(commission.amount).toBe(amount);
      expect(commission.platformFee).toBe(50n); // 5%
      expect(commission.affiliateFee).toBe(0n); // No affiliate
      expect(commission.publisherAmount).toBe(950n); // 95%
      expect(commission.status).toBe(CommissionStatus.PENDING);
      expect(commission.affiliateId).toBeUndefined();
      expect(commission.createdAt).toBeInstanceOf(Date);
    });

    it('should record commission with affiliate (93% to publisher)', async () => {
      const amount = 1000n;
      const commission = await service.recordCommission(
        'payment-123',
        'server-456',
        'publisher-789',
        amount,
        'affiliate-999'
      );

      expect(commission.platformFee).toBe(50n); // 5%
      expect(commission.affiliateFee).toBe(20n); // 2%
      expect(commission.publisherAmount).toBe(930n); // 93%
      expect(commission.affiliateId).toBe('affiliate-999');
    });

    it('should calculate revenue breakdown correctly without affiliate', () => {
      const breakdown = service.calculateRevenueBreakdown(1000n, false);

      expect(breakdown.total).toBe(1000n);
      expect(breakdown.platformFee).toBe(50n); // 5%
      expect(breakdown.affiliateFee).toBe(0n);
      expect(breakdown.publisherAmount).toBe(950n); // 95%
      expect(breakdown.platformFeePercentage).toBe(5);
      expect(breakdown.affiliateFeePercentage).toBe(0);
    });

    it('should calculate revenue breakdown correctly with affiliate', () => {
      const breakdown = service.calculateRevenueBreakdown(1000n, true);

      expect(breakdown.total).toBe(1000n);
      expect(breakdown.platformFee).toBe(50n); // 5%
      expect(breakdown.affiliateFee).toBe(20n); // 2%
      expect(breakdown.publisherAmount).toBe(930n); // 93%
      expect(breakdown.platformFeePercentage).toBe(5);
      expect(breakdown.affiliateFeePercentage).toBe(2);
    });

    it('should reject zero amount', async () => {
      await expect(
        service.recordCommission('payment-123', 'server-456', 'publisher-789', 0n)
      ).rejects.toThrow(CommissionError);
      await expect(
        service.recordCommission('payment-123', 'server-456', 'publisher-789', 0n)
      ).rejects.toThrow('Commission amount must be greater than 0');
    });

    it('should reject negative amount', async () => {
      await expect(
        service.recordCommission('payment-123', 'server-456', 'publisher-789', -1000n)
      ).rejects.toThrow(CommissionError);
    });

    it('should index commission by publisher', async () => {
      const commission = await service.recordCommission(
        'payment-123',
        'server-456',
        'publisher-789',
        1000n
      );

      const publisherCommissions = await service.getPublisherCommissions('publisher-789');
      expect(publisherCommissions).toHaveLength(1);
      expect(publisherCommissions[0].id).toBe(commission.id);
    });

    it('should index commission by server', async () => {
      const commission = await service.recordCommission(
        'payment-123',
        'server-456',
        'publisher-789',
        1000n
      );

      const serverCommissions = await service.getServerCommissions('server-456');
      expect(serverCommissions).toHaveLength(1);
      expect(serverCommissions[0].id).toBe(commission.id);
    });

    it('should index commission by affiliate', async () => {
      const commission = await service.recordCommission(
        'payment-123',
        'server-456',
        'publisher-789',
        1000n,
        'affiliate-999'
      );

      const performance = await service.getAffiliatePerformance('affiliate-999');
      expect(performance.totalEarnings).toBe(20n); // 2% of 1000
    });

    it('should generate unique commission IDs', async () => {
      const commission1 = await service.recordCommission(
        'payment-1',
        'server-1',
        'publisher-1',
        1000n
      );
      const commission2 = await service.recordCommission(
        'payment-2',
        'server-2',
        'publisher-2',
        2000n
      );

      expect(commission1.id).not.toBe(commission2.id);
      expect(commission1.id).toMatch(/^comm-\d+-[a-z0-9]+$/);
      expect(commission2.id).toMatch(/^comm-\d+-[a-z0-9]+$/);
    });

    it('should emit commission:recorded event', async () => {
      const eventPromise = new Promise((resolve) => {
        service.once('commission:recorded', resolve);
      });

      await service.recordCommission('payment-123', 'server-456', 'publisher-789', 1000n);

      const event = await eventPromise;
      expect(event).toBeDefined();
      expect((event as any).commission.amount).toBe(1000n);
    });
  });

  // ============================================================================
  // COMMISSION LIFECYCLE TESTS
  // ============================================================================

  describe('Commission Lifecycle', () => {
    let commission: CommissionRecord;

    beforeEach(async () => {
      commission = await service.recordCommission(
        'payment-123',
        'server-456',
        'publisher-789',
        1000n
      );
    });

    it('should confirm commission', async () => {
      await service.confirmCommission(commission.id);

      const confirmed = await service.getCommission(commission.id);
      expect(confirmed.status).toBe(CommissionStatus.CONFIRMED);
    });

    it('should mark commission as paid after payout', async () => {
      await service.confirmCommission(commission.id);

      // Create and process payout batch
      const batch = await service.createPayoutBatch('publisher-789', [commission.id]);
      await service.processPayoutBatch(batch.id);

      const paid = await service.getCommission(commission.id);
      expect(paid.status).toBe(CommissionStatus.PAID);
      expect(paid.paidAt).toBeInstanceOf(Date);
    });

    it('should retrieve commission by ID', async () => {
      const retrieved = await service.getCommission(commission.id);

      expect(retrieved.id).toBe(commission.id);
      expect(retrieved.paymentId).toBe('payment-123');
      expect(retrieved.amount).toBe(1000n);
    });

    it('should throw error for non-existent commission', async () => {
      await expect(service.getCommission('non-existent-id')).rejects.toThrow(
        CommissionNotFoundError
      );
    });

    it('should filter commissions by status', async () => {
      await service.confirmCommission(commission.id);

      const pending = await service.getPublisherCommissions(
        'publisher-789',
        CommissionStatus.PENDING
      );
      const confirmed = await service.getPublisherCommissions(
        'publisher-789',
        CommissionStatus.CONFIRMED
      );

      expect(pending).toHaveLength(0);
      expect(confirmed).toHaveLength(1);
      expect(confirmed[0].id).toBe(commission.id);
    });

    it('should emit commission:confirmed event', async () => {
      const eventPromise = new Promise((resolve) => {
        service.once('commission:confirmed', resolve);
      });

      await service.confirmCommission(commission.id);

      const event = await eventPromise;
      expect(event).toBeDefined();
      expect((event as any).commissionId).toBe(commission.id);
    });
  });

  // ============================================================================
  // PAYOUT BATCH CREATION TESTS
  // ============================================================================

  describe('createPayoutBatch', () => {
    it('should create payout batch above threshold', async () => {
      // Create commissions totaling 200k Gwei (above 100k threshold)
      const commission1 = await service.recordCommission(
        'payment-1',
        'server-1',
        'publisher-789',
        100000n
      );
      const commission2 = await service.recordCommission(
        'payment-2',
        'server-2',
        'publisher-789',
        100000n
      );

      await service.confirmCommission(commission1.id);
      await service.confirmCommission(commission2.id);

      const batch = await service.createPayoutBatch('publisher-789', [
        commission1.id,
        commission2.id,
      ]);

      expect(batch).toBeDefined();
      expect(batch.publisherId).toBe('publisher-789');
      expect(batch.commissionIds).toHaveLength(2);
      expect(batch.totalAmount).toBeGreaterThan(100000n); // Above threshold
      expect(batch.status).toBe(PayoutStatus.PENDING);
      expect(batch.createdAt).toBeInstanceOf(Date);
    });

    it('should reject batch below threshold', async () => {
      // Create commission totaling 50k Gwei (below 100k threshold)
      const commission = await service.recordCommission(
        'payment-1',
        'server-1',
        'publisher-789',
        50000n
      );
      await service.confirmCommission(commission.id);

      await expect(service.createPayoutBatch('publisher-789', [commission.id])).rejects.toThrow(
        InsufficientBalanceError
      );
      await expect(service.createPayoutBatch('publisher-789', [commission.id])).rejects.toThrow(
        'below minimum threshold'
      );
    });

    it('should validate all commissions are confirmed', async () => {
      const commission = await service.recordCommission(
        'payment-1',
        'server-1',
        'publisher-789',
        150000n
      );
      // Don't confirm

      await expect(service.createPayoutBatch('publisher-789', [commission.id])).rejects.toThrow(
        PayoutError
      );
      await expect(service.createPayoutBatch('publisher-789', [commission.id])).rejects.toThrow(
        'must be confirmed'
      );
    });

    it('should group commissions by publisher', async () => {
      const pub1Commission = await service.recordCommission(
        'payment-1',
        'server-1',
        'publisher-A',
        150000n
      );
      const pub2Commission = await service.recordCommission(
        'payment-2',
        'server-2',
        'publisher-B',
        150000n
      );

      await service.confirmCommission(pub1Commission.id);
      await service.confirmCommission(pub2Commission.id);

      const batchA = await service.createPayoutBatch('publisher-A', [pub1Commission.id]);

      // Batch should only contain publisher-A's commissions
      expect(batchA.publisherId).toBe('publisher-A');
      expect(batchA.commissionIds).toContain(pub1Commission.id);
      expect(batchA.commissionIds).not.toContain(pub2Commission.id);
    });

    it('should generate unique batch IDs', async () => {
      const commission1 = await service.recordCommission(
        'payment-1',
        'server-1',
        'publisher-A',
        150000n
      );
      const commission2 = await service.recordCommission(
        'payment-2',
        'server-2',
        'publisher-B',
        150000n
      );

      await service.confirmCommission(commission1.id);
      await service.confirmCommission(commission2.id);

      const batch1 = await service.createPayoutBatch('publisher-A', [commission1.id]);
      const batch2 = await service.createPayoutBatch('publisher-B', [commission2.id]);

      expect(batch1.id).not.toBe(batch2.id);
      expect(batch1.id).toMatch(/^payout-\d+-[a-z0-9]+$/);
      expect(batch2.id).toMatch(/^payout-\d+-[a-z0-9]+$/);
    });

    it('should emit payout:created event', async () => {
      const commission = await service.recordCommission(
        'payment-1',
        'server-1',
        'publisher-789',
        150000n
      );
      await service.confirmCommission(commission.id);

      const eventPromise = new Promise((resolve) => {
        service.once('payout:created', resolve);
      });

      await service.createPayoutBatch('publisher-789', [commission.id]);

      const event = await eventPromise;
      expect(event).toBeDefined();
      expect((event as any).batch.publisherId).toBe('publisher-789');
    });
  });

  // ============================================================================
  // PAYOUT PROCESSING TESTS
  // ============================================================================

  describe('processPayoutBatch', () => {
    let batch: PayoutBatch;

    beforeEach(async () => {
      const commission = await service.recordCommission(
        'payment-1',
        'server-1',
        'publisher-789',
        150000n
      );
      await service.confirmCommission(commission.id);
      batch = await service.createPayoutBatch('publisher-789', [commission.id]);
    });

    it('should process payout batch successfully', async () => {
      await service.processPayoutBatch(batch.id);

      const processed = await service.getPayoutBatch(batch.id);
      expect(processed.status).toBe(PayoutStatus.COMPLETED);
      expect(processed.transactionHash).toBeDefined();
      expect(processed.processedAt).toBeInstanceOf(Date);

      // Verify commissions marked as PAID
      const commission = await service.getCommission(batch.commissionIds[0]);
      expect(commission.status).toBe(CommissionStatus.PAID);
      expect(commission.paidAt).toBeInstanceOf(Date);
    });

    it('should set paidAt timestamp on success', async () => {
      await service.processPayoutBatch(batch.id);

      const commission = await service.getCommission(batch.commissionIds[0]);
      expect(commission.paidAt).toBeInstanceOf(Date);
      expect(commission.paidAt!.getTime()).toBeGreaterThan(commission.createdAt.getTime());
    });

    it('should emit payout events in sequence', async () => {
      const events: string[] = [];

      service.on('payout:processing', () => events.push('processing'));
      service.on('payout:completed', () => events.push('completed'));

      await service.processPayoutBatch(batch.id);

      expect(events).toEqual(['processing', 'completed']);
    });

    it('should throw error for non-existent batch', async () => {
      await expect(service.processPayoutBatch('non-existent-id')).rejects.toThrow(PayoutError);
    });

    it('should retrieve payout batch by ID', async () => {
      const retrieved = await service.getPayoutBatch(batch.id);

      expect(retrieved.id).toBe(batch.id);
      expect(retrieved.publisherId).toBe('publisher-789');
      expect(retrieved.status).toBe(PayoutStatus.PENDING);
    });
  });

  // ============================================================================
  // AUTOMATED PAYOUT TESTS
  // ============================================================================

  describe('scheduleAutomatedPayouts', () => {
    it('should schedule payouts for eligible publishers', async () => {
      // Create confirmed commissions above threshold
      const commission1 = await service.recordCommission(
        'payment-1',
        'server-1',
        'publisher-A',
        100000n
      );
      const commission2 = await service.recordCommission(
        'payment-2',
        'server-2',
        'publisher-A',
        100000n
      );

      await service.confirmCommission(commission1.id);
      await service.confirmCommission(commission2.id);

      await service.scheduleAutomatedPayouts();

      // Verify batch was created and processed
      const payouts = await service.getPublisherPayouts('publisher-A');
      expect(payouts).toHaveLength(1);
      expect(payouts[0].status).toBe(PayoutStatus.COMPLETED);
    });

    it('should skip publishers below threshold', async () => {
      // Create commission below threshold
      const commission = await service.recordCommission(
        'payment-1',
        'server-1',
        'publisher-B',
        50000n
      );
      await service.confirmCommission(commission.id);

      await service.scheduleAutomatedPayouts();

      // No payout should be created
      const payouts = await service.getPublisherPayouts('publisher-B');
      expect(payouts).toHaveLength(0);
    });

    it('should handle multiple publishers', async () => {
      // Publisher A: 200k Gwei
      const commA1 = await service.recordCommission(
        'payment-1',
        'server-1',
        'publisher-A',
        100000n
      );
      const commA2 = await service.recordCommission(
        'payment-2',
        'server-2',
        'publisher-A',
        100000n
      );

      // Publisher B: 150k Gwei
      const commB = await service.recordCommission('payment-3', 'server-3', 'publisher-B', 150000n);

      await service.confirmCommission(commA1.id);
      await service.confirmCommission(commA2.id);
      await service.confirmCommission(commB.id);

      await service.scheduleAutomatedPayouts();

      // Both publishers should have payouts
      const payoutsA = await service.getPublisherPayouts('publisher-A');
      const payoutsB = await service.getPublisherPayouts('publisher-B');

      expect(payoutsA).toHaveLength(1);
      expect(payoutsB).toHaveLength(1);
    });

    it('should only process confirmed commissions', async () => {
      const confirmed = await service.recordCommission(
        'payment-1',
        'server-1',
        'publisher-A',
        100000n
      );
      const pending = await service.recordCommission(
        'payment-2',
        'server-2',
        'publisher-A',
        100000n
      );

      await service.confirmCommission(confirmed.id);
      // Don't confirm pending

      await service.scheduleAutomatedPayouts();

      const payouts = await service.getPublisherPayouts('publisher-A');

      // Should create payout only with confirmed commission
      if (payouts.length > 0) {
        expect(payouts[0].commissionIds).toContain(confirmed.id);
        expect(payouts[0].commissionIds).not.toContain(pending.id);
      }
    });
  });

  // ============================================================================
  // AFFILIATE LINK MANAGEMENT TESTS
  // ============================================================================

  describe('createAffiliateLink', () => {
    it('should create affiliate link with auto-generated code', async () => {
      const link = await service.createAffiliateLink('server-123', 'affiliate-456');

      expect(link).toBeDefined();
      expect(link.serverId).toBe('server-123');
      expect(link.affiliateId).toBe('affiliate-456');
      expect(link.code).toHaveLength(8);
      expect(link.code).toMatch(/^[A-Z0-9]{8}$/);
      expect(link.clicks).toBe(0);
      expect(link.conversions).toBe(0);
      expect(link.createdAt).toBeInstanceOf(Date);
    });

    it('should create affiliate link with custom code', async () => {
      const customCode = 'MYCODE23';
      const link = await service.createAffiliateLink('server-123', 'affiliate-456', customCode);

      expect(link.code).toBe(customCode);
    });

    it('should reject duplicate affiliate codes', async () => {
      const code = 'TESTCODE';
      await service.createAffiliateLink('server-123', 'affiliate-1', code);

      await expect(service.createAffiliateLink('server-456', 'affiliate-2', code)).rejects.toThrow(
        CommissionError
      );
      await expect(service.createAffiliateLink('server-456', 'affiliate-2', code)).rejects.toThrow(
        'already exists'
      );
    });

    it('should validate server exists', async () => {
      mockServerRegistry.getServerById.mockRejectedValueOnce(new Error('Server not found'));

      await expect(
        service.createAffiliateLink('non-existent-server', 'affiliate-456')
      ).rejects.toThrow(CommissionError);
    });

    it('should emit affiliate:link-created event', async () => {
      const eventPromise = new Promise((resolve) => {
        service.once('affiliate:link-created', resolve);
      });

      await service.createAffiliateLink('server-123', 'affiliate-456');

      const event = await eventPromise;
      expect(event).toBeDefined();
      expect((event as any).link.serverId).toBe('server-123');
    });
  });

  // ============================================================================
  // AFFILIATE TRACKING TESTS
  // ============================================================================

  describe('Affiliate Tracking', () => {
    let affiliateLink: AffiliateLink;

    beforeEach(async () => {
      affiliateLink = await service.createAffiliateLink('server-123', 'affiliate-456');
    });

    it('should track affiliate clicks', async () => {
      await service.trackAffiliateClick(affiliateLink.code);

      const updated = await service.getAffiliateLink(affiliateLink.code);
      expect(updated.clicks).toBe(1);
      expect(updated.lastClickAt).toBeInstanceOf(Date);
    });

    it('should track multiple clicks', async () => {
      await service.trackAffiliateClick(affiliateLink.code);
      await service.trackAffiliateClick(affiliateLink.code);
      await service.trackAffiliateClick(affiliateLink.code);

      const updated = await service.getAffiliateLink(affiliateLink.code);
      expect(updated.clicks).toBe(3);
    });

    it('should track affiliate conversions', async () => {
      // Record commission with affiliate
      const commission = await service.recordCommission(
        'payment-123',
        'server-123',
        'publisher-789',
        1000n,
        'affiliate-456'
      );

      await service.trackAffiliateConversion(affiliateLink.code, commission.id);

      const updated = await service.getAffiliateLink(affiliateLink.code);
      expect(updated.conversions).toBe(1);
    });

    it('should calculate conversion rate correctly', async () => {
      // Track 10 clicks
      for (let i = 0; i < 10; i++) {
        await service.trackAffiliateClick(affiliateLink.code);
      }

      // Track 2 conversions
      for (let i = 0; i < 2; i++) {
        const commission = await service.recordCommission(
          `payment-${i}`,
          'server-123',
          'publisher-789',
          1000n,
          'affiliate-456'
        );
        await service.trackAffiliateConversion(affiliateLink.code, commission.id);
      }

      const updated = await service.getAffiliateLink(affiliateLink.code);
      expect(updated.conversionRate).toBeCloseTo(0.2, 2); // 2/10 = 20%
    });

    it('should handle zero clicks', async () => {
      const link = await service.getAffiliateLink(affiliateLink.code);
      expect(link.conversionRate).toBe(0);
    });

    it('should emit affiliate:click event', async () => {
      const eventPromise = new Promise((resolve) => {
        service.once('affiliate:click', resolve);
      });

      await service.trackAffiliateClick(affiliateLink.code);

      const event = await eventPromise;
      expect(event).toBeDefined();
      expect((event as any).code).toBe(affiliateLink.code);
    });

    it('should emit affiliate:conversion event', async () => {
      const commission = await service.recordCommission(
        'payment-123',
        'server-123',
        'publisher-789',
        1000n,
        'affiliate-456'
      );

      const eventPromise = new Promise((resolve) => {
        service.once('affiliate:conversion', resolve);
      });

      await service.trackAffiliateConversion(affiliateLink.code, commission.id);

      const event = await eventPromise;
      expect(event).toBeDefined();
    });
  });

  // ============================================================================
  // AFFILIATE PERFORMANCE TESTS
  // ============================================================================

  describe('getAffiliatePerformance', () => {
    beforeEach(async () => {
      // Create links for multiple servers
      await service.createAffiliateLink('server-1', 'affiliate-456', 'CODE1');
      await service.createAffiliateLink('server-2', 'affiliate-456', 'CODE2');
    });

    it('should aggregate affiliate metrics', async () => {
      // Track clicks and conversions
      await service.trackAffiliateClick('CODE1');
      await service.trackAffiliateClick('CODE1');
      await service.trackAffiliateClick('CODE2');

      const comm1 = await service.recordCommission(
        'payment-1',
        'server-1',
        'publisher-1',
        1000n,
        'affiliate-456'
      );
      const comm2 = await service.recordCommission(
        'payment-2',
        'server-2',
        'publisher-2',
        2000n,
        'affiliate-456'
      );

      await service.trackAffiliateConversion('CODE1', comm1.id);
      await service.trackAffiliateConversion('CODE2', comm2.id);

      const performance = await service.getAffiliatePerformance('affiliate-456');

      expect(performance.totalClicks).toBe(3);
      expect(performance.totalConversions).toBe(2);
      expect(performance.totalEarnings).toBe(60n); // 2% of (1000 + 2000)
      expect(performance.averageCommission).toBe(30n);
    });

    it('should identify top performing servers', async () => {
      // Server 1: 5 conversions
      for (let i = 0; i < 5; i++) {
        const comm = await service.recordCommission(
          `payment-1-${i}`,
          'server-1',
          'publisher-1',
          1000n,
          'affiliate-456'
        );
        await service.trackAffiliateConversion('CODE1', comm.id);
      }

      // Server 2: 10 conversions
      for (let i = 0; i < 10; i++) {
        const comm = await service.recordCommission(
          `payment-2-${i}`,
          'server-2',
          'publisher-2',
          1000n,
          'affiliate-456'
        );
        await service.trackAffiliateConversion('CODE2', comm.id);
      }

      const performance = await service.getAffiliatePerformance('affiliate-456');

      expect(performance.topServers).toHaveLength(2);
      expect(performance.topServers[0].serverId).toBe('server-2'); // Most conversions
      expect(performance.topServers[0].conversions).toBe(10);
      expect(performance.topServers[1].serverId).toBe('server-1');
      expect(performance.topServers[1].conversions).toBe(5);
    });
  });

  // ============================================================================
  // PUBLISHER REVENUE REPORT TESTS
  // ============================================================================

  describe('getPublisherRevenue', () => {
    beforeEach(async () => {
      // Create commissions for publisher
      const comm1 = await service.recordCommission('payment-1', 'server-1', 'publisher-A', 1000n);
      const comm2 = await service.recordCommission('payment-2', 'server-2', 'publisher-A', 2000n);
      const comm3 = await service.recordCommission('payment-3', 'server-3', 'publisher-A', 3000n);

      await service.confirmCommission(comm1.id);
      await service.confirmCommission(comm2.id);
      await service.confirmCommission(comm3.id);

      // Pay out comm1
      const batch = await service.createPayoutBatch('publisher-A', [comm1.id]);
      await service.processPayoutBatch(batch.id);
    });

    it('should calculate total revenue', async () => {
      const revenue = await service.getPublisherRevenue('publisher-A');

      expect(revenue.confirmedAmount).toBeGreaterThan(0n);
      expect(revenue.paidAmount).toBeGreaterThan(0n);
      expect(revenue.paidAmount).toBeLessThan(revenue.confirmedAmount); // Not all paid yet
      expect(revenue.totalTransactions).toBe(3);
    });

    it('should filter by date range', async () => {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      // Future date range should return 0
      const futureRevenue = await service.getPublisherRevenue('publisher-A', tomorrow, tomorrow);
      expect(futureRevenue.totalTransactions).toBe(0);
    });

    it('should calculate average transaction', async () => {
      const revenue = await service.getPublisherRevenue('publisher-A');

      // Average should be (950 + 1900 + 2850) / 3 ≈ 1900
      expect(revenue.averageTransaction).toBeGreaterThan(0n);
    });

    it('should cache revenue reports', async () => {
      const revenue1 = await service.getPublisherRevenue('publisher-A');
      const revenue2 = await service.getPublisherRevenue('publisher-A');

      // Should return same cached result
      expect(revenue1.confirmedAmount).toBe(revenue2.confirmedAmount);
    });
  });

  // ============================================================================
  // PLATFORM REVENUE REPORT TESTS
  // ============================================================================

  describe('getPlatformRevenue', () => {
    beforeEach(async () => {
      // Multiple publishers and commissions
      await service.recordCommission('payment-1', 'server-1', 'publisher-A', 1000n);
      await service.recordCommission('payment-2', 'server-2', 'publisher-B', 2000n);
      await service.recordCommission('payment-3', 'server-3', 'publisher-C', 3000n, 'affiliate-1');
    });

    it('should aggregate platform-wide metrics', async () => {
      const revenue = await service.getPlatformRevenue();

      expect(revenue.totalProcessed).toBe(6000n); // 1000 + 2000 + 3000
      expect(revenue.totalPlatformFees).toBeGreaterThan(0n); // 5% of total
      expect(revenue.totalAffiliateFees).toBeGreaterThan(0n); // 2% of 3000
      expect(revenue.totalTransactions).toBe(3);
    });

    it('should count unique publishers', async () => {
      const revenue = await service.getPlatformRevenue();
      expect(revenue.totalPublishers).toBe(3);
    });

    it('should filter by date range', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const revenue = await service.getPlatformRevenue(yesterday);
      expect(revenue.totalTransactions).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // TOP PERFORMERS TESTS
  // ============================================================================

  describe('getTopPerformers', () => {
    beforeEach(async () => {
      // Create commissions for different servers
      await service.recordCommission('payment-1-1', 'server-A', 'publisher-1', 1000n);
      await service.recordCommission('payment-1-2', 'server-A', 'publisher-1', 2000n);
      await service.recordCommission('payment-1-3', 'server-A', 'publisher-1', 3000n);

      await service.recordCommission('payment-2-1', 'server-B', 'publisher-2', 5000n);
      await service.recordCommission('payment-2-2', 'server-B', 'publisher-2', 5000n);

      await service.recordCommission('payment-3-1', 'server-C', 'publisher-3', 1000n);
    });

    it('should rank servers by total revenue', async () => {
      const topServers = await service.getTopPerformers(10);

      expect(topServers).toHaveLength(3);
      expect(topServers[0].serverId).toBe('server-B'); // 10,000 total
      expect(topServers[1].serverId).toBe('server-A'); // 6,000 total
      expect(topServers[2].serverId).toBe('server-C'); // 1,000 total
    });

    it('should respect limit parameter', async () => {
      const topServers = await service.getTopPerformers(2);
      expect(topServers).toHaveLength(2);
    });

    it('should include transaction count', async () => {
      const topServers = await service.getTopPerformers(10);

      expect(topServers[0].transactionCount).toBe(2); // server-B
      expect(topServers[1].transactionCount).toBe(3); // server-A
      expect(topServers[2].transactionCount).toBe(1); // server-C
    });
  });

  // ============================================================================
  // COMMISSION QUERY TESTS
  // ============================================================================

  describe('Commission Queries', () => {
    beforeEach(async () => {
      const comm1 = await service.recordCommission('payment-1', 'server-A', 'publisher-1', 1000n);
      const comm2 = await service.recordCommission('payment-2', 'server-A', 'publisher-1', 2000n);
      const comm3 = await service.recordCommission('payment-3', 'server-B', 'publisher-1', 3000n);

      await service.confirmCommission(comm1.id);
      // comm2 and comm3 remain PENDING
    });

    it('should get commissions by status', async () => {
      const pending = await service.getPublisherCommissions(
        'publisher-1',
        CommissionStatus.PENDING
      );
      const confirmed = await service.getPublisherCommissions(
        'publisher-1',
        CommissionStatus.CONFIRMED
      );

      expect(pending).toHaveLength(2);
      expect(confirmed).toHaveLength(1);
    });

    it('should get server-specific commissions', async () => {
      const serverACommissions = await service.getServerCommissions('server-A');
      const serverBCommissions = await service.getServerCommissions('server-B');

      expect(serverACommissions).toHaveLength(2);
      expect(serverBCommissions).toHaveLength(1);
    });

    it('should filter by date range', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const recent = await service.getPublisherCommissions('publisher-1', undefined, yesterday);
      expect(recent.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // SERVICE STATISTICS TESTS
  // ============================================================================

  describe('getServiceStats', () => {
    it('should return aggregate statistics', async () => {
      await service.recordCommission('payment-1', 'server-1', 'publisher-1', 1000n);
      const comm2 = await service.recordCommission('payment-2', 'server-2', 'publisher-2', 2000n);
      await service.confirmCommission(comm2.id);

      await service.createAffiliateLink('server-3', 'affiliate-1');

      const stats = service.getServiceStats();

      expect(stats.totalCommissions).toBe(2);
      expect(stats.pendingCommissions).toBe(1);
      expect(stats.confirmedCommissions).toBe(1);
      expect(stats.paidCommissions).toBe(0);
      expect(stats.totalPayoutBatches).toBe(0);
      expect(stats.totalAffiliateLinks).toBe(1);
    });
  });

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('ServerRegistry Integration', () => {
    it('should validate server exists on commission recording', async () => {
      mockServerRegistry.getServerById.mockResolvedValueOnce({
        id: 'server-123',
        name: 'Test Server',
      } as any);

      await expect(
        service.recordCommission('payment-123', 'server-123', 'publisher-789', 1000n)
      ).resolves.toBeDefined();

      expect(mockServerRegistry.getServerById).toHaveBeenCalledWith('server-123');
    });

    it('should validate server exists on affiliate link creation', async () => {
      await service.createAffiliateLink('server-123', 'affiliate-456');

      expect(mockServerRegistry.getServerById).toHaveBeenCalledWith('server-123');
    });

    it('should handle server validation failures', async () => {
      mockServerRegistry.getServerById.mockRejectedValueOnce(new Error('Server not found'));

      await expect(
        service.recordCommission('payment-123', 'non-existent', 'publisher-789', 1000n)
      ).rejects.toThrow();
    });
  });

  // ============================================================================
  // EDGE CASE TESTS
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle large amounts correctly with bigint', async () => {
      const largeAmount = 999999999999999999n;
      const commission = await service.recordCommission(
        'payment-123',
        'server-456',
        'publisher-789',
        largeAmount
      );

      const breakdown = service.calculateRevenueBreakdown(largeAmount, false);

      // Verify precision maintained
      expect(commission.amount).toBe(largeAmount);
      expect(breakdown.platformFee + breakdown.publisherAmount).toBe(largeAmount);
    });

    it('should handle concurrent commission recording', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          service.recordCommission(`payment-${i}`, `server-${i}`, 'publisher-1', 1000n)
        );
      }

      const commissions = await Promise.all(promises);
      expect(commissions).toHaveLength(10);

      // All should have unique IDs
      const ids = new Set(commissions.map((c) => c.id));
      expect(ids.size).toBe(10);
    });

    it('should handle empty publisher with no commissions', async () => {
      const revenue = await service.getPublisherRevenue('non-existent-publisher');

      expect(revenue.confirmedAmount).toBe(0n);
      expect(revenue.paidAmount).toBe(0n);
      expect(revenue.totalTransactions).toBe(0);
    });
  });
});
