/**
 * EscrowService - Escrow management and settlement batch processing
 * Handles holding payments in escrow and daily settlement batches
 * 
 * @module src/services/payment/escrow.service
 * @version 1.0.0
 */

import { EventEmitter } from 'events';

/**
 * Escrow record
 */
export interface EscrowRecord {
  id: string;
  txHash: string;
  userAddress: string;
  amount: string;
  toolId: string;
  invokeId: string;
  status: 'held' | 'released' | 'refunded' | 'disputed';
  heldAt: Date;
  releaseDate: Date;
  releasedAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * Settlement log
 */
export interface SettlementLog {
  batchId: string;
  settledAt: Date;
  period: {
    startTime: Date;
    endTime: Date;
  };
  totalRecords: number;
  totalAmount: string;
  fees: string;
  netAmount: string;
  status: 'pending' | 'completed' | 'failed';
  transactions: Array<{
    txHash: string;
    amount: string;
    fee: string;
    recipient: string;
  }>;
  metadata?: Record<string, any>;
}

/**
 * Settlement configuration
 */
export interface SettlementConfig {
  batchTime: string; // HH:mm UTC format (e.g., "00:00")
  challengeWindow: number; // Minutes
  feePercentage: number; // Commission percentage
  minSettlementAmount: string; // Minimum amount to settle
  maxBatchSize: number; // Max records per batch
}

/**
 * EscrowService
 * 
 * Responsibilities:
 * 1. Hold payments in escrow pending tool completion
 * 2. Release escrowed funds after successful tool invocation
 * 3. Refund escrowed funds if tool fails
 * 4. Process daily settlement batches at 00:00 UTC
 * 5. Calculate fees and maintain settlement history
 * 6. Handle disputed payments
 * 
 * @class EscrowService
 */
export class EscrowService extends EventEmitter {
  private static instance: EscrowService;
  
  // Configuration
  private readonly config: SettlementConfig;
  private readonly platformWallet: string;
  
  // State tracking
  private escrowRecords: Map<string, EscrowRecord> = new Map();
  private settlementLogs: SettlementLog[] = [];
  private settlementScheduled: boolean = false;
  
  /**
   * Private constructor (singleton pattern)
   */
  private constructor() {
    super();
    
    // Configuration from environment
    const batchTime = process.env.ESCROW_BATCH_TIME || '00:00';
    const challengeWindow = parseInt(process.env.ESCROW_CHALLENGE_WINDOW || '15');
    const feePercentage = parseFloat(process.env.ESCROW_FEE_PERCENTAGE || '5');
    const minSettlementAmount = process.env.ESCROW_MIN_SETTLEMENT || '1000000000000000000'; // 1 token
    const maxBatchSize = parseInt(process.env.ESCROW_MAX_BATCH_SIZE || '1000');
    
    this.config = {
      batchTime,
      challengeWindow,
      feePercentage,
      minSettlementAmount,
      maxBatchSize,
    };
    
    this.platformWallet = process.env.POLYGON_PLATFORM_WALLET || '';
    
    // Validate configuration
    if (!this.isValidTimeFormat(batchTime)) {
      this.emit('initialization-warning', 'Invalid batch time format');
    }
    
    // Schedule daily settlement if configured
    this.scheduleSettlement();
    
    this.emit('initialized', {
      batchTime,
      challengeWindow,
      feePercentage,
      platformWallet: this.platformWallet,
    });
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(): EscrowService {
    if (!EscrowService.instance) {
      EscrowService.instance = new EscrowService();
    }
    return EscrowService.instance;
  }
  
  /**
   * Hold payment in escrow
   * 
   * Called after payment verified but before tool execution
   * Funds remain in escrow until tool completes successfully
   * 
   * @param {string} txHash - Transaction hash
   * @param {string} userAddress - User's wallet address
   * @param {string} amount - Amount in escrow
   * @param {string} toolId - Tool being invoked
   * @param {string} invokeId - Invocation ID
   * @returns {Promise<EscrowRecord>} Escrow record
   */
  async holdInEscrow(
    txHash: string,
    userAddress: string,
    amount: string,
    toolId: string,
    invokeId: string
  ): Promise<EscrowRecord> {
    // Check for duplicate holds
    const existing = Array.from(this.escrowRecords.values()).find(
      r => r.txHash === txHash && r.status === 'held'
    );
    
    if (existing) {
      throw new Error(`Payment already in escrow: ${txHash}`);
    }
    
    // Validate inputs
    if (!this.isValidAddress(userAddress)) {
      throw new Error('Invalid user address');
    }
    
    if (!this.isValidTransactionHash(txHash)) {
      throw new Error('Invalid transaction hash');
    }
    
    const escrowId = this.generateEscrowId();
    const releaseDate = this.calculateReleaseDate();
    
    const record: EscrowRecord = {
      id: escrowId,
      txHash,
      userAddress,
      amount,
      toolId,
      invokeId,
      status: 'held',
      heldAt: new Date(),
      releaseDate,
    };
    
    try {
      // Store record
      this.escrowRecords.set(escrowId, record);
      
      // Emit event
      this.emit('payment-held', {
        escrowId,
        txHash,
        amount,
        toolId,
        invokeId,
        releaseDate,
      });
      
      return record;
      
    } catch (error) {
      this.emit('escrow-error', {
        operation: 'hold',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      throw error;
    }
  }
  
  /**
   * Release funds from escrow
   * 
   * Called after successful tool execution
   * Funds moved to settlement batch for next daily settlement
   * 
   * @param {string} escrowId - Escrow record ID
   * @returns {Promise<EscrowRecord>} Updated escrow record
   */
  async releaseFromEscrow(escrowId: string): Promise<EscrowRecord> {
    const record = this.escrowRecords.get(escrowId);
    
    if (!record) {
      throw new Error(`Escrow record not found: ${escrowId}`);
    }
    
    if (record.status !== 'held') {
      throw new Error(`Cannot release escrow with status: ${record.status}`);
    }
    
    try {
      record.status = 'released';
      record.releasedAt = new Date();
      
      this.emit('payment-released', {
        escrowId,
        txHash: record.txHash,
        amount: record.amount,
        toolId: record.toolId,
      });
      
      return record;
      
    } catch (error) {
      this.emit('escrow-error', {
        operation: 'release',
        escrowId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      throw error;
    }
  }
  
  /**
   * Refund escrowed payment
   * 
   * Called when tool fails or times out
   * Refunds user's payment from escrow
   * 
   * @param {string} escrowId - Escrow record ID
   * @param {string} reason - Reason for refund
   * @returns {Promise<EscrowRecord>} Updated escrow record
   */
  async refundEscrow(escrowId: string, reason: string): Promise<EscrowRecord> {
    const record = this.escrowRecords.get(escrowId);
    
    if (!record) {
      throw new Error(`Escrow record not found: ${escrowId}`);
    }
    
    if (record.status !== 'held') {
      throw new Error(`Cannot refund escrow with status: ${record.status}`);
    }
    
    try {
      record.status = 'refunded';
      record.metadata = { ...(record.metadata || {}), refundReason: reason };
      record.releasedAt = new Date();
      
      this.emit('payment-refunded', {
        escrowId,
        txHash: record.txHash,
        amount: record.amount,
        reason,
      });
      
      return record;
      
    } catch (error) {
      this.emit('escrow-error', {
        operation: 'refund',
        escrowId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      throw error;
    }
  }
  
  /**
   * Process daily settlement batch
   * 
   * Aggregates all released funds from previous day
   * Calculates fees and settles to merchant accounts
   * Runs automatically at configured time (default 00:00 UTC)
   * 
   * @returns {Promise<SettlementLog>} Settlement log
   */
  async batchSettlement(): Promise<SettlementLog> {
    const now = new Date();
    const batchId = this.generateBatchId();
    
    // Get all released but not settled payments
    const releasedRecords = Array.from(this.escrowRecords.values()).filter(
      r => r.status === 'released' && !r.metadata?.settled
    );
    
    if (releasedRecords.length === 0) {
      // No payments to settle
      const emptyLog: SettlementLog = {
        batchId,
        settledAt: now,
        period: {
          startTime: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          endTime: now,
        },
        totalRecords: 0,
        totalAmount: '0',
        fees: '0',
        netAmount: '0',
        status: 'completed',
        transactions: [],
      };
      
      this.settlementLogs.push(emptyLog);
      this.emit('settlement-batch-processed', emptyLog);
      
      return emptyLog;
    }
    
    // Limit batch size
    const recordsToSettle = releasedRecords.slice(0, this.config.maxBatchSize);
    
    try {
      // Calculate totals
      const totalAmount = recordsToSettle.reduce(
        (sum, r) => sum + BigInt(r.amount),
        BigInt(0)
      );
      
      const fees = this.calculateFees(totalAmount.toString());
      const netAmount = totalAmount - BigInt(fees);
      
      // Create transactions list
      const transactions = recordsToSettle.map(r => ({
        txHash: r.txHash,
        amount: r.amount,
        fee: this.calculateFees(r.amount),
        recipient: r.userAddress,
      }));
      
      // Create settlement log
      const log: SettlementLog = {
        batchId,
        settledAt: now,
        period: {
          startTime: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          endTime: now,
        },
        totalRecords: recordsToSettle.length,
        totalAmount: totalAmount.toString(),
        fees: fees.toString(),
        netAmount: netAmount.toString(),
        status: 'pending',
        transactions,
      };
      
      // Process settlement (simulate blockchain settlement)
      // In production: send batch transaction from PLATFORM_WALLET
      await this.processSettlementBatch(log, recordsToSettle);
      
      log.status = 'completed';
      log.metadata = { processedAt: new Date().toISOString() };
      
      // Mark records as settled
      recordsToSettle.forEach(r => {
        r.metadata = { ...(r.metadata || {}), settled: true, batchId };
      });
      
      this.settlementLogs.push(log);
      
      this.emit('settlement-batch-processed', log);
      
      return log;
      
    } catch (error) {
      const failedLog: SettlementLog = {
        batchId,
        settledAt: now,
        period: {
          startTime: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          endTime: now,
        },
        totalRecords: recordsToSettle.length,
        totalAmount: '0',
        fees: '0',
        netAmount: '0',
        status: 'failed',
        transactions: [],
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
      
      this.settlementLogs.push(failedLog);
      
      this.emit('settlement-batch-error', {
        batchId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      throw error;
    }
  }
  
  /**
   * Calculate fees for amount
   * 
   * @param {string} amount - Amount in wei/smallest unit
   * @returns {string} Fee amount
   */
  calculateFees(amount: string): string {
    const bigAmount = BigInt(amount);
    const fee = (bigAmount * BigInt(Math.floor(this.config.feePercentage * 100))) / 
               BigInt(10000); // Convert percentage to basis points
    return fee.toString();
  }
  
  /**
   * Get settlement history
   * 
   * @param {number} limit - Max records to return
   * @returns {SettlementLog[]} Settlement logs
   */
  getSettlementHistory(limit: number = 30): SettlementLog[] {
    return this.settlementLogs.slice(-limit).reverse();
  }
  
  /**
   * Get escrow record
   * 
   * @param {string} escrowId - Escrow ID
   * @returns {EscrowRecord | undefined} Escrow record
   */
  getEscrowRecord(escrowId: string): EscrowRecord | undefined {
    return this.escrowRecords.get(escrowId);
  }
  
  /**
   * Get escrow records for transaction
   * 
   * @param {string} txHash - Transaction hash
   * @returns {EscrowRecord[]} Escrow records
   */
  getEscrowByTransaction(txHash: string): EscrowRecord[] {
    return Array.from(this.escrowRecords.values()).filter(r => r.txHash === txHash);
  }
  
  /**
   * Get escrow records for user
   * 
   * @param {string} userAddress - User address
   * @returns {EscrowRecord[]} User's escrow records
   */
  getUserEscrow(userAddress: string): EscrowRecord[] {
    return Array.from(this.escrowRecords.values()).filter(
      r => r.userAddress === userAddress
    );
  }
  
  /**
   * Get statistics
   * 
   * @returns {object} Escrow statistics
   */
  getStats(): {
    totalEscrow: number;
    heldEscrow: number;
    releasedEscrow: number;
    refundedEscrow: number;
    totalHeldAmount: string;
    totalSettledAmount: string;
    settledBatches: number;
    nextSettlementTime: Date;
  } {
    const records = Array.from(this.escrowRecords.values());
    
    const held = records.filter(r => r.status === 'held').length;
    const released = records.filter(r => r.status === 'released').length;
    const refunded = records.filter(r => r.status === 'refunded').length;
    
    // Calculate held amount
    let heldAmount = BigInt(0);
    records
      .filter(r => r.status === 'held')
      .forEach(r => {
        heldAmount += BigInt(r.amount);
      });
    
    // Calculate settled amount from settlement logs
    let settledAmount = BigInt(0);
    this.settlementLogs
      .filter(l => l.status === 'completed')
      .forEach(l => {
        settledAmount += BigInt(l.netAmount);
      });
    
    return {
      totalEscrow: records.length,
      heldEscrow: held,
      releasedEscrow: released,
      refundedEscrow: refunded,
      totalHeldAmount: heldAmount.toString(),
      totalSettledAmount: settledAmount.toString(),
      settledBatches: this.settlementLogs.filter(l => l.status === 'completed').length,
      nextSettlementTime: this.calculateNextSettlementTime(),
    };
  }
  
  /**
   * Clear all state (for testing)
   */
  clear(): void {
    this.escrowRecords.clear();
    this.settlementLogs = [];
    this.settlementScheduled = false;
    this.emit('cleared');
  }
  
  /**
   * PRIVATE HELPERS
   */
  
  /**
   * Generate unique escrow ID
   */
  private generateEscrowId(): string {
    return 'escrow_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
  
  /**
   * Generate batch ID
   */
  private generateBatchId(): string {
    return 'batch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
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
   * Validate time format (HH:mm)
   */
  private isValidTimeFormat(time: string): boolean {
    return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
  }
  
  /**
   * Calculate release date (24 hours from now)
   */
  private calculateReleaseDate(): Date {
    const date = new Date();
    date.setHours(date.getHours() + 24);
    return date;
  }
  
  /**
   * Calculate next settlement time
   */
  private calculateNextSettlementTime(): Date {
    const now = new Date();
    const [hours, minutes] = this.config.batchTime.split(':').map(Number);
    
    const next = new Date();
    next.setUTCHours(hours, minutes, 0, 0);
    
    // If time has passed today, schedule for tomorrow
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    
    return next;
  }
  
  /**
   * Schedule daily settlement
   */
  private scheduleSettlement(): void {
    if (this.settlementScheduled) return;
    
    const scheduleNextSettlement = () => {
      const now = new Date();
      const nextTime = this.calculateNextSettlementTime();
      const timeUntilSettlement = nextTime.getTime() - now.getTime();
      
      // Schedule settlement
      setTimeout(async () => {
        try {
          await this.batchSettlement();
        } catch (error) {
          this.emit('settlement-error', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
        
        // Schedule next settlement
        scheduleNextSettlement();
      }, timeUntilSettlement);
      
      this.emit('settlement-scheduled', {
        nextSettlementTime: nextTime,
        timeUntilSettlement: Math.round(timeUntilSettlement / 1000),
      });
    };
    
    scheduleNextSettlement();
    this.settlementScheduled = true;
  }
  
  /**
   * Process settlement batch transaction
   */
  private async processSettlementBatch(
    log: SettlementLog,
    records: EscrowRecord[]
  ): Promise<void> {
    // Simulate blockchain settlement transaction
    // In production: use Web3.js to send batch transfer from PLATFORM_WALLET
    
    // Validate batch
    if (records.length === 0) {
      throw new Error('Empty settlement batch');
    }
    
    // Simulate transaction submission
    const batchTxHash = '0x' + Math.random().toString(16).substr(2) + 
                       Math.random().toString(16).substr(2);
    
    this.emit('settlement-transaction-submitted', {
      batchId: log.batchId,
      txHash: batchTxHash,
      records: records.length,
      totalAmount: log.totalAmount,
      fees: log.fees,
    });
    
    // In production, would wait for confirmation here
    // For now, mark as completed
  }
}

// Export singleton getter
export default EscrowService.getInstance();
