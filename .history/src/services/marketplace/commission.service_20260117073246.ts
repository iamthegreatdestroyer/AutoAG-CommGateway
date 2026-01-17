/**
 * CommissionService - Revenue Distribution & Affiliate Management
 *
 * Handles marketplace commission tracking, revenue distribution, and affiliate programs.
 * Integrates with Phase 5 payment system for automated payouts.
 *
 * Revenue Split Model:
 * - Platform Fee: 5% (marketplace commission)
 * - Affiliate Fee: 2% (if referred)
 * - Publisher Revenue: 93% (or 95% without affiliate)
 *
 * Features:
 * - Automated commission calculation on payments
 * - Monthly payout batch processing
 * - Affiliate link generation and tracking
 * - Revenue analytics per publisher/server
 * - Dispute management
 * - Integration with escrow release events
 *
 * @singleton
 * @emits commission:recorded, commission:confirmed, commission:disputed
 * @emits payout:scheduled, payout:processing, payout:completed, payout:failed
 * @emits affiliate:link-created, affiliate:click, affiliate:conversion, affiliate:commission
 *
 * Copyright (c) 2026 AutoAG-CommGateway. All Rights Reserved.
 */

import { EventEmitter } from 'events';
import { serverRegistryService } from './server-registry.service';

// ============================================================================
// INTERFACES & TYPES
// ============================================================================

/**
 * Commission status lifecycle
 */
export enum CommissionStatus {
  PENDING = 'pending', // Payment not yet confirmed
  CONFIRMED = 'confirmed', // Payment confirmed, awaiting payout
  PAID = 'paid', // Paid to publisher
  DISPUTED = 'disputed', // Under dispute
  REVERSED = 'reversed', // Refunded/reversed
}

/**
 * Commission record for a single transaction
 */
export interface CommissionRecord {
  id: string;
  invokeId: string; // Link to tool invocation
  serverId: string; // MCP server
  publisherId: string; // Server owner
  affiliateId?: string; // Referrer (if any)
  grossAmount: number; // Total payment in Gwei
  platformFee: number; // Platform commission
  affiliateFee: number; // Affiliate commission
  publisherRevenue: number; // Net to publisher
  status: CommissionStatus;
  payoutBatchId?: string; // Associated payout batch
  disputeReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Commission calculation breakdown
 */
export interface CommissionBreakdown {
  grossAmount: number;
  platformFee: number;
  platformFeePercentage: number;
  affiliateFee: number;
  affiliateFeePercentage: number;
  publisherRevenue: number;
  publisherRevenuePercentage: number;
}

/**
 * Payout batch for publisher
 */
export interface PayoutBatch {
  id: string;
  publisherId: string;
  amount: number; // Total payout amount
  commissionRecordIds: string[]; // Included commissions
  status: 'pending' | 'processing' | 'completed' | 'failed';
  transactionHash?: string; // Blockchain tx hash
  scheduledDate: Date;
  completedDate?: Date;
  error?: string;
  createdAt: Date;
}

/**
 * Affiliate link for tracking
 */
export interface AffiliateLink {
  id: string;
  affiliateId: string; // User ID of affiliate
  serverId: string; // Promoted server
  code: string; // Unique referral code
  clickCount: number;
  conversionCount: number; // Successful sign-ups/purchases
  revenueGenerated: number; // Total revenue from referrals
  commissionEarned: number; // Affiliate's total commission
  createdAt: Date;
}

/**
 * Revenue report for publisher
 */
export interface RevenueReport {
  publisherId: string;
  period: {
    startDate: Date;
    endDate: Date;
    type: 'week' | 'month' | 'year' | 'custom';
  };
  totalGrossRevenue: number;
  platformFees: number;
  affiliateFees: number;
  netRevenue: number;
  invocationCount: number;
  averageTransactionSize: number;
  topServers: Array<{
    serverId: string;
    serverName: string;
    revenue: number;
    invocations: number;
  }>;
  payoutsPending: number;
  payoutsCompleted: number;
}

/**
 * Affiliate statistics
 */
export interface AffiliateStats {
  affiliateId: string;
  totalLinks: number;
  totalClicks: number;
  totalConversions: number;
  conversionRate: number;
  totalRevenueGenerated: number;
  totalCommissionEarned: number;
  topPerformingServers: Array<{
    serverId: string;
    clicks: number;
    conversions: number;
    revenue: number;
    commission: number;
  }>;
}

/**
 * Platform revenue report
 */
export interface PlatformRevenueReport {
  period: {
    startDate: Date;
    endDate: Date;
  };
  totalGrossRevenue: number;
  platformFees: number;
  affiliateFees: number;
  publisherPayouts: number;
  totalTransactions: number;
  uniquePublishers: number;
  uniqueAffiliates: number;
  topEarningServers: Array<{
    serverId: string;
    serverName: string;
    revenue: number;
    platformFee: number;
  }>;
}

// ============================================================================
// ERROR CLASSES
// ============================================================================

export class CommissionError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'CommissionError';
  }
}

export class CommissionNotFoundError extends CommissionError {
  constructor(commissionId: string) {
    super(`Commission not found: ${commissionId}`, 'COMMISSION_NOT_FOUND', 404);
  }
}

export class InvalidCommissionError extends CommissionError {
  constructor(message: string) {
    super(message, 'INVALID_COMMISSION', 400);
  }
}

export class PayoutError extends CommissionError {
  constructor(message: string) {
    super(message, 'PAYOUT_ERROR', 500);
  }
}

export class AffiliateError extends CommissionError {
  constructor(message: string) {
    super(message, 'AFFILIATE_ERROR', 400);
  }
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Commission Rates
  PLATFORM_FEE_PERCENTAGE: parseFloat(process.env.COMMISSION_PLATFORM_FEE_PERCENTAGE || '5'),
  AFFILIATE_FEE_PERCENTAGE: parseFloat(process.env.COMMISSION_AFFILIATE_FEE_PERCENTAGE || '2'),

  // Payout Settings
  MIN_PAYOUT_AMOUNT: parseInt(process.env.COMMISSION_MIN_PAYOUT_GWEI || '100000', 10), // 100k Gwei
  PAYOUT_SCHEDULE: (process.env.COMMISSION_PAYOUT_SCHEDULE || 'monthly') as 'weekly' | 'monthly',
  PAYOUT_DAY_OF_MONTH: parseInt(process.env.COMMISSION_PAYOUT_DAY || '1', 10),
  AUTO_PAYOUT_ENABLED: process.env.COMMISSION_AUTO_PAYOUT_ENABLED === 'true',

  // Affiliate Settings
  AFFILIATE_CODE_LENGTH: 8,
  MAX_AFFILIATE_LINKS_PER_USER: 50,

  // Cache
  CACHE_TTL_MINUTES: 15,
  REPORT_CACHE_TTL_MINUTES: 60,
};

// Ensure publisher gets remaining percentage
const PUBLISHER_PERCENTAGE = 100 - CONFIG.PLATFORM_FEE_PERCENTAGE - CONFIG.AFFILIATE_FEE_PERCENTAGE;

// ============================================================================
// COMMISSION SERVICE
// ============================================================================

export class CommissionService extends EventEmitter {
  private static instance: CommissionService;

  // Storage
  private commissions: Map<string, CommissionRecord>;
  private payoutBatches: Map<string, PayoutBatch>;
  private affiliateLinks: Map<string, AffiliateLink>;

  // Indices
  private invokeCommissions: Map<string, string>; // invokeId → commissionId
  private serverCommissions: Map<string, Set<string>>; // serverId → commissionIds
  private publisherCommissions: Map<string, Set<string>>; // publisherId → commissionIds
  private affiliateCodeMap: Map<string, string>; // code → affiliateLinkId
  private affiliateServerLinks: Map<string, Map<string, string>>; // affiliateId → serverId → linkId

  // Cache
  private cache: Map<string, { data: unknown; expiry: number }>;

  private constructor() {
    super();
    this.commissions = new Map();
    this.payoutBatches = new Map();
    this.affiliateLinks = new Map();
    this.invokeCommissions = new Map();
    this.serverCommissions = new Map();
    this.publisherCommissions = new Map();
    this.affiliateCodeMap = new Map();
    this.affiliateServerLinks = new Map();
    this.cache = new Map();
  }

  public static getInstance(): CommissionService {
    if (!CommissionService.instance) {
      CommissionService.instance = new CommissionService();
    }
    return CommissionService.instance;
  }

  // ==========================================================================
  // COMMISSION RECORDING & MANAGEMENT
  // ==========================================================================

  /**
   * Record a commission from a tool invocation payment
   * Called by escrow service when payment is released
   */
  public async recordCommission(
    invokeId: string,
    serverId: string,
    publisherId: string,
    grossAmount: number,
    affiliateId?: string
  ): Promise<CommissionRecord> {
    // Validate inputs
    if (grossAmount <= 0) {
      throw new InvalidCommissionError('Gross amount must be positive');
    }

    // Check for duplicate
    if (this.invokeCommissions.has(invokeId)) {
      throw new InvalidCommissionError(`Commission already recorded for invoke: ${invokeId}`);
    }

    // Verify server exists
    try {
      await serverRegistryService.getServerById(serverId);
    } catch (error) {
      throw new InvalidCommissionError(`Server not found: ${serverId}`);
    }

    // Calculate commission breakdown
    const breakdown = this.calculateCommissionBreakdown(grossAmount, !!affiliateId);

    // Create commission record
    const commission: CommissionRecord = {
      id: this.generateCommissionId(),
      invokeId,
      serverId,
      publisherId,
      affiliateId,
      grossAmount,
      platformFee: breakdown.platformFee,
      affiliateFee: breakdown.affiliateFee,
      publisherRevenue: breakdown.publisherRevenue,
      status: CommissionStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Store commission
    this.commissions.set(commission.id, commission);

    // Update indices
    this.indexCommission(commission);

    // Update affiliate link stats if applicable
    if (affiliateId) {
      await this.updateAffiliateLinkRevenue(affiliateId, serverId, breakdown.affiliateFee);
    }

    // Clear caches
    this.clearCaches(['revenue', 'report']);

    // Emit event
    this.emit('commission:recorded', {
      commissionId: commission.id,
      invokeId,
      serverId,
      publisherId,
      grossAmount,
      platformFee: breakdown.platformFee,
      affiliateFee: breakdown.affiliateFee,
      publisherRevenue: breakdown.publisherRevenue,
      hasAffiliate: !!affiliateId,
    });

    return commission;
  }

  /**
   * Calculate commission breakdown
   */
  public calculateCommissionBreakdown(
    grossAmount: number,
    hasAffiliate: boolean = false
  ): CommissionBreakdown {
    const platformFee = Math.floor(grossAmount * (CONFIG.PLATFORM_FEE_PERCENTAGE / 100));
    const affiliateFee = hasAffiliate
      ? Math.floor(grossAmount * (CONFIG.AFFILIATE_FEE_PERCENTAGE / 100))
      : 0;
    const publisherRevenue = grossAmount - platformFee - affiliateFee;

    return {
      grossAmount,
      platformFee,
      platformFeePercentage: CONFIG.PLATFORM_FEE_PERCENTAGE,
      affiliateFee,
      affiliateFeePercentage: hasAffiliate ? CONFIG.AFFILIATE_FEE_PERCENTAGE : 0,
      publisherRevenue,
      publisherRevenuePercentage: (publisherRevenue / grossAmount) * 100,
    };
  }

  /**
   * Update commission status
   */
  public async updateCommissionStatus(
    commissionId: string,
    status: CommissionStatus,
    payoutBatchId?: string
  ): Promise<CommissionRecord> {
    const commission = this.commissions.get(commissionId);
    if (!commission) {
      throw new CommissionNotFoundError(commissionId);
    }

    const oldStatus = commission.status;
    commission.status = status;
    commission.updatedAt = new Date();

    if (payoutBatchId) {
      commission.payoutBatchId = payoutBatchId;
    }

    // Clear caches
    this.clearCaches(['revenue', 'report']);

    // Emit event
    this.emit('commission:status-changed', {
      commissionId,
      oldStatus,
      newStatus: status,
      payoutBatchId,
    });

    if (status === CommissionStatus.CONFIRMED) {
      this.emit('commission:confirmed', {
        commissionId,
        publisherId: commission.publisherId,
        amount: commission.publisherRevenue,
      });
    }

    return commission;
  }

  /**
   * Get commission by ID
   */
  public async getCommissionById(commissionId: string): Promise<CommissionRecord> {
    const commission = this.commissions.get(commissionId);
    if (!commission) {
      throw new CommissionNotFoundError(commissionId);
    }
    return commission;
  }

  /**
   * Get commissions for a server
   */
  public async getServerCommissions(
    serverId: string,
    status?: CommissionStatus
  ): Promise<CommissionRecord[]> {
    const commissionIds = this.serverCommissions.get(serverId) || new Set();
    let commissions = Array.from(commissionIds)
      .map((id) => this.commissions.get(id)!)
      .filter((c) => c !== undefined);

    if (status) {
      commissions = commissions.filter((c) => c.status === status);
    }

    // Sort by creation date (newest first)
    commissions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return commissions;
  }

  /**
   * Get commissions for a publisher
   */
  public async getPublisherCommissions(
    publisherId: string,
    status?: CommissionStatus
  ): Promise<CommissionRecord[]> {
    const commissionIds = this.publisherCommissions.get(publisherId) || new Set();
    let commissions = Array.from(commissionIds)
      .map((id) => this.commissions.get(id)!)
      .filter((c) => c !== undefined);

    if (status) {
      commissions = commissions.filter((c) => c.status === status);
    }

    // Sort by creation date (newest first)
    commissions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return commissions;
  }

  // ==========================================================================
  // PAYOUT MANAGEMENT
  // ==========================================================================

  /**
   * Schedule payouts for all eligible publishers
   * Creates payout batches for publishers with balance >= minimum
   */
  public async schedulePayouts(): Promise<PayoutBatch[]> {
    const batches: PayoutBatch[] = [];

    // Get all publishers with confirmed commissions
    const publisherMap = new Map<string, CommissionRecord[]>();

    for (const commission of this.commissions.values()) {
      if (commission.status === CommissionStatus.CONFIRMED) {
        if (!publisherMap.has(commission.publisherId)) {
          publisherMap.set(commission.publisherId, []);
        }
        publisherMap.get(commission.publisherId)!.push(commission);
      }
    }

    // Create payout batch for each publisher
    for (const [publisherId, commissions] of publisherMap.entries()) {
      const totalAmount = commissions.reduce((sum, c) => sum + c.publisherRevenue, 0);

      // Check minimum payout amount
      if (totalAmount < CONFIG.MIN_PAYOUT_AMOUNT) {
        continue;
      }

      // Create payout batch
      const batch: PayoutBatch = {
        id: this.generatePayoutBatchId(),
        publisherId,
        amount: totalAmount,
        commissionRecordIds: commissions.map((c) => c.id),
        status: 'pending',
        scheduledDate: this.getNextPayoutDate(),
        createdAt: new Date(),
      };

      // Store batch
      this.payoutBatches.set(batch.id, batch);

      // Update commission records with batch ID
      for (const commission of commissions) {
        commission.payoutBatchId = batch.id;
      }

      batches.push(batch);

      // Emit event
      this.emit('payout:scheduled', {
        batchId: batch.id,
        publisherId,
        amount: totalAmount,
        commissionCount: commissions.length,
        scheduledDate: batch.scheduledDate,
      });
    }

    return batches;
  }

  /**
   * Process a payout batch (trigger blockchain transaction)
   * In production, this would integrate with Web3 wallet
   */
  public async processPayoutBatch(
    batchId: string
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    const batch = this.payoutBatches.get(batchId);
    if (!batch) {
      throw new PayoutError(`Payout batch not found: ${batchId}`);
    }

    if (batch.status !== 'pending') {
      throw new PayoutError(`Payout batch is not pending: ${batch.status}`);
    }

    // Update status to processing
    batch.status = 'processing';

    this.emit('payout:processing', {
      batchId: batch.id,
      publisherId: batch.publisherId,
      amount: batch.amount,
    });

    try {
      // PRODUCTION: Integrate with Web3 to send payment
      // For now, simulate successful transaction
      const transactionHash = this.simulateBlockchainTransaction(batch);

      // Update batch
      batch.status = 'completed';
      batch.transactionHash = transactionHash;
      batch.completedDate = new Date();

      // Update commission statuses
      for (const commissionId of batch.commissionRecordIds) {
        await this.updateCommissionStatus(commissionId, CommissionStatus.PAID, batch.id);
      }

      // Emit event
      this.emit('payout:completed', {
        batchId: batch.id,
        publisherId: batch.publisherId,
        amount: batch.amount,
        transactionHash,
      });

      return { success: true, transactionHash };
    } catch (error) {
      // Update batch with error
      batch.status = 'failed';
      batch.error = error instanceof Error ? error.message : 'Unknown error';

      // Emit event
      this.emit('payout:failed', {
        batchId: batch.id,
        publisherId: batch.publisherId,
        amount: batch.amount,
        error: batch.error,
      });

      return { success: false, error: batch.error };
    }
  }

  /**
   * Get payout batch by ID
   */
  public async getPayoutBatch(batchId: string): Promise<PayoutBatch> {
    const batch = this.payoutBatches.get(batchId);
    if (!batch) {
      throw new PayoutError(`Payout batch not found: ${batchId}`);
    }
    return batch;
  }

  /**
   * Get payout batches for a publisher
   */
  public async getPublisherPayouts(publisherId: string): Promise<PayoutBatch[]> {
    return Array.from(this.payoutBatches.values())
      .filter((b) => b.publisherId === publisherId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // ==========================================================================
  // AFFILIATE MANAGEMENT
  // ==========================================================================

  /**
   * Create an affiliate link for a server
   */
  public async createAffiliateLink(affiliateId: string, serverId: string): Promise<AffiliateLink> {
    // Verify server exists
    try {
      await serverRegistryService.getServerById(serverId);
    } catch (error) {
      throw new AffiliateError(`Server not found: ${serverId}`);
    }

    // Check if link already exists
    const existingLinkId = this.affiliateServerLinks.get(affiliateId)?.get(serverId);
    if (existingLinkId) {
      return this.affiliateLinks.get(existingLinkId)!;
    }

    // Check affiliate link limit
    const affiliateLinks = Array.from(this.affiliateLinks.values()).filter(
      (l) => l.affiliateId === affiliateId
    );
    if (affiliateLinks.length >= CONFIG.MAX_AFFILIATE_LINKS_PER_USER) {
      throw new AffiliateError(
        `Maximum ${CONFIG.MAX_AFFILIATE_LINKS_PER_USER} affiliate links per user`
      );
    }

    // Generate unique code
    const code = this.generateAffiliateCode();

    // Create affiliate link
    const link: AffiliateLink = {
      id: this.generateAffiliateLinkId(),
      affiliateId,
      serverId,
      code,
      clickCount: 0,
      conversionCount: 0,
      revenueGenerated: 0,
      commissionEarned: 0,
      createdAt: new Date(),
    };

    // Store link
    this.affiliateLinks.set(link.id, link);
    this.affiliateCodeMap.set(code, link.id);

    // Update affiliate-server index
    if (!this.affiliateServerLinks.has(affiliateId)) {
      this.affiliateServerLinks.set(affiliateId, new Map());
    }
    this.affiliateServerLinks.get(affiliateId)!.set(serverId, link.id);

    // Emit event
    this.emit('affiliate:link-created', {
      linkId: link.id,
      affiliateId,
      serverId,
      code,
    });

    return link;
  }

  /**
   * Track affiliate link click
   */
  public async trackAffiliateClick(code: string): Promise<void> {
    const linkId = this.affiliateCodeMap.get(code);
    if (!linkId) {
      throw new AffiliateError(`Invalid affiliate code: ${code}`);
    }

    const link = this.affiliateLinks.get(linkId)!;
    link.clickCount++;

    // Emit event
    this.emit('affiliate:click', {
      linkId: link.id,
      code,
      serverId: link.serverId,
      affiliateId: link.affiliateId,
      totalClicks: link.clickCount,
    });
  }

  /**
   * Record affiliate conversion (user signup/purchase via affiliate link)
   */
  public async recordAffiliateConversion(code: string, userId: string): Promise<void> {
    const linkId = this.affiliateCodeMap.get(code);
    if (!linkId) {
      throw new AffiliateError(`Invalid affiliate code: ${code}`);
    }

    const link = this.affiliateLinks.get(linkId)!;
    link.conversionCount++;

    // Emit event
    this.emit('affiliate:conversion', {
      linkId: link.id,
      code,
      serverId: link.serverId,
      affiliateId: link.affiliateId,
      userId,
      totalConversions: link.conversionCount,
    });
  }

  /**
   * Update affiliate link revenue (called when commission recorded)
   */
  private async updateAffiliateLinkRevenue(
    affiliateId: string,
    serverId: string,
    affiliateCommission: number
  ): Promise<void> {
    const linkId = this.affiliateServerLinks.get(affiliateId)?.get(serverId);
    if (!linkId) return;

    const link = this.affiliateLinks.get(linkId);
    if (!link) return;

    link.revenueGenerated += affiliateCommission;
    link.commissionEarned += affiliateCommission;

    // Emit event
    this.emit('affiliate:commission', {
      linkId: link.id,
      affiliateId,
      serverId,
      commission: affiliateCommission,
      totalEarned: link.commissionEarned,
    });
  }

  /**
   * Get affiliate statistics
   */
  public async getAffiliateStats(affiliateId: string): Promise<AffiliateStats> {
    const links = Array.from(this.affiliateLinks.values()).filter(
      (l) => l.affiliateId === affiliateId
    );

    const totalClicks = links.reduce((sum, l) => sum + l.clickCount, 0);
    const totalConversions = links.reduce((sum, l) => sum + l.conversionCount, 0);
    const totalRevenueGenerated = links.reduce((sum, l) => sum + l.revenueGenerated, 0);
    const totalCommissionEarned = links.reduce((sum, l) => sum + l.commissionEarned, 0);

    // Top performing servers
    const topServers = links
      .map((link) => ({
        serverId: link.serverId,
        clicks: link.clickCount,
        conversions: link.conversionCount,
        revenue: link.revenueGenerated,
        commission: link.commissionEarned,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return {
      affiliateId,
      totalLinks: links.length,
      totalClicks,
      totalConversions,
      conversionRate: totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0,
      totalRevenueGenerated,
      totalCommissionEarned,
      topPerformingServers: topServers,
    };
  }

  /**
   * Get affiliate link by code
   */
  public async getAffiliateLinkByCode(code: string): Promise<AffiliateLink> {
    const linkId = this.affiliateCodeMap.get(code);
    if (!linkId) {
      throw new AffiliateError(`Invalid affiliate code: ${code}`);
    }
    return this.affiliateLinks.get(linkId)!;
  }

  // ==========================================================================
  // REVENUE REPORTING
  // ==========================================================================

  /**
   * Generate revenue report for a publisher
   */
  public async generateRevenueReport(
    publisherId: string,
    startDate: Date,
    endDate: Date,
    type: 'week' | 'month' | 'year' | 'custom' = 'month'
  ): Promise<RevenueReport> {
    // Check cache
    const cacheKey = `report:${publisherId}:${startDate.getTime()}:${endDate.getTime()}`;
    const cached = this.getFromCache<RevenueReport>(cacheKey);
    if (cached) return cached;

    // Get all commissions for publisher in date range
    const commissionIds = this.publisherCommissions.get(publisherId) || new Set();
    const commissions = Array.from(commissionIds)
      .map((id) => this.commissions.get(id)!)
      .filter((c) => c !== undefined && c.createdAt >= startDate && c.createdAt <= endDate);

    // Calculate totals
    const totalGrossRevenue = commissions.reduce((sum, c) => sum + c.grossAmount, 0);
    const platformFees = commissions.reduce((sum, c) => sum + c.platformFee, 0);
    const affiliateFees = commissions.reduce((sum, c) => sum + c.affiliateFee, 0);
    const netRevenue = commissions.reduce((sum, c) => sum + c.publisherRevenue, 0);

    // Calculate payout statistics
    const payoutsPending = commissions
      .filter((c) => c.status === CommissionStatus.CONFIRMED)
      .reduce((sum, c) => sum + c.publisherRevenue, 0);
    const payoutsCompleted = commissions
      .filter((c) => c.status === CommissionStatus.PAID)
      .reduce((sum, c) => sum + c.publisherRevenue, 0);

    // Get top servers
    const serverRevenue = new Map<string, { revenue: number; invocations: number }>();
    for (const commission of commissions) {
      if (!serverRevenue.has(commission.serverId)) {
        serverRevenue.set(commission.serverId, { revenue: 0, invocations: 0 });
      }
      const stats = serverRevenue.get(commission.serverId)!;
      stats.revenue += commission.publisherRevenue;
      stats.invocations++;
    }

    const topServers = await Promise.all(
      Array.from(serverRevenue.entries())
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 10)
        .map(async ([serverId, stats]) => {
          try {
            const server = await serverRegistryService.getServerById(serverId);
            return {
              serverId,
              serverName: server.name,
              revenue: stats.revenue,
              invocations: stats.invocations,
            };
          } catch {
            return {
              serverId,
              serverName: 'Unknown',
              revenue: stats.revenue,
              invocations: stats.invocations,
            };
          }
        })
    );

    const report: RevenueReport = {
      publisherId,
      period: {
        startDate,
        endDate,
        type,
      },
      totalGrossRevenue,
      platformFees,
      affiliateFees,
      netRevenue,
      invocationCount: commissions.length,
      averageTransactionSize: commissions.length > 0 ? totalGrossRevenue / commissions.length : 0,
      topServers,
      payoutsPending,
      payoutsCompleted,
    };

    // Cache report
    this.setCache(cacheKey, report, CONFIG.REPORT_CACHE_TTL_MINUTES);

    return report;
  }

  /**
   * Generate platform-wide revenue report
   */
  public async generatePlatformRevenueReport(
    startDate: Date,
    endDate: Date
  ): Promise<PlatformRevenueReport> {
    // Get all commissions in date range
    const commissions = Array.from(this.commissions.values()).filter(
      (c) => c.createdAt >= startDate && c.createdAt <= endDate
    );

    // Calculate totals
    const totalGrossRevenue = commissions.reduce((sum, c) => sum + c.grossAmount, 0);
    const platformFees = commissions.reduce((sum, c) => sum + c.platformFee, 0);
    const affiliateFees = commissions.reduce((sum, c) => sum + c.affiliateFee, 0);
    const publisherPayouts = commissions.reduce((sum, c) => sum + c.publisherRevenue, 0);

    // Count unique entities
    const uniquePublishers = new Set(commissions.map((c) => c.publisherId)).size;
    const uniqueAffiliates = new Set(
      commissions.filter((c) => c.affiliateId).map((c) => c.affiliateId!)
    ).size;

    // Get top earning servers
    const serverRevenue = new Map<string, { revenue: number; platformFee: number }>();
    for (const commission of commissions) {
      if (!serverRevenue.has(commission.serverId)) {
        serverRevenue.set(commission.serverId, { revenue: 0, platformFee: 0 });
      }
      const stats = serverRevenue.get(commission.serverId)!;
      stats.revenue += commission.grossAmount;
      stats.platformFee += commission.platformFee;
    }

    const topEarningServers = await Promise.all(
      Array.from(serverRevenue.entries())
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 10)
        .map(async ([serverId, stats]) => {
          try {
            const server = await serverRegistryService.getServerById(serverId);
            return {
              serverId,
              serverName: server.name,
              revenue: stats.revenue,
              platformFee: stats.platformFee,
            };
          } catch {
            return {
              serverId,
              serverName: 'Unknown',
              revenue: stats.revenue,
              platformFee: stats.platformFee,
            };
          }
        })
    );

    return {
      period: { startDate, endDate },
      totalGrossRevenue,
      platformFees,
      affiliateFees,
      publisherPayouts,
      totalTransactions: commissions.length,
      uniquePublishers,
      uniqueAffiliates,
      topEarningServers,
    };
  }

  // ==========================================================================
  // PRIVATE HELPER METHODS
  // ==========================================================================

  /**
   * Index commission for fast lookups
   */
  private indexCommission(commission: CommissionRecord): void {
    // Invoice index
    this.invokeCommissions.set(commission.invokeId, commission.id);

    // Server index
    if (!this.serverCommissions.has(commission.serverId)) {
      this.serverCommissions.set(commission.serverId, new Set());
    }
    this.serverCommissions.get(commission.serverId)!.add(commission.id);

    // Publisher index
    if (!this.publisherCommissions.has(commission.publisherId)) {
      this.publisherCommissions.set(commission.publisherId, new Set());
    }
    this.publisherCommissions.get(commission.publisherId)!.add(commission.id);
  }

  /**
   * Generate unique commission ID
   */
  private generateCommissionId(): string {
    return `comm-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Generate unique payout batch ID
   */
  private generatePayoutBatchId(): string {
    return `payout-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Generate unique affiliate link ID
   */
  private generateAffiliateLinkId(): string {
    return `aff-link-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Generate unique affiliate code
   */
  private generateAffiliateCode(): string {
    let code: string;
    do {
      code = Math.random()
        .toString(36)
        .substring(2, 2 + CONFIG.AFFILIATE_CODE_LENGTH)
        .toUpperCase();
    } while (this.affiliateCodeMap.has(code));
    return code;
  }

  /**
   * Get next payout date based on schedule
   */
  private getNextPayoutDate(): Date {
    const now = new Date();
    const nextPayout = new Date();

    if (CONFIG.PAYOUT_SCHEDULE === 'monthly') {
      nextPayout.setMonth(now.getMonth() + 1);
      nextPayout.setDate(CONFIG.PAYOUT_DAY_OF_MONTH);
    } else {
      // Weekly - next occurrence of payout day
      const daysUntilPayoutDay = (CONFIG.PAYOUT_DAY_OF_MONTH - now.getDay() + 7) % 7;
      nextPayout.setDate(now.getDate() + daysUntilPayoutDay);
    }

    nextPayout.setHours(0, 0, 0, 0);
    return nextPayout;
  }

  /**
   * Simulate blockchain transaction (replace with real Web3 in production)
   */
  private simulateBlockchainTransaction(batch: PayoutBatch): string {
    // PRODUCTION: Replace with actual Web3 transaction
    return `0x${Math.random().toString(16).substring(2, 66)}`;
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
    totalCommissions: number;
    totalGrossRevenue: number;
    totalPlatformFees: number;
    totalAffiliateFees: number;
    totalPublisherRevenue: number;
    pendingPayouts: number;
    completedPayouts: number;
    totalAffiliateLinks: number;
  } {
    const allCommissions = Array.from(this.commissions.values());
    const allBatches = Array.from(this.payoutBatches.values());

    return {
      totalCommissions: allCommissions.length,
      totalGrossRevenue: allCommissions.reduce((sum, c) => sum + c.grossAmount, 0),
      totalPlatformFees: allCommissions.reduce((sum, c) => sum + c.platformFee, 0),
      totalAffiliateFees: allCommissions.reduce((sum, c) => sum + c.affiliateFee, 0),
      totalPublisherRevenue: allCommissions.reduce((sum, c) => sum + c.publisherRevenue, 0),
      pendingPayouts: allBatches.filter((b) => b.status === 'pending').length,
      completedPayouts: allBatches.filter((b) => b.status === 'completed').length,
      totalAffiliateLinks: this.affiliateLinks.size,
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const commissionService = CommissionService.getInstance();
