/**
 * Payment Services Export Barrel
 * 
 * Exports all payment-related services as a unified module
 * 
 * @module src/services/payment
 */

export { X402PaymentService, type PaymentChallenge, type PaymentValidationResult, type WalletInfo, type BlockchainTransaction, type PaymentRecord } from './x402-payment.service';

export { PaymentVerificationService, type VerificationResult, type TransactionDetails } from './payment-verification.service';

export { RefundService, type RefundRecord, type RefundRequest, type RefundStatus } from './refund.service';

export { EscrowService, type EscrowRecord, type SettlementLog, type SettlementConfig } from './escrow.service';

// Export singleton instances for convenience
import x402PaymentService from './x402-payment.service';
import paymentVerificationService from './payment-verification.service';
import refundService from './refund.service';
import escrowService from './escrow.service';

export {
  x402PaymentService,
  paymentVerificationService,
  refundService,
  escrowService,
};
