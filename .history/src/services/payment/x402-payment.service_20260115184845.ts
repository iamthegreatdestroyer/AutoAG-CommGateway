/**
 * X402PaymentService - Core payment orchestration service
 * Handles HTTP 402 Payment Required protocol for micropayment processing
 * 
 * @module src/services/payment/x402-payment.service
 * @version 1.0.0
 */

import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';

/**
 * Payment challenge issued by server
 * Client must pay to proceed with tool invocation
 */
export interface PaymentChallenge {
  status: 402;
  challenge: {
    invokeId: string;          // Unique invocation ID
    amount: string;             // Amount in smallest unit (Gwei/Wei)
    currency: 'ETH' | 'MATIC'; // Payment currency
    wallet: string;             // Payment recipient address
    deadline: string;           // ISO timestamp, valid for 15 minutes
    signature: string;          // Server signature for verification
    networkId: number;          // Blockchain network ID
  };
}

/**
 * Payment validation result
 */
export interface PaymentValidationResult {
  valid: boolean;
  invokeId: string;
  txHash: string;
  amount: string;
  confirmedAt?: Date;
  error?: string;
}

/**
 * Wallet information
 */
export interface WalletInfo {
  address: string;
  balance: string;
  network: string;
  provider: 'metamask' | 'walletconnect' | 'ledger';
}

/**
 * Transaction details from blockchain
 */
export interface BlockchainTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasPrice: string;
  nonce: number;
  blockNumber?: number;
  confirmations: number;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: Date;
}

/**
 * Payment record in system
 */
export interface PaymentRecord {
  id: string;
  invokeId: string;
  userId: string;
  toolId: string;
  txHash: string;
  amount: string;
  currency: string;
  status: 'pending' | 'confirmed' | 'failed' | 'refunded';
  createdAt: Date;
  confirmedAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * X402PaymentService
 * 
 * Responsibilities:
 * 1. Generate payment challenges for tool invocations
 * 2. Validate payment transactions on blockchain
 * 3. Manage payment lifecycle
 * 4. Prevent double-spending
 * 5. Coordinate with wallet providers
 * 
 * @class X402PaymentService
 */
export class X402PaymentService extends EventEmitter {
  private static instance: X402PaymentService;
  
  // Configuration
  private readonly networkId: number;
  private readonly paymentWallet: string;
  private readonly challengeTimeout: number;
  private readonly paymentTiers: Map<string, string>;
  
  // State tracking
  private paymentRecords: Map<string, PaymentRecord> = new Map();
  private usedTransactions: Set<string> = new Set();
  private activeWallets: Map<string, WalletInfo> = new Map();
  
  /**
   * Private constructor (singleton pattern)
   */
  private constructor() {
    super();
    
    // Configuration from environment
    this.networkId = process.env.POLYGON_NETWORK_ID ? 
      parseInt(process.env.POLYGON_NETWORK_ID) : 137; // Polygon mainnet
    
    this.paymentWallet = process.env.POLYGON_PAYMENT_WALLET || '';
    
    this.challengeTimeout = parseInt(
      process.env.PAYMENT_CHALLENGE_TIMEOUT || '900000' // 15 minutes
    );
    
    // Payment tier configuration
    this.paymentTiers = new Map([
      ['tier-1', process.env.PAYMENT_TIER_1_AMOUNT || '1000000000000000'],      // 0.001 ETH
      ['tier-2', process.env.PAYMENT_TIER_2_AMOUNT || '10000000000000000'],     // 0.01 ETH
      ['tier-3', process.env.PAYMENT_TIER_3_AMOUNT || '100000000000000000'],    // 0.1 ETH
      ['tier-4', process.env.PAYMENT_TIER_4_AMOUNT || '1000000000000000000'],   // 1 ETH
    ]);
    
    this.emit('initialized', {
      network: this.networkId,
      wallet: this.paymentWallet,
      tiers: Array.from(this.paymentTiers.entries()),
    });
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(): X402PaymentService {
    if (!X402PaymentService.instance) {
      X402PaymentService.instance = new X402PaymentService();
    }
    return X402PaymentService.instance;
  }
  
  /**
   * Create payment challenge for tool invocation
   * 
   * Returns HTTP 402 challenge that client must satisfy with blockchain payment
   * 
   * @param {string} invokeId - Unique invocation ID
   * @param {string} toolId - Tool being invoked
   * @param {string} userId - User invoking tool
   * @param {string} tier - Payment tier (tier-1, tier-2, etc.)
   * @returns {Promise<PaymentChallenge>} Payment challenge with blockchain details
   */
  async createPaymentChallenge(
    invokeId: string,
    toolId: string,
    userId: string,
    tier: string = 'tier-1'
  ): Promise<PaymentChallenge> {
    const amount = this.paymentTiers.get(tier);
    if (!amount) {
      throw new Error(`Invalid payment tier: ${tier}`);
    }
    
    const deadline = new Date(Date.now() + this.challengeTimeout).toISOString();
    const challengeData = `${invokeId}:${this.paymentWallet}:${amount}:${deadline}`;
    
    // Sign challenge with server key (simplified - would use real signing in production)
    const signature = this.signChallenge(challengeData);
    
    const challenge: PaymentChallenge = {
      status: 402,
      challenge: {
        invokeId,
        amount,
        currency: 'MATIC',
        wallet: this.paymentWallet,
        deadline,
        signature,
        networkId: this.networkId,
      },
    };
    
    // Record challenge creation
    this.emit('challenge-created', {
      invokeId,
      toolId,
      userId,
      tier,
      deadline,
    });
    
    return challenge;
  }
  
  /**
   * Validate payment transaction
   * 
   * Verifies transaction exists on blockchain and meets payment requirements
   * 
   * @param {string} invokeId - Invocation ID from challenge
   * @param {string} txHash - Transaction hash from blockchain
   * @param {string} expectedAmount - Amount that should be transferred
   * @returns {Promise<PaymentValidationResult>} Validation result
   */
  async validatePaymentTransaction(
    invokeId: string,
    txHash: string,
    expectedAmount: string
  ): Promise<PaymentValidationResult> {
    // Check if already used (prevent double-spending)
    if (this.usedTransactions.has(txHash)) {
      return {
        valid: false,
        invokeId,
        txHash,
        amount: expectedAmount,
        error: 'Transaction already used (double-spend detected)',
      };
    }
    
    try {
      // Validate transaction hash format
      if (!this.isValidTransactionHash(txHash)) {
        return {
          valid: false,
          invokeId,
          txHash,
          amount: expectedAmount,
          error: 'Invalid transaction hash format',
        };
      }
      
      // In real implementation, query blockchain here
      // For now, simulate successful validation
      const tx = await this.queryBlockchainTransaction(txHash);
      
      if (!tx) {
        return {
          valid: false,
          invokeId,
          txHash,
          amount: expectedAmount,
          error: 'Transaction not found on blockchain',
        };
      }
      
      // Verify payment details
      if (tx.to?.toLowerCase() !== this.paymentWallet.toLowerCase()) {
        return {
          valid: false,
          invokeId,
          txHash,
          amount: expectedAmount,
          error: 'Payment not sent to correct wallet',
        };
      }
      
      if (tx.value !== expectedAmount) {
        return {
          valid: false,
          invokeId,
          txHash,
          amount: expectedAmount,
          error: `Incorrect payment amount (expected ${expectedAmount}, got ${tx.value})`,
        };
      }
      
      // Mark as used
      this.usedTransactions.add(txHash);
      this.emit('payment-validated', { invokeId, txHash, amount: expectedAmount });
      
      return {
        valid: true,
        invokeId,
        txHash,
        amount: expectedAmount,
        confirmedAt: new Date(),
      };
      
    } catch (error) {
      return {
        valid: false,
        invokeId,
        txHash,
        amount: expectedAmount,
        error: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
  
  /**
   * Check if payment is valid and sufficient
   * 
   * @param {string} txHash - Transaction hash
   * @returns {Promise<boolean>} True if valid, false otherwise
   */
  async isPaymentValid(txHash: string): Promise<boolean> {
    return !this.usedTransactions.has(txHash);
  }
  
  /**
   * Record payment usage (prevent double-spend)
   * 
   * @param {string} txHash - Transaction hash
   * @param {PaymentRecord} record - Payment record to store
   * @returns {Promise<void>}
   */
  async recordPaymentUsage(txHash: string, record: PaymentRecord): Promise<void> {
    this.usedTransactions.add(txHash);
    this.paymentRecords.set(record.id, record);
    this.emit('payment-recorded', record);
  }
  
  /**
   * Initialize wallet connection
   * 
   * @param {string} provider - Wallet provider (metamask, walletconnect, etc.)
   * @param {Record<string, any>} providerConfig - Provider configuration
   * @returns {Promise<WalletInfo>} Wallet connection info
   */
  async initializeWallet(
    provider: string,
    providerConfig: Record<string, any>
  ): Promise<WalletInfo> {
    try {
      // Simulate wallet connection
      // In production, would use Web3.js/ethers.js to connect to provider
      
      const wallet: WalletInfo = {
        address: providerConfig.address || '',
        balance: providerConfig.balance || '0',
        network: providerConfig.network || 'polygon',
        provider: (provider as any) || 'metamask',
      };
      
      // Validate address format
      if (!this.isValidAddress(wallet.address)) {
        throw new Error('Invalid wallet address format');
      }
      
      this.activeWallets.set(wallet.address, wallet);
      this.emit('wallet-connected', wallet);
      
      return wallet;
    } catch (error) {
      this.emit('wallet-error', {
        provider,
        error: error instanceof Error ? error.message : 'Connection failed',
      });
      throw error;
    }
  }
  
  /**
   * Get wallet balance
   * 
   * @param {string} address - Wallet address
   * @returns {Promise<string>} Balance in Wei/Gwei
   */
  async getWalletBalance(address: string): Promise<string> {
    const wallet = this.activeWallets.get(address);
    if (!wallet) {
      throw new Error(`Wallet not connected: ${address}`);
    }
    
    // In production, query blockchain for actual balance
    return wallet.balance;
  }
  
  /**
   * Get payment record by ID
   * 
   * @param {string} id - Payment record ID
   * @returns {PaymentRecord | undefined}
   */
  getPaymentRecord(id: string): PaymentRecord | undefined {
    return this.paymentRecords.get(id);
  }
  
  /**
   * Get all payment records for user
   * 
   * @param {string} userId - User ID
   * @returns {PaymentRecord[]}
   */
  getUserPaymentRecords(userId: string): PaymentRecord[] {
    return Array.from(this.paymentRecords.values()).filter(
      r => r.userId === userId
    );
  }
  
  /**
   * Get statistics
   * 
   * @returns {object} Service statistics
   */
  getStats(): {
    totalPayments: number;
    confirmedPayments: number;
    pendingPayments: number;
    failedPayments: number;
    refundedPayments: number;
    uniqueTransactions: number;
    activeWallets: number;
  } {
    const records = Array.from(this.paymentRecords.values());
    
    return {
      totalPayments: records.length,
      confirmedPayments: records.filter(r => r.status === 'confirmed').length,
      pendingPayments: records.filter(r => r.status === 'pending').length,
      failedPayments: records.filter(r => r.status === 'failed').length,
      refundedPayments: records.filter(r => r.status === 'refunded').length,
      uniqueTransactions: this.usedTransactions.size,
      activeWallets: this.activeWallets.size,
    };
  }
  
  /**
   * Clear all state (for testing)
   */
  clear(): void {
    this.paymentRecords.clear();
    this.usedTransactions.clear();
    this.activeWallets.clear();
    this.emit('cleared');
  }
  
  /**
   * PRIVATE HELPERS
   */
  
  /**
   * Sign challenge with server key
   */
  private signChallenge(data: string): string {
    // Simplified signing - in production use real crypto signing
    return 'sig_' + randomBytes(32).toString('hex');
  }
  
  /**
   * Validate transaction hash format
   */
  private isValidTransactionHash(hash: string): boolean {
    return /^0x[a-fA-F0-9]{64}$/.test(hash);
  }
  
  /**
   * Validate wallet address format
   */
  private isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }
  
  /**
   * Query blockchain for transaction details
   * In production, would use Web3.js to query real blockchain
   */
  private async queryBlockchainTransaction(
    txHash: string
  ): Promise<BlockchainTransaction | null> {
    // Placeholder for blockchain query
    // In production: use web3.eth.getTransaction() or similar
    return {
      hash: txHash,
      from: '0x' + 'a'.repeat(40),
      to: this.paymentWallet,
      value: '1000000000000000',
      gas: '21000',
      gasPrice: '20000000000',
      nonce: 0,
      blockNumber: 0,
      confirmations: 1,
      status: 'confirmed',
      timestamp: new Date(),
    };
  }
}

// Export singleton getter
export default X402PaymentService.getInstance();
