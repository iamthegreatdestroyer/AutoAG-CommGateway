/**
 * RefundService - Automatic refund processing service
 * Handles refund processing for failed tool invocations
 * 
 * @module src/services/payment/refund.service
 * @version 1.0.0
 */

import { EventEmitter } from 'events';

/**
 * Refund record
 */
export interface RefundRecord {
  id: string;
  originalTxHash: string;
  refundTxHash?: string;
  userAddress: string;
  amount: string;
  gasPrice: string;
  reason: string;
  status: 'initiated' | 'pending' | 'confirmed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * Refund request
 */
export interface RefundRequest {
  originalTxHash: string;
  userAddress: string;
  amount: string;
  reason: 'tool-failure' | 'timeout' | 'user-request' | 'double-payment';
  invokeId: string;
}

/**
 * Refund status
 */
export interface RefundStatus {
  refundId: string;
  originalTxHash: string;
  status: 'initiated' | 'pending' | 'confirmed' | 'failed';
  refundTxHash?: string;
  confirmations?: number;
  estimatedTime?: string;
  error?: string;
}

/**
 * RefundService
 * 
 * Responsibilities:
 * 1. Process refunds for failed tool invocations
 * 2. Track refund status on blockchain
 * 3. Manage refund wallet and gas costs
 * 4. Prevent duplicate refunds
 * 5. Record refund history
 * 
 * @class RefundService
 */
export class RefundService extends EventEmitter {
  private static instance: RefundService;
  
  // Configuration
  private readonly refundWalletAddress: string;
  private readonly refundWalletPrivateKey: string;
  private readonly gasMultiplier: number;
  private readonly maxRefundRetries: number;
  
  // State tracking
  private refundRecords: Map<string, RefundRecord> = new Map();
  private processedTransactions: Set<string> = new Set();
  private pendingRefunds: Map<string, RefundRequest> = new Map();
  
  /**
   * Private constructor (singleton pattern)
   */
  private constructor() {
    super();
    
    // Configuration from environment
    this.refundWalletAddress = process.env.POLYGON_REFUND_WALLET_ADDRESS || '';
    this.refundWalletPrivateKey = process.env.POLYGON_REFUND_WALLET_KEY || '';
    this.gasMultiplier = parseFloat(process.env.REFUND_GAS_MULTIPLIER || '1.2');
    this.maxRefundRetries = parseInt(process.env.REFUND_MAX_RETRIES || '3');
    
    // Validate configuration
    if (!this.refundWalletAddress || !this.isValidAddress(this.refundWalletAddress)) {
      this.emit('initialization-warning', 'Invalid refund wallet address');
    }
    
    this.emit('initialized', {
      wallet: this.refundWalletAddress,
      gasMultiplier: this.gasMultiplier,
      maxRetries: this.maxRefundRetries,
    });
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(): RefundService {
    if (!RefundService.instance) {
      RefundService.instance = new RefundService();
    }
    return RefundService.instance;
  }
  
  /**
   * Initiate refund for failed transaction
   * 
   * @param {RefundRequest} request - Refund request details
   * @returns {Promise<RefundRecord>} Created refund record
   */
  async initiateRefund(request: RefundRequest): Promise<RefundRecord> {
    // Check for duplicate refund
    if (this.processedTransactions.has(request.originalTxHash)) {
      throw new Error(
        `Refund already processed for transaction: ${request.originalTxHash}`
      );
    }
    
    // Validate inputs
    if (!this.isValidAddress(request.userAddress)) {
      throw new Error('Invalid user wallet address');
    }
    
    if (!this.isValidTransactionHash(request.originalTxHash)) {
      throw new Error('Invalid transaction hash');
    }
    
    const refundId = this.generateRefundId();
    
    const record: RefundRecord = {
      id: refundId,
      originalTxHash: request.originalTxHash,
      userAddress: request.userAddress,
      amount: request.amount,
      gasPrice: this.calculateGasPrice(request.amount),
      reason: request.reason,
      status: 'initiated',
      createdAt: new Date(),
    };
    
    try {
      // Store record
      this.refundRecords.set(refundId, record);
      this.pendingRefunds.set(refundId, request);
      
      // Emit event
      this.emit('refund-initiated', {
        refundId,
        originalTx: request.originalTxHash,
        amount: request.amount,
        reason: request.reason,
        invokeId: request.invokeId,
      });
      
      // Attempt refund transaction
      await this.processRefundTransaction(refundId, record, request);
      
      return record;
      
    } catch (error) {
      record.status = 'failed';
      record.metadata = {
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      
      this.emit('refund-initiation-error', {
        refundId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      throw error;
    }
  }
  
  /**
   * Get refund status
   * 
   * @param {string} refundId - Refund ID
   * @returns {Promise<RefundStatus>} Current refund status
   */
  async getRefundStatus(refundId: string): Promise<RefundStatus> {
    const record = this.refundRecords.get(refundId);
    
    if (!record) {
      throw new Error(`Refund not found: ${refundId}`);
    }
    
    let confirmations: number | undefined;
    let estimatedTime: string | undefined;
    
    // If confirmed, provide details
    if (record.status === 'confirmed' && record.refundTxHash) {
      confirmations = await this.getTransactionConfirmations(record.refundTxHash);
      estimatedTime = 'Completed';
    } else if (record.status === 'pending' && record.refundTxHash) {
      confirmations = await this.getTransactionConfirmations(record.refundTxHash);
      
      // Estimate time based on confirmations
      if (confirmations && confirmations < 12) {
        const estimatedBlocks = 12 - confirmations;
        const estimatedSeconds = estimatedBlocks * 2; // ~2 second blocks on Polygon
        estimatedTime = `${Math.ceil(estimatedSeconds / 60)} minutes`;
      }
    }
    
    return {
      refundId,
      originalTxHash: record.originalTxHash,
      status: record.status,
      refundTxHash: record.refundTxHash,
      confirmations,
      estimatedTime,
      error: record.metadata?.error,
    };
  }
  
  /**
   * Automatically refund on failure
   * 
   * Called when tool invocation fails
   * Automatically initiates refund without waiting for manual request
   * 
   * @param {string} originalTxHash - Original payment transaction hash
   * @param {string} userAddress - User's wallet address
   * @param {string} amount - Refund amount
   * @param {string} invokeId - Invocation ID that failed
   * @returns {Promise<RefundRecord>} Refund record
   */
  async autoRefundOnFailure(
    originalTxHash: string,
    userAddress: string,
    amount: string,
    invokeId: string
  ): Promise<RefundRecord> {
    const request: RefundRequest = {
      originalTxHash,
      userAddress,
      amount,
      reason: 'tool-failure',
      invokeId,
    };
    
    return this.initiateRefund(request);
  }
  
  /**
   * Cancel payment on timeout
   * 
   * Called when payment verification times out
   * Prevents tool execution and initiates refund
   * 
   * @param {string} originalTxHash - Original transaction hash
   * @param {string} userAddress - User's wallet address
   * @param {string} amount - Refund amount
   * @param {string} invokeId - Invocation ID
   * @returns {Promise<RefundRecord>} Refund record
   */
  async cancelPaymentOnTimeout(
    originalTxHash: string,
    userAddress: string,
    amount: string,
    invokeId: string
  ): Promise<RefundRecord> {
    const request: RefundRequest = {
      originalTxHash,
      userAddress,
      amount,
      reason: 'timeout',
      invokeId,
    };
    
    return this.initiateRefund(request);
  }
  
  /**
   * Get refund history for transaction
   * 
   * @param {string} txHash - Original transaction hash
   * @returns {RefundRecord[]}
   */
  getRefundHistory(txHash: string): RefundRecord[] {
    return Array.from(this.refundRecords.values()).filter(
      r => r.originalTxHash === txHash
    );
  }
  
  /**
   * Get refunds for user
   * 
   * @param {string} userAddress - User's wallet address
   * @returns {RefundRecord[]}
   */
  getUserRefunds(userAddress: string): RefundRecord[] {
    return Array.from(this.refundRecords.values()).filter(
      r => r.userAddress === userAddress
    );
  }
  
  /**
   * Get statistics
   * 
   * @returns {object} Refund statistics
   */
  getStats(): {
    totalRefunds: number;
    initiatedRefunds: number;
    pendingRefunds: number;
    confirmedRefunds: number;
    failedRefunds: number;
    totalRefundedAmount: string;
    successRate: number;
  } {
    const records = Array.from(this.refundRecords.values());
    
    const initiated = records.filter(r => r.status === 'initiated').length;
    const pending = records.filter(r => r.status === 'pending').length;
    const confirmed = records.filter(r => r.status === 'confirmed').length;
    const failed = records.filter(r => r.status === 'failed').length;
    
    // Calculate total refunded amount
    let totalAmount = BigInt(0);
    records.forEach(r => {
      if (r.status === 'confirmed') {
        totalAmount += BigInt(r.amount);
      }
    });
    
    const successRate = records.length > 0 ? (confirmed / records.length) * 100 : 0;
    
    return {
      totalRefunds: records.length,
      initiatedRefunds: initiated,
      pendingRefunds: pending,
      confirmedRefunds: confirmed,
      failedRefunds: failed,
      totalRefundedAmount: totalAmount.toString(),
      successRate: Math.round(successRate * 100) / 100,
    };
  }
  
  /**
   * Clear all state (for testing)
   */
  clear(): void {
    this.refundRecords.clear();
    this.processedTransactions.clear();
    this.pendingRefunds.clear();
    this.emit('cleared');
  }
  
  /**
   * PRIVATE HELPERS
   */
  
  /**
   * Generate unique refund ID
   */
  private generateRefundId(): string {
    return 'refund_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
  
  /**
   * Calculate gas price with multiplier
   */
  private calculateGasPrice(baseAmount: string): string {
    const base = BigInt(baseAmount);
    const gasPrice = (base * BigInt(Math.floor(this.gasMultiplier * 100))) / BigInt(100);
    return gasPrice.toString();
  }
  
  /**
   * Validate wallet address format
   */
  private isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }
  
  /**
   * Validate transaction hash format
   */
  private isValidTransactionHash(hash: string): boolean {
    return /^0x[a-fA-F0-9]{64}$/.test(hash);
  }
  
  /**
   * Process refund transaction on blockchain
   */
  private async processRefundTransaction(
    refundId: string,
    record: RefundRecord,
    request: RefundRequest
  ): Promise<void> {
    let retries = 0;
    
    while (retries < this.maxRefundRetries) {
      try {
        // Simulate blockchain refund transaction
        // In production: use Web3.js to send transaction from REFUND_WALLET
        
        // Simulate transaction hash
        const refundTxHash = '0x' + Math.random().toString(16).substr(2) + 
                           Math.random().toString(16).substr(2);
        
        record.status = 'pending';
        record.refundTxHash = refundTxHash;
        
        this.emit('refund-transaction-submitted', {
          refundId,
          refundTxHash,
          amount: record.amount,
          to: request.userAddress,
        });
        
        // Simulate waiting for confirmation
        await this.waitForRefundConfirmation(refundId, refundTxHash);
        
        // Mark as confirmed
        record.status = 'confirmed';
        record.completedAt = new Date();
        this.processedTransactions.add(request.originalTxHash);
        this.pendingRefunds.delete(refundId);
        
        this.emit('refund-confirmed', {
          refundId,
          refundTxHash,
          amount: record.amount,
        });
        
        break; // Success
        
      } catch (error) {
        retries++;
        
        if (retries >= this.maxRefundRetries) {
          record.status = 'failed';
          record.metadata = {
            ...(record.metadata || {}),
            failedAttempts: retries,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
          
          this.emit('refund-failed', {
            refundId,
            attempts: retries,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          
          throw error;
        }
        
        // Wait before retry
        await this.sleep(5000 * retries); // Exponential backoff
        
        this.emit('refund-retry', {
          refundId,
          attempt: retries + 1,
          maxRetries: this.maxRefundRetries,
        });
      }
    }
  }
  
  /**
   * Wait for refund transaction confirmation
   */
  private async waitForRefundConfirmation(
    refundId: string,
    txHash: string
  ): Promise<void> {
    const maxWaitTime = 300000; // 5 minutes
    const pollInterval = 5000; // 5 seconds
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      // Check confirmations (simulated)
      const confirmations = await this.getTransactionConfirmations(txHash);
      
      if (confirmations >= 12) { // 12 confirmations
        return;
      }
      
      await this.sleep(pollInterval);
    }
    
    throw new Error(`Refund confirmation timeout for ${txHash}`);
  }
  
  /**
   * Get transaction confirmation count
   */
  private async getTransactionConfirmations(txHash: string): Promise<number> {
    // Simulate getting confirmations
    // In production: use Web3.js to query blockchain
    return Math.min(12, Math.floor(Math.random() * 15));
  }
  
  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton getter
export default RefundService.getInstance();
