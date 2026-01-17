# Phase 5: x402 Payment Integration Architecture

**Status**: 🏗️ IN DESIGN  
**Target Completion**: 15-20 hours  
**Autonomy Level**: 60% (requires payment flow consultation)

---

## 1. Executive Summary

Phase 5 integrates the **HTTP 402 Payment Required (x402)** micropayment protocol into AutoAG-CommGateway, enabling:

- **Per-tool micropayments** for tool invocations
- **Wallet integration** for payment handling (MetaMask/WalletConnect)
- **Blockchain-based settlement** with configurable networks
- **Automatic refunds** for failed invocations
- **Escrow system** for payment security

This design supports **low-friction payments** for API access while maintaining **payment security** and **user privacy**.

---

## 2. x402 Protocol Overview

### What is HTTP 402?

The x402 micropayment protocol extends HTTP with a `402 Payment Required` status code:

```
Client Request
    ↓
Server: "402 Payment Required"
    ↓ [Return payment challenge]
Client: Payment via blockchain
    ↓
Server: "200 OK" [Execute tool]
    ↓ [Return result]
```

### Payment Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    PAYMENT REQUEST FLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. CLIENT REQUEST                                               │
│     POST /api/v1/tools/{id}/invoke                              │
│     {"input": "..."}                                            │
│                                                                   │
│  2. SERVER RATE CHECK                                            │
│     Check if tool has payment requirement                        │
│     If free tool → proceed to step 7                            │
│                                                                   │
│  3. SERVER PAYMENT CHALLENGE                                     │
│     Return 402 with payment details:                             │
│     {                                                            │
│       "status": 402,                                             │
│       "challenge": {                                             │
│         "amount": "0.000001", // 1 microtoken (smallest unit)   │
│         "currency": "ETH",                                       │
│         "wallet": "0x1234...abcd", // Payment address           │
│         "deadline": "2026-01-16T14:30:00Z",                     │
│         "invokeId": "inv-uuid", // Unique invocation ID         │
│         "signature": "0xabc..." // Server signature for proof   │
│       }                                                          │
│     }                                                            │
│                                                                   │
│  4. CLIENT PAYMENT (ASYNC)                                       │
│     - User clicks "Pay with MetaMask" button                     │
│     - MetaMask opens, shows payment confirmation                 │
│     - User confirms transaction                                  │
│     - Transaction broadcast to blockchain                        │
│     - Client polls for confirmation or uses WebSocket            │
│                                                                   │
│  5. PAYMENT VERIFICATION                                         │
│     Once transaction confirmed on chain:                         │
│     - Client retries original request with:                      │
│       POST /api/v1/tools/{id}/invoke                            │
│       {                                                          │
│         "input": "...",                                          │
│         "payment": {                                             │
│           "txHash": "0x123...abc", // Ethereum tx hash          │
│           "invokeId": "inv-uuid"   // Matches challenge         │
│         }                                                        │
│       }                                                          │
│                                                                   │
│  6. SERVER TRANSACTION VERIFICATION                              │
│     - PaymentVerificationService queries blockchain:             │
│       ✓ Verify transaction hash exists                           │
│       ✓ Verify payment amount is correct                         │
│       ✓ Verify payment address is server wallet                  │
│       ✓ Verify payment is not already used (double-spend check) │
│       ✓ Verify transaction status (pending/confirmed)           │
│     - If verified, mark payment as valid                        │
│     - If invalid, return error and require new payment           │
│                                                                   │
│  7. TOOL EXECUTION                                               │
│     If payment verified (or tool is free):                       │
│     - MCPServerClient.invokeTool() executes the tool            │
│     - RateLimiterService tracks usage per user                  │
│     - Result is returned to client                              │
│                                                                   │
│  8. SETTLEMENT & ESCROW                                          │
│     - Payment recorded in escrow system                          │
│     - After N confirmations (e.g., 12 blocks):                  │
│       ✓ Payment moved to settlement queue                        │
│       ✓ Escrow released to platform wallet                       │
│     - Automatic refund initiated if tool execution fails:        │
│       ✓ Error detected in step 7                                 │
│       ✓ RefundService creates refund transaction               │
│       ✓ User receives refund (minus network fees)                │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Recommended Implementation Strategy

### 3.1 Wallet Provider Selection

**Recommendation: MetaMask + WalletConnect**

```
┌────────────────────────────────────────────────────┐
│        WALLET PROVIDER COMPARISON                   │
├────────────────────────────────────────────────────┤
│                                                    │
│ MetaMask (Primary)                                │
│ ✅ Most popular EVM wallet (50M+ users)           │
│ ✅ Built-in browser extension                     │
│ ✅ Excellent UX for payments                      │
│ ✅ Active development & great docs                │
│ ✅ Hardware wallet support (Ledger, Trezor)       │
│ ⚠️  Browser-dependent                             │
│                                                    │
│ WalletConnect (Mobile Fallback)                   │
│ ✅ Mobile-first payment flow                      │
│ ✅ Multi-wallet support (50+ wallets)             │
│ ✅ Works across devices & browsers                │
│ ✅ QR code scanning for easy connection           │
│ ⚠️  Slightly more complex setup                   │
│                                                    │
│ Recommended: Use BOTH                             │
│ - MetaMask for desktop/browser users              │
│ - WalletConnect for mobile fallback               │
│ - Graceful degradation if user lacks both         │
│                                                    │
└────────────────────────────────────────────────────┘
```

### 3.2 Blockchain Network Selection

**Recommendation: Polygon (for scalability) + Ethereum (for security)**

```
┌────────────────────────────────────────────────────┐
│           BLOCKCHAIN NETWORK OPTIONS                │
├────────────────────────────────────────────────────┤
│                                                    │
│ Primary Network: Polygon (MATIC)                  │
│ ✅ Fast transactions (2-3 seconds)                │
│ ✅ Cheap fees ($0.00001 - $0.01 per tx)           │
│ ✅ 65M transactions/day capacity                  │
│ ✅ EVM compatible (same code as Ethereum)         │
│ ✅ Growing ecosystem & adoption                   │
│ ✅ Perfect for micropayments                      │
│ ⚠️  Slightly lower security than Ethereum         │
│                                                    │
│ Fallback Network: Ethereum (ETH)                  │
│ ✅ Maximum security & decentralization            │
│ ✅ Largest developer ecosystem                    │
│ ✅ Most liquidity & market cap                    │
│ ⚠️  Slower confirmation (12-15s blocks)           │
│ ⚠️  Higher fees ($1-50+ per transaction)          │
│ ⚠️  May not be viable for micropayments           │
│                                                    │
│ Implementation Strategy:                          │
│ 1. Accept payments primarily on Polygon           │
│ 2. Offer Ethereum for users who prefer it         │
│ 3. Allow cross-chain bridging (Polygon ↔ Eth)    │
│ 4. Daily batch settlement from Polygon → Ethereum │
│                                                    │
└────────────────────────────────────────────────────┘
```

### 3.3 Payment Amount Structure

**Recommended: Tiered Pricing Based on Tool Complexity**

```
┌──────────────────────────────────────────────────────────┐
│              PAYMENT TIERS                                │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ Tier 1: Simple Read Operations                          │
│ Examples: Data lookup, status check, list items         │
│ Cost: 1 Gwei (0.000000001 ETH) = $0.000002              │
│ Frequency: <100ms execution time                        │
│                                                          │
│ Tier 2: Standard Operations                             │
│ Examples: Create item, update record, analyze data      │
│ Cost: 10 Gwei (0.00000001 ETH) = $0.00002               │
│ Frequency: 100ms-1s execution time                      │
│                                                          │
│ Tier 3: Complex Operations                              │
│ Examples: ML inference, file processing, heavy compute  │
│ Cost: 100 Gwei (0.0000001 ETH) = $0.0002                │
│ Frequency: 1s-5s execution time                         │
│                                                          │
│ Tier 4: Premium Operations                              │
│ Examples: Real-time trading, custom model training      │
│ Cost: 1000 Gwei (0.000001 ETH) = $0.002                 │
│ Frequency: 5s-30s execution time                        │
│                                                          │
│ FREE TIER (Optional)                                    │
│ Examples: Rate-limited endpoints, public data           │
│ Cost: 0 ETH                                             │
│ Frequency: Configurable rate limit                      │
│                                                          │
│ Implementation:                                         │
│ - Tool metadata includes tier assignment               │
│ - Tool Registry maps tool → price tier                 │
│ - PaymentVerificationService enforces pricing          │
│ - Tools can override pricing (custom negotiations)     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 3.4 Key Management Strategy

**Recommendation: Hot Wallet (Platform-Controlled) for Payments**

```
┌──────────────────────────────────────────────────────────────┐
│                  KEY MANAGEMENT ARCHITECTURE                  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ PAYMENT RECEIVING WALLET (Hot Wallet)                       │
│ ├─ Type: Platform-controlled hot wallet                     │
│ ├─ Storage: AWS KMS encrypted, vault.conf                  │
│ ├─ Purpose: Receives incoming user payments                │
│ ├─ Security: Limited funds ($1K-$10K per day max)          │
│ ├─ Rotation: Keys rotated daily via CI/CD                  │
│ ├─ Address: env var POLYGON_PAYMENT_WALLET                │
│ └─ Monitoring: Real-time balance alerts                   │
│                                                              │
│ SETTLEMENT WALLET (Cold Storage)                            │
│ ├─ Type: Hardware wallet (Ledger/Trezor)                   │
│ ├─ Purpose: Daily settlement from hot → cold               │
│ ├─ Security: Offline signing, multi-sig approval            │
│ ├─ Recovery: Redundant backup seeds in safe                │
│ └─ Access: Only via manual approval + SSH key              │
│                                                              │
│ REFUND WALLET (Hot Wallet)                                  │
│ ├─ Type: Auto-refund wallet for failed txs                 │
│ ├─ Purpose: Sends refunds to users                         │
│ ├─ Security: Separate keys from payment wallet             │
│ └─ Rotation: Same as payment wallet (daily)                │
│                                                              │
│ PAYMENT FLOW:                                               │
│ User Payment                                                │
│   ↓                                                          │
│ PAYMENT_WALLET receives funds (hot)                        │
│   ↓                                                          │
│ Nightly batch job transfers funds                          │
│   ↓                                                          │
│ SETTLEMENT_WALLET receives funds (cold storage)            │
│   ↓                                                          │
│ Monthly manual withdrawal to primary account               │
│                                                              │
│ REFUND FLOW:                                                │
│ Tool execution fails                                        │
│   ↓                                                          │
│ RefundService initiates refund                             │
│   ↓                                                          │
│ REFUND_WALLET sends transaction                            │
│   ↓                                                          │
│ User receives refund in ~15-30 seconds                      │
│                                                              │
│ SECURITY MEASURES:                                          │
│ ✅ Private keys never in code/logs                          │
│ ✅ Keys stored in AWS KMS or Hashicorp Vault               │
│ ✅ Daily key rotation via automated scripts                │
│ ✅ Rate limiting on wallet transfers                        │
│ ✅ Separate keys for each function                         │
│ ✅ Multi-sig approval for large transfers                  │
│ ✅ Audit log of all wallet transactions                    │
│ ✅ Anomaly detection & alerting                            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 3.5 Settlement Schedule

**Recommended: Daily Batch Settlement**

```
SETTLEMENT SCHEDULE
└─ Daily Cycle
   ├─ 23:59 UTC: Batch collection starts
   ├─ 00:00 UTC: Summary report generated
   │   ├─ Total payments received
   │   ├─ Total refunds processed
   │   ├─ Net settlement amount
   │   └─ Outstanding transactions
   ├─ 00:05 UTC: Settlement transaction submitted
   │   ├─ Hot wallet → Cold wallet transfer
   │   ├─ Gas price optimization (off-peak)
   │   └─ Transaction hash logged
   ├─ 00:15 UTC: Confirmation monitoring starts
   │   ├─ Poll transaction status every 5 seconds
   │   ├─ Alert if not confirmed after 5 minutes
   │   └─ Retry with higher gas if needed
   ├─ 00:30 UTC: Settlement confirmed
   │   ├─ Update ledger with final amounts
   │   ├─ Generate settlement report
   │   └─ Archive transaction details
   └─ Weekly: Manual review & reconciliation

PAYMENT TIMEOUTS
└─ User initiates payment → Receives challenge
   ├─ Deadline: Challenge valid for 15 minutes
   ├─ After 15 min: Challenge expires, user must retry
   ├─ Implementation: challenge.deadline = now + 15min
   └─ Validation: timestamp(now) < deadline

ESCROW HOLD PERIOD
└─ Payment confirmed on blockchain
   ├─ Initial: In escrow (user can dispute)
   ├─ After 12 blocks: Move to settlement
   ├─ ~3 minutes on Polygon (1-block/2s)
   └─ After settlement: Release to platform
```

---

## 4. Service Architecture

### 4.1 X402PaymentService (Core)

```typescript
// Primary responsibility: Orchestrate payment flow
class X402PaymentService {
  // Generate payment challenge
  async createPaymentChallenge(
    invokeId: string,
    toolId: string,
    userId: string
  ): Promise<PaymentChallenge>
  
  // Validate payment against challenge
  async validatePaymentTransaction(
    invokeId: string,
    txHash: string
  ): Promise<PaymentValidationResult>
  
  // Check if payment is valid & sufficient
  async isPaymentValid(txHash: string): Promise<boolean>
  
  // Mark payment as used (prevent double-spend)
  async recordPaymentUsage(txHash: string): Promise<void>
  
  // Initialize wallet connection
  async initializeWallet(provider: WalletProvider): Promise<WalletInfo>
  
  // Get wallet balance
  async getWalletBalance(address: string): Promise<string>
}
```

### 4.2 PaymentVerificationService (Verification)

```typescript
// Primary responsibility: Verify transactions on blockchain
class PaymentVerificationService {
  // Query blockchain for transaction
  async getTransaction(txHash: string): Promise<Transaction>
  
  // Verify payment amount is correct
  async verifyPaymentAmount(
    txHash: string,
    expectedAmount: string
  ): Promise<boolean>
  
  // Verify payment recipient is correct
  async verifyPaymentRecipient(
    txHash: string,
    expectedAddress: string
  ): Promise<boolean>
  
  // Check double-spend (payment used multiple times)
  async checkDoubleSpend(txHash: string): Promise<boolean>
  
  // Wait for transaction confirmation
  async waitForConfirmation(
    txHash: string,
    blockCount: number
  ): Promise<void>
}
```

### 4.3 RefundService (Refunds)

```typescript
// Primary responsibility: Handle failed invocations & refunds
class RefundService {
  // Create refund transaction
  async initiateRefund(
    originalTxHash: string,
    userAddress: string,
    amount: string,
    reason: string
  ): Promise<RefundTransaction>
  
  // Track refund status
  async getRefundStatus(refundTxHash: string): Promise<RefundStatus>
  
  // Automatic refund on tool failure
  async autoRefundOnFailure(
    invokeId: string,
    toolError: Error
  ): Promise<void>
  
  // Cancel payment if timeout occurs
  async cancelPaymentOnTimeout(invokeId: string): Promise<void>
}
```

### 4.4 EscrowService (Settlement)

```typescript
// Primary responsibility: Manage escrow & settlement
class EscrowService {
  // Record payment in escrow
  async holdInEscrow(
    paymentId: string,
    amount: string,
    userAddress: string
  ): Promise<EscrowRecord>
  
  // Release from escrow after confirmation
  async releaseFromEscrow(paymentId: string): Promise<void>
  
  // Batch settlement processing
  async batchSettlement(): Promise<SettlementReport>
  
  // Calculate fees & commissions
  async calculateFees(grossAmount: string): Promise<FeeBreakdown>
  
  // Generate settlement reports
  async getSettlementHistory(days: number): Promise<SettlementReport[]>
}
```

---

## 5. Implementation Phases

### Phase 5.1: Payment Service Core (Estimated: 6-8 hours)
- [ ] X402PaymentService skeleton & payment challenge generation
- [ ] MetaMask integration & wallet connection
- [ ] Basic payment validation (amount, recipient)
- [ ] Unit tests for payment logic

### Phase 5.2: Blockchain Verification (Estimated: 4-5 hours)
- [ ] PaymentVerificationService with blockchain queries
- [ ] Web3.js integration for transaction verification
- [ ] Double-spend detection
- [ ] Integration tests with test blockchain

### Phase 5.3: Refund & Settlement (Estimated: 4-5 hours)
- [ ] RefundService for failed invocations
- [ ] EscrowService for payment management
- [ ] Daily settlement batch job
- [ ] Refund tracking & reporting

### Phase 5.4: API & Integration (Estimated: 2-3 hours)
- [ ] Payment API routes & endpoints
- [ ] MCP Client integration (payment checks before execution)
- [ ] Error handling for payment failures
- [ ] End-to-end test scenarios

---

## 6. Security Considerations

### 6.1 Transaction Verification Checklist

```
Before accepting any payment:
  ✅ Transaction hash exists on blockchain
  ✅ Transaction is not a pending/failed status
  ✅ Transaction amount matches expected amount
  ✅ Transaction recipient is platform wallet
  ✅ Transaction sender is user wallet
  ✅ Transaction is not double-spent (recorded in db)
  ✅ Transaction is not too old (not replay attack)
  ✅ Transaction confirms payment intent for invokeId
```

### 6.2 Attack Prevention

| Attack | Prevention |
|--------|-----------|
| Double-spend | Track used txHashes in database, check before accepting |
| Replay attack | Include invokeId in transaction data/signature |
| Front-running | Deadline on challenge (15 min expiration) |
| Wallet draining | Multiple wallets, daily rotation, rate limiting |
| Gas price manipulation | Monitor gas prices, alert on anomalies |

---

## 7. User Experience Flow

```
PAYMENT USER FLOW
├─ User clicks "Invoke Tool" button
├─ UI: Shows estimated cost ($0.000002)
├─ Backend: Validates user authentication
├─ Backend: Creates payment challenge
├─ UI: Displays "Pay with MetaMask" button
├─ User: Clicks "Pay with MetaMask"
├─ MetaMask: Opens payment confirmation window
│  ├─ Shows: To: [Platform Wallet]
│  ├─ Shows: Amount: [Charge Amount]
│  ├─ Shows: Gas Fee: [Estimated Fee]
│  └─ Shows: Total: [Amount + Gas]
├─ User: Reviews and clicks "Confirm" in MetaMask
├─ MetaMask: Submits transaction to blockchain
├─ UI: Shows "Payment processing..."
├─ Backend: Polls blockchain for confirmation
├─ Blockchain: Transaction appears in mempool (~5 sec)
├─ Backend: Verifies payment (amount, recipient)
├─ UI: Updates to "Executing tool..."
├─ Backend: Invokes MCP tool
├─ Backend: Returns tool result
├─ UI: Displays result to user
└─ Complete!

Total Time: ~15-30 seconds (90% blockchain, 10% tool execution)
User Actions: 2 clicks (approve button, confirm payment)
Failed: Auto-refund initiated (10-20 sec refund confirmation)
```

---

## 8. Configuration & Deployment

### Environment Variables

```env
# PAYMENT CONFIGURATION
PAYMENT_ENABLED=true
PAYMENT_NETWORK=polygon
POLYGON_RPC_URL=https://polygon-rpc.com
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/{KEY}

# WALLET CONFIGURATION
POLYGON_PAYMENT_WALLET=0x1234...abcd
POLYGON_REFUND_WALLET=0x5678...efgh
POLYGON_SETTLEMENT_WALLET=0x9012...ijkl
WALLET_PRIVATE_KEY=${aws_kms_decrypt(env:WALLET_KEY)}

# PAYMENT AMOUNTS (in Wei/Gwei)
PAYMENT_TIER_1_AMOUNT=1000000000000000      # 0.001 ETH
PAYMENT_TIER_2_AMOUNT=10000000000000000     # 0.01 ETH
PAYMENT_TIER_3_AMOUNT=100000000000000000    # 0.1 ETH
PAYMENT_TIER_4_AMOUNT=1000000000000000000   # 1 ETH

# SETTLEMENT CONFIGURATION
SETTLEMENT_SCHEDULE=0 0 * * * # Daily at midnight UTC
SETTLEMENT_GAS_LIMIT=21000
SETTLEMENT_GAS_PRICE_MULTIPLIER=1.1

# SECURITY
PAYMENT_CHALLENGE_TIMEOUT=900000 # 15 minutes
PAYMENT_CONFIRMATION_TIMEOUT=300000 # 5 minutes
MAX_TRANSACTION_AGE=604800000 # 7 days (replay attack prevention)

# MONITORING
PAYMENT_ALERT_THRESHOLD=10000 # Alert if wallet < 10k gwei
SETTLEMENT_RETRY_ATTEMPTS=3
SETTLEMENT_RETRY_DELAY=5000 # 5 seconds
```

---

## 9. Testing Strategy

### Unit Tests
- Payment challenge generation & validation
- Amount calculations & tier mapping
- Wallet address validation
- Transaction hash formatting

### Integration Tests
- End-to-end payment flow with mock blockchain
- Settlement batch processing
- Refund transaction creation
- Double-spend detection

### E2E Tests
- Full payment flow in staging environment
- User registration → payment → tool invocation
- Refund on tool failure
- Settlement schedule execution

---

## 10. Monitoring & Alerts

```
MONITORING DASHBOARDS
├─ Payment Volume
│  ├─ Total payments received (24h)
│  ├─ Average payment amount
│  └─ Success/failure rate
├─ Settlement Status
│  ├─ Pending settlements
│  ├─ Successfully processed
│  └─ Failed/retry settlements
├─ Wallet Health
│  ├─ Payment wallet balance
│  ├─ Recent transaction history
│  └─ Gas price trends
├─ Refunds
│  ├─ Total refunds issued
│  ├─ Average refund time
│  └─ Top refund reasons
└─ Errors
   ├─ Payment verification failures
   ├─ Double-spend detections
   └─ Settlement timeouts

ALERTING RULES
├─ 🔴 CRITICAL
│  ├─ Wallet balance < threshold
│  ├─ Settlement job failed
│  └─ Blockchain RPC down
├─ 🟠 WARNING
│  ├─ Unusual payment volume spike
│  ├─ High refund rate (>5%)
│  └─ Slow transaction confirmations
└─ 🟡 INFO
   ├─ Daily settlement complete
   ├─ Payment tier adjustments
   └─ Maintenance scheduled
```

---

## 11. Decision Points for Implementation Team

### ✅ APPROVED (Design Phase)
- [x] Multi-tier pricing strategy (1G-1000G)
- [x] Daily batch settlement schedule
- [x] Polygon + Ethereum networks
- [x] MetaMask + WalletConnect integration
- [x] Hot wallet + Cold storage architecture

### ⏳ PENDING DECISION (Before Implementation)
- [ ] **Commission Structure**: What % of payments does platform retain?
  - Options: 1% (platform min), 5% (industry avg), 10% (premium)
- [ ] **Escrow Hold Duration**: How long before payments settle?
  - Options: 3 min (12 blocks on Polygon), 15 min, 1 hour
- [ ] **Refund Gas Coverage**: Who pays for refund transactions?
  - Options: Platform covers, Split 50/50, User pays
- [ ] **Multi-Chain Support**: Support Ethereum from day 1?
  - Options: Polygon only → Add Ethereum later, Support both from start
- [ ] **Dispute Resolution**: How to handle payment disputes?
  - Options: Auto-refund, Manual review, Escrow arbitration

---

## Next Steps

1. **Review & Approval**: Present this architecture to team
2. **Answer Decision Points**: Finalize above decisions
3. **Begin Implementation**: Start Phase 5.1 (Payment Service Core)
4. **Staging Deployment**: Test with Mumbai testnet (Polygon testnet)
5. **Mainnet Launch**: Deploy to Polygon mainnet with limits

---

## References

- [HTTP 402 Payment Required Spec](https://en.wikipedia.org/wiki/HTTP_402)
- [Polygon Documentation](https://docs.polygon.technology/)
- [MetaMask Developer Docs](https://docs.metamask.io/)
- [Web3.js Documentation](https://web3js.readthedocs.io/)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
