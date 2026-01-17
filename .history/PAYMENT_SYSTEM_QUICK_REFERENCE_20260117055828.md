# Payment System Quick Reference

## Service Singletons

Import and use payment services throughout the application:

```typescript
import { 
  x402PaymentService, 
  paymentVerificationService, 
  refundService, 
  escrowService 
} from '@/services/payment';
```

## Common Workflows

### Payment Challenge → Verification → Escrow

```typescript
// Step 1: Request payment challenge
const challenge = x402PaymentService.createPaymentChallenge(
  'tool-id',
  'user-id', 
  'tier-2'
);

// Step 2: User signs and submits payment (off-chain)
// They receive txHash from blockchain

// Step 3: Verify payment
const verification = await paymentVerificationService.verifyPayment(
  txHash,
  challenge.amount,
  challenge.recipientAddress
);

if (!verification.valid) {
  throw new Error('Payment failed validation');
}

// Step 4: Hold payment in escrow during tool execution
const escrow = await escrowService.holdInEscrow(
  txHash,
  userAddress,
  challenge.amount,
  'tool-id',
  'invoke-id'
);
```

### Handle Tool Success

```typescript
// After successful tool execution:
await escrowService.releaseFromEscrow(escrow.id);
// Payment automatically included in next daily settlement batch
```

### Handle Tool Failure

```typescript
// If tool execution fails:
const refund = await refundService.autoRefundOnFailure(
  txHash,
  userAddress,
  challenge.amount,
  'invoke-id'
);

// Or if verification times out:
const refund = await refundService.cancelPaymentOnTimeout(
  txHash,
  userAddress,
  challenge.amount,
  'invoke-id'
);
```

### Query Payment History

```typescript
// Get all payments for a user
const history = x402PaymentService.getUserPaymentRecords('user-id');

// Get specific payment details
const payment = x402PaymentService.getPaymentRecord('tx-hash');

// Get refund status
const refundStatus = refundService.getRefundStatus('refund-id');

// Get user's refund history
const refunds = refundService.getUserRefunds('user-address');

// Get settlement history
const settlements = escrowService.getSettlementHistory(10);
```

---

## REST API Endpoints

### Challenge Endpoint
```bash
POST /api/v1/payments/challenge
Content-Type: application/json

{
  "toolId": "tool-123",
  "userId": "user-456",
  "tier": "tier-2"
}
```

### Verification Endpoint
```bash
POST /api/v1/payments/verify
Content-Type: application/json
Authorization: Bearer <token>

{
  "invokeId": "invoke-789",
  "txHash": "0x...",
  "amount": "100000000000000000"
}
```

### History Endpoint
```bash
GET /api/v1/payments/history?userId=user-456&limit=50
Authorization: Bearer <token>
```

### Details Endpoint
```bash
GET /api/v1/payments/0x...
Authorization: Bearer <token>
```

### Refund Endpoint
```bash
POST /api/v1/payments/0x.../refund
Content-Type: application/json
Authorization: Bearer <token>

{
  "reason": "tool-failure"
}
```

---

## Configuration

### Environment Variables

```bash
# Blockchain
POLYGON_RPC_URL=https://polygon-rpc.com/
POLYGON_PAYMENT_ADDRESS=0x...
POLYGON_REFUND_WALLET_ADDRESS=0x...
POLYGON_REFUND_WALLET_KEY=0x...
POLYGON_PLATFORM_WALLET=0x...

# Payment Service
PAYMENT_TIMEOUT_MINUTES=15
PAYMENT_TIER_RATES=10,100,500,1000

# Verification
POLYGON_CONFIRMATION_BLOCKS=12
VERIFICATION_TIMEOUT_SECONDS=300

# Refund
REFUND_GAS_MULTIPLIER=1.2
REFUND_MAX_RETRIES=3

# Escrow
ESCROW_BATCH_TIME=00:00
ESCROW_FEE_PERCENTAGE=5
```

---

## Event Listeners

Listen for payment events for monitoring:

```typescript
import { x402PaymentService, escrowService, refundService } from '@/services/payment';

// Payment events
x402PaymentService.on('challenge-created', (data) => {
  logger.info('New payment challenge', { challengeId: data.challengeId });
});

x402PaymentService.on('payment-validated', (data) => {
  logger.info('Payment validated', { txHash: data.txHash });
});

// Escrow events
escrowService.on('payment-held', (data) => {
  logger.info('Payment escrowed', { escrowId: data.escrowId });
});

escrowService.on('settlement-batch-processed', (data) => {
  logger.info('Settlement batch', { 
    batchId: data.batchId, 
    amount: data.totalAmount 
  });
});

// Refund events
refundService.on('refund-confirmed', (data) => {
  logger.info('Refund confirmed', { refundId: data.refundId });
});

refundService.on('refund-failed', (data) => {
  logger.error('Refund failed', { refundId: data.refundId, error: data.error });
});
```

---

## Error Handling

### Payment Verification Errors

```typescript
try {
  const verification = await paymentVerificationService.verifyPayment(
    txHash,
    amount,
    recipient
  );
} catch (error) {
  if (error.message.includes('Invalid amount')) {
    // Wrong payment amount
  } else if (error.message.includes('Invalid recipient')) {
    // Wrong recipient address
  } else if (error.message.includes('Double spend')) {
    // Payment already processed
  } else if (error.message.includes('Timeout')) {
    // Blockchain confirmation timeout
  }
}
```

### Refund Errors

```typescript
try {
  const refund = await refundService.initiateRefund({
    originalTxHash: txHash,
    userAddress: userAddress,
    amount: amount,
    reason: 'tool-failure',
    invokeId: invokeId
  });
} catch (error) {
  if (error.message.includes('already processed')) {
    // Duplicate refund prevention
  } else if (error.message.includes('Invalid address')) {
    // Bad wallet address
  } else if (error.message.includes('Invalid hash')) {
    // Bad transaction hash
  }
}
```

---

## Performance Considerations

### Confirmation Polling
- Default: 12 confirmations (~3 minutes on Polygon)
- Timeout: 5 minutes
- Use `waitForConfirmation()` for foreground waits
- Use `verifyPayment()` for quick validation

### Batch Settlement
- Automatic: Daily at 00:00 UTC
- Max size: 1000 records per batch
- Cost: ~30% gas savings vs individual transfers
- Override: Call `escrowService.batchSettlement()` manually

### Caching
- Verification cache: 60 minutes default
- Disable with: `VERIFICATION_CACHE_TTL_MINUTES=0`
- Clear manually: `paymentVerificationService.clearCache()`

---

## Testing

### Run Payment Tests

```bash
# All payment tests
npm run test -- --grep="Payment"

# Specific service tests
npm run test -- --grep="X402Payment"
npm run test -- --grep="PaymentVerification"
npm run test -- --grep="Refund"
npm run test -- --grep="Escrow"

# With coverage
npm run test:coverage -- --grep="Payment"
```

### Manual Testing

```bash
# 1. Create a payment challenge
curl -X POST http://localhost:3000/api/v1/payments/challenge \
  -H "Content-Type: application/json" \
  -d '{
    "toolId": "test-tool",
    "userId": "test-user",
    "tier": "tier-2"
  }'

# 2. Simulate payment on testnet
# Use Polygon Mumbai testnet with MetaMask/ethers.js

# 3. Verify payment
curl -X POST http://localhost:3000/api/v1/payments/verify \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invokeId": "test-invoke",
    "txHash": "0x...",
    "amount": "100000000000000000"
  }'

# 4. Check payment history
curl -X GET "http://localhost:3000/api/v1/payments/history?userId=test-user" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Troubleshooting

### Payment Validation Fails

**Check**:
1. Transaction amount matches challenge amount
2. Recipient address is correct
3. Transaction is confirmed on blockchain
4. No double-spend (check refund history)

### Refund Stuck

**Solutions**:
1. Check status: `refundService.getRefundStatus(refundId)`
2. Check events: Look for 'refund-failed' event
3. Retry manually: System automatically retries up to 3 times
4. Check gas: REFUND_GAS_MULTIPLIER might need increase

### Settlement Not Processing

**Check**:
1. Time is 00:00 UTC (check server time)
2. Has released payments (not held)
3. Check events: Look for 'settlement-scheduled'
4. Manual trigger: `escrowService.batchSettlement()`

### Wallet Issues

**Check**:
1. Wallet has sufficient funds (0.1 MATIC minimum)
2. Private key format (0x-prefixed hex)
3. Network is Polygon (chainId 137)
4. Check balance: `x402PaymentService.getWalletBalance(address)`

---

## Production Checklist

Before deploying to production:

- [ ] All environment variables configured
- [ ] Wallet funded with sufficient MATIC
- [ ] RPC endpoints tested and working
- [ ] Test payment flow end-to-end
- [ ] Review event logging
- [ ] Confirm settlement schedule
- [ ] Set up monitoring and alerts
- [ ] Plan for key rotation
- [ ] Document refund process
- [ ] Train support on refund requests

---

## Support

For issues or questions:

1. Check logs: `logs/payment.log`
2. Check events: Monitor event emitters
3. Review test cases for usage examples
4. Check Phase 5 architecture document: `PHASE_5_PAYMENT_ARCHITECTURE.md`
5. See full report: `PHASE_5_COMPLETION_REPORT.md`
