/**
 * PaymentVerificationService - Blockchain verification service
 * Verifies payment transactions on blockchain before tool execution
 *
 * @module src/services/payment/payment-verification.service
 * @version 1.0.0
 */

import { EventEmitter } from 'events';

/**
 * Verification result
 */
export interface VerificationResult {
  verified: boolean;
  txHash: string;
  amountVerified: boolean;
  recipientVerified: boolean;
  doubleSpendVerified: boolean;
  confirmations: number;
  minConfirmationsRequired: number;
  error?: string;
}

/**
 * Transaction details
 */
export interface TransactionDetails {
  hash: string;
  from: string;
  to: string;
  value: string;
  confirmations: number;
  blockNumber: number;
  status: 'pending' | 'confirmed' | 'failed';
  gasUsed: string;
  gasPrice: string;
}

/**
 * PaymentVerificationService
 *
 * Responsibilities:
 * 1. Query blockchain for transaction details
 * 2. Verify payment amounts and recipients
 * 3. Check for double-spending
 * 4. Wait for transaction confirmation
 * 5. Track verification history
 *
 * @class PaymentVerificationService
 */
export class PaymentVerificationService extends EventEmitter {
  private static instance: PaymentVerificationService;

  // Configuration
  private readonly minConfirmations: number;
  private readonly confirmationTimeout: number;
  private readonly blockchainRpcUrl: string;
  private readonly paymentWallet: string;

  // Cache and state
  private verificationCache: Map<string, VerificationResult> = new Map();
  private pendingTransactions: Set<string> = new Set();
  private verificationHistory: Map<string, VerificationResult[]> = new Map();

  /**
   * Private constructor (singleton pattern)
   */
  private constructor() {
    super();

    // Configuration from environment
    this.minConfirmations = parseInt(
      process.env.PAYMENT_MIN_CONFIRMATIONS || '12' // ~3 minutes on Polygon
    );

    this.confirmationTimeout = parseInt(
      process.env.PAYMENT_CONFIRMATION_TIMEOUT || '300000' // 5 minutes
    );

    this.blockchainRpcUrl = process.env.POLYGON_RPC_URL || '';
    this.paymentWallet = process.env.POLYGON_PAYMENT_WALLET || '';

    this.emit('initialized', {
      minConfirmations: this.minConfirmations,
      timeout: this.confirmationTimeout,
      rpcUrl: this.blockchainRpcUrl,
    });
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): PaymentVerificationService {
    if (!PaymentVerificationService.instance) {
      PaymentVerificationService.instance = new PaymentVerificationService();
    }
    return PaymentVerificationService.instance;
  }

  /**
   * Get transaction from blockchain
   *
   * @param {string} txHash - Transaction hash
   * @returns {Promise<TransactionDetails>} Transaction details
   */
  async getTransaction(txHash: string): Promise<TransactionDetails> {
    // Validate hash format
    if (!this.isValidTransactionHash(txHash)) {
      throw new Error(`Invalid transaction hash: ${txHash}`);
    }

    try {
      // In production, would use Web3.js to query blockchain
      // const web3 = new Web3(this.blockchainRpcUrl);
      // const tx = await web3.eth.getTransaction(txHash);
      // const receipt = await web3.eth.getTransactionReceipt(txHash);

      // For now, simulate blockchain query
      const tx = await this.queryBlockchain(txHash);

      if (!tx) {
        throw new Error('Transaction not found on blockchain');
      }

      // Calculate confirmations
      const currentBlockNumber = await this.getCurrentBlockNumber();
      const confirmations = currentBlockNumber - tx.blockNumber;

      const details: TransactionDetails = {
        hash: txHash,
        from: tx.from,
        to: tx.to,
        value: tx.value,
        confirmations,
        blockNumber: tx.blockNumber,
        status: tx.status as any,
        gasUsed: tx.gasUsed,
        gasPrice: tx.gasPrice,
      };

      // Cache result
      this.emit('transaction-retrieved', details);

      return details;
    } catch (error) {
      this.emit('transaction-error', {
        txHash,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Verify payment amount
   *
   * @param {string} txHash - Transaction hash
   * @param {string} expectedAmount - Expected payment amount in Wei
   * @returns {Promise<boolean>} True if amount matches
   */
  async verifyPaymentAmount(txHash: string, expectedAmount: string): Promise<boolean> {
    try {
      const tx = await this.getTransaction(txHash);

      const isValid = tx.value === expectedAmount;

      this.emit('amount-verified', {
        txHash,
        expected: expectedAmount,
        actual: tx.value,
        valid: isValid,
      });

      return isValid;
    } catch (error) {
      this.emit('amount-verification-error', {
        txHash,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Verify payment recipient
   *
   * @param {string} txHash - Transaction hash
   * @param {string} expectedRecipient - Expected recipient wallet address
   * @returns {Promise<boolean>} True if recipient matches
   */
  async verifyPaymentRecipient(txHash: string, expectedRecipient: string): Promise<boolean> {
    try {
      const tx = await this.getTransaction(txHash);

      const isValid = tx.to?.toLowerCase() === expectedRecipient.toLowerCase();

      this.emit('recipient-verified', {
        txHash,
        expected: expectedRecipient,
        actual: tx.to,
        valid: isValid,
      });

      return isValid;
    } catch (error) {
      this.emit('recipient-verification-error', {
        txHash,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Check for double-spending
   *
   * In production, would query database for recorded usage
   * Multiple invocations from same tx would indicate double-spend
   *
   * @param {string} txHash - Transaction hash
   * @returns {Promise<boolean>} True if double-spend detected
   */
  async checkDoubleSpend(txHash: string): Promise<boolean> {
    try {
      // Check if transaction already used
      const history = this.verificationHistory.get(txHash) || [];

      const isDoubleSpend = history.length > 0;

      this.emit('double-spend-checked', {
        txHash,
        doubleSpend: isDoubleSpend,
        usageCount: history.length,
      });

      return isDoubleSpend;
    } catch (error) {
      this.emit('double-spend-check-error', {
        txHash,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return true; // Fail safe - assume double-spend if error
    }
  }

  /**
   * Wait for transaction confirmation
   *
   * Polls blockchain until transaction reaches required confirmation count
   *
   * @param {string} txHash - Transaction hash
   * @param {number} minConfirmations - Minimum confirmations needed (optional, uses default)
   * @returns {Promise<TransactionDetails>} Confirmed transaction details
   */
  async waitForConfirmation(
    txHash: string,
    minConfirmations?: number
  ): Promise<TransactionDetails> {
    const requiredConfirmations = minConfirmations || this.minConfirmations;
    const startTime = Date.now();
    const pollInterval = 5000; // Poll every 5 seconds

    this.pendingTransactions.add(txHash);

    try {
      while (Date.now() - startTime < this.confirmationTimeout) {
        const tx = await this.getTransaction(txHash);

        if (tx.confirmations >= requiredConfirmations) {
          this.pendingTransactions.delete(txHash);
          this.emit('confirmation-reached', {
            txHash,
            confirmations: tx.confirmations,
            required: requiredConfirmations,
          });
          return tx;
        }

        // Wait before next poll
        await this.sleep(pollInterval);
      }

      // Timeout reached
      this.pendingTransactions.delete(txHash);
      throw new Error(
        `Transaction confirmation timeout (${this.confirmationTimeout}ms) ` +
          `waiting for ${requiredConfirmations} confirmations`
      );
    } catch (error) {
      this.pendingTransactions.delete(txHash);
      this.emit('confirmation-error', {
        txHash,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Full verification workflow
   *
   * Performs all verification checks in sequence:
   * 1. Get transaction details
   * 2. Verify amount
   * 3. Verify recipient
   * 4. Check double-spend
   * 5. Wait for confirmations
   *
   * @param {string} txHash - Transaction hash
   * @param {string} expectedAmount - Expected payment amount
   * @param {string} expectedRecipient - Expected recipient (defaults to configured wallet)
   * @returns {Promise<VerificationResult>} Complete verification result
   */
  async verifyPayment(
    txHash: string,
    expectedAmount: string,
    expectedRecipient?: string
  ): Promise<VerificationResult> {
    const recipient = expectedRecipient || this.paymentWallet;

    // Check cache
    const cached = this.verificationCache.get(txHash);
    if (cached && cached.verified) {
      return cached;
    }

    try {
      // Get transaction
      const tx = await this.getTransaction(txHash);

      // Verify amount
      const amountVerified = tx.value === expectedAmount;

      // Verify recipient
      const recipientVerified = tx.to?.toLowerCase() === recipient.toLowerCase();

      // Check double-spend
      const doubleSpendDetected = await this.checkDoubleSpend(txHash);
      const doubleSpendVerified = !doubleSpendDetected;

      const result: VerificationResult = {
        verified:
          amountVerified &&
          recipientVerified &&
          doubleSpendVerified &&
          tx.confirmations >= this.minConfirmations,
        txHash,
        amountVerified,
        recipientVerified,
        doubleSpendVerified,
        confirmations: tx.confirmations,
        minConfirmationsRequired: this.minConfirmations,
        error: undefined,
      };

      // Set error if verification failed
      if (!result.verified) {
        const errors = [];
        if (!amountVerified) errors.push('Amount mismatch');
        if (!recipientVerified) errors.push('Recipient mismatch');
        if (!doubleSpendVerified) errors.push('Double-spend detected');
        if (tx.confirmations < this.minConfirmations) {
          errors.push(`Insufficient confirmations (${tx.confirmations}/${this.minConfirmations})`);
        }
        result.error = errors.join(', ');
      }

      // Cache result
      this.verificationCache.set(txHash, result);

      // Add to history
      if (!this.verificationHistory.has(txHash)) {
        this.verificationHistory.set(txHash, []);
      }
      this.verificationHistory.get(txHash)!.push(result);

      this.emit('payment-verified', result);

      return result;
    } catch (error) {
      const result: VerificationResult = {
        verified: false,
        txHash,
        amountVerified: false,
        recipientVerified: false,
        doubleSpendVerified: false,
        confirmations: 0,
        minConfirmationsRequired: this.minConfirmations,
        error: error instanceof Error ? error.message : 'Verification failed',
      };

      this.emit('verification-error', result);

      return result;
    }
  }

  /**
   * Get verification history for transaction
   *
   * @param {string} txHash - Transaction hash
   * @returns {VerificationResult[]}
   */
  getVerificationHistory(txHash: string): VerificationResult[] {
    return this.verificationHistory.get(txHash) || [];
  }

  /**
   * Clear cache and history (for testing)
   */
  clear(): void {
    this.verificationCache.clear();
    this.verificationHistory.clear();
    this.pendingTransactions.clear();
    this.emit('cleared');
  }

  /**
   * PRIVATE HELPERS
   */

  /**
   * Validate transaction hash format
   */
  private isValidTransactionHash(hash: string): boolean {
    return /^0x[a-fA-F0-9]{64}$/.test(hash);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Query blockchain for transaction
   * In production, would use Web3.js
   */
  private async queryBlockchain(txHash: string): Promise<any> {
    // Simulate blockchain query
    return {
      hash: txHash,
      from: '0x' + 'a'.repeat(40),
      to: this.paymentWallet,
      value: '1000000000000000',
      status: 'confirmed',
      gasUsed: '21000',
      gasPrice: '20000000000',
      blockNumber: 38000000,
    };
  }

  /**
   * Get current block number from blockchain
   * In production, would use Web3.js
   */
  private async getCurrentBlockNumber(): Promise<number> {
    // Simulate getting current block
    return 38000012;
  }
}

// Export singleton getter
export default PaymentVerificationService.getInstance();
