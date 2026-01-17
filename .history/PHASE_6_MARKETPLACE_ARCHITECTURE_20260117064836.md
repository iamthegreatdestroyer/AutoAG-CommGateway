# Phase 6: MCP Server Marketplace Architecture

**Version**: 1.0  
**Date**: January 17, 2026  
**Status**: 🚧 IN PROGRESS  
**Target Duration**: 18-22 hours  
**Autonomy Level**: 95% autonomous

---

## Executive Summary

Phase 6 introduces the **MCP Server Marketplace** - a comprehensive discovery, listing, rating, and monetization platform for Model Context Protocol servers. This phase transforms AutoAG-CommGateway from a simple invocation layer into a full marketplace ecosystem enabling:

- **Server Discovery**: Search and browse thousands of MCP servers by category, rating, and features
- **Quality Assurance**: Community-driven ratings and reviews for tools and servers
- **Revenue Distribution**: Automated commission tracking and payment distribution
- **Developer Ecosystem**: Tools for server publishers to list, monitor, and monetize their offerings

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    MCP SERVER MARKETPLACE                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐  │
│  │  Server        │  │  Rating &      │  │  Commission      │  │
│  │  Registry      │  │  Review        │  │  Distribution    │  │
│  │                │  │                │  │                  │  │
│  │ • Registration │  │ • Star ratings │  │ • Fee tracking   │  │
│  │ • Metadata     │  │ • Reviews      │  │ • Revenue split  │  │
│  │ • Discovery    │  │ • Reputation   │  │ • Affiliate sys  │  │
│  │ • Search       │  │ • Moderation   │  │ • Payouts        │  │
│  └────────────────┘  └────────────────┘  └──────────────────┘  │
│           │                   │                    │             │
│           └───────────────────┴────────────────────┘             │
│                              │                                   │
│  ┌────────────────────────────┴──────────────────────────────┐  │
│  │          Marketplace API Controller                        │  │
│  │                                                            │  │
│  │  GET /marketplace/servers     - Browse servers           │  │
│  │  POST /marketplace/servers    - Register server          │  │
│  │  GET /marketplace/servers/:id - Server details           │  │
│  │  GET /marketplace/search      - Search & filter          │  │
│  │  POST /marketplace/ratings    - Submit rating            │  │
│  │  GET /marketplace/top         - Top rated servers        │  │
│  │  GET /marketplace/trending    - Trending servers         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌──────────────────────────────────────────┐
        │     Integration with Phase 4 & 5        │
        │                                          │
        │  Tool Invocation ─────► Commission      │
        │  Payment Success ─────► Distribution    │
        │  Server Stats ─────────► Ratings        │
        └──────────────────────────────────────────┘
```

---

## Core Services

### 1. ServerRegistryService

**File**: `src/services/marketplace/server-registry.service.ts`  
**Lines**: ~800  
**Purpose**: MCP server registration, metadata management, and discovery

#### Responsibilities
- Register new MCP servers with comprehensive metadata
- Manage server status (active, suspended, deprecated)
- Track server statistics (invocations, revenue, uptime)
- Provide search and filter capabilities
- Categorize servers by domain (AI, data, productivity, etc.)
- Validate server endpoints and capabilities
- Handle server versioning and updates

#### Key Interfaces

```typescript
interface MCPServer {
  id: string;                    // UUID
  name: string;                  // Display name
  description: string;           // Full description
  publisherId: string;           // Owner/publisher ID
  endpoint: string;              // MCP server endpoint URL
  status: ServerStatus;          // active | suspended | deprecated
  category: ServerCategory;      // Primary category
  tags: string[];                // Searchable tags
  tools: ToolMetadata[];         // Available tools
  pricing: PricingInfo;          // Pricing tiers
  statistics: ServerStatistics;   // Usage stats
  createdAt: Date;
  updatedAt: Date;
}

enum ServerStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DEPRECATED = 'deprecated',
  PENDING_REVIEW = 'pending_review'
}

enum ServerCategory {
  AI_MODELS = 'ai_models',
  DATA_PROCESSING = 'data_processing',
  WEB_AUTOMATION = 'web_automation',
  FILE_OPERATIONS = 'file_operations',
  API_INTEGRATION = 'api_integration',
  PRODUCTIVITY = 'productivity',
  COMMUNICATION = 'communication',
  DEVELOPER_TOOLS = 'developer_tools',
  FINANCE = 'finance',
  OTHER = 'other'
}

interface ToolMetadata {
  name: string;
  description: string;
  inputSchema: object;           // JSON Schema
  outputSchema: object;          // JSON Schema
  averageLatency: number;        // ms
  successRate: number;           // 0-1
  totalInvocations: number;
}

interface PricingInfo {
  defaultTier: PaymentTier;      // From Phase 5
  customPricing: boolean;        // Allow per-tool pricing
  freeTrialInvocations: number;  // Free calls before payment
  subscriptionAvailable: boolean;
}

interface ServerStatistics {
  totalInvocations: number;
  totalRevenue: number;          // In Gwei
  averageRating: number;         // 0-5
  totalReviews: number;
  activeUsers: number;
  uptimePercentage: number;      // 0-100
  lastHealthCheck: Date;
}
```

#### Public Methods

```typescript
class ServerRegistryService {
  // Registration
  registerServer(registration: ServerRegistration): Promise<MCPServer>;
  updateServer(serverId: string, updates: Partial<MCPServer>): Promise<MCPServer>;
  deleteServer(serverId: string, reason: string): Promise<void>;
  
  // Discovery
  searchServers(query: SearchQuery): Promise<SearchResult>;
  getServerById(serverId: string): Promise<MCPServer>;
  getServersByCategory(category: ServerCategory, page: number): Promise<ServerPage>;
  getTrendingServers(timeframe: 'day' | 'week' | 'month'): Promise<MCPServer[]>;
  getTopRatedServers(limit: number): Promise<MCPServer[]>;
  
  // Publisher Management
  getPublisherServers(publisherId: string): Promise<MCPServer[]>;
  getServerStatistics(serverId: string): Promise<ServerStatistics>;
  updateServerStatus(serverId: string, status: ServerStatus): Promise<void>;
  
  // Health & Validation
  validateServerEndpoint(endpoint: string): Promise<ValidationResult>;
  performHealthCheck(serverId: string): Promise<HealthCheckResult>;
  updateServerStatistics(serverId: string): Promise<void>;
}
```

#### Event Emissions

```typescript
// Server Lifecycle Events
'server:registered'      → { serverId, publisherId, name }
'server:updated'         → { serverId, changes }
'server:deleted'         → { serverId, reason }
'server:suspended'       → { serverId, reason }

// Discovery Events
'server:search'          → { query, resultsCount }
'server:viewed'          → { serverId, userId }

// Health Events
'server:health-check'    → { serverId, status, latency }
'server:endpoint-failed' → { serverId, error }
```

#### Configuration

```typescript
// Environment Variables
SERVER_REGISTRY_CACHE_TTL_MINUTES=30
SERVER_HEALTH_CHECK_INTERVAL_MINUTES=15
SERVER_SEARCH_MAX_RESULTS=50
SERVER_TRENDING_WINDOW_DAYS=7
SERVER_REGISTRATION_APPROVAL_REQUIRED=false
```

---

### 2. RatingService

**File**: `src/services/marketplace/rating.service.ts`  
**Lines**: ~700  
**Purpose**: Rating and review system with reputation scoring and moderation

#### Responsibilities
- Accept and store star ratings (1-5 stars)
- Manage text reviews with moderation
- Calculate aggregate ratings and reputation scores
- Detect and prevent rating manipulation
- Support helpful/unhelpful voting on reviews
- Track rating trends over time
- Implement review moderation workflow

#### Key Interfaces

```typescript
interface Rating {
  id: string;                    // UUID
  serverId: string;              // Rated server
  userId: string;                // Rater
  toolName?: string;             // Optional tool-specific rating
  stars: number;                 // 1-5
  review?: string;               // Optional text review
  verified: boolean;             // Paid user who invoked tool
  helpful: number;               // Helpful votes
  unhelpful: number;             // Unhelpful votes
  status: ReviewStatus;          // published | flagged | removed
  createdAt: Date;
  updatedAt: Date;
}

enum ReviewStatus {
  PENDING = 'pending',           // Awaiting moderation
  PUBLISHED = 'published',       // Live on marketplace
  FLAGGED = 'flagged',           // Flagged for review
  REMOVED = 'removed'            // Removed by moderator
}

interface ReputationScore {
  serverId: string;
  overallRating: number;         // Weighted average 0-5
  totalRatings: number;
  ratingDistribution: {          // Histogram
    5: number;
    4: number;
    3: number;
    2: number;
    1: number;
  };
  verifiedRatingsPercentage: number;
  recentTrend: 'improving' | 'stable' | 'declining';
  trustScore: number;            // 0-100 (fraud detection)
}

interface RatingSubmission {
  serverId: string;
  userId: string;
  toolName?: string;
  stars: number;
  review?: string;
  invokeId?: string;             // Link to actual invocation
}

interface ReviewVote {
  ratingId: string;
  userId: string;
  helpful: boolean;              // true = helpful, false = unhelpful
}
```

#### Public Methods

```typescript
class RatingService {
  // Rating Submission
  submitRating(submission: RatingSubmission): Promise<Rating>;
  updateRating(ratingId: string, updates: Partial<Rating>): Promise<Rating>;
  deleteRating(ratingId: string, userId: string): Promise<void>;
  
  // Rating Retrieval
  getServerRatings(serverId: string, options: PaginationOptions): Promise<RatingPage>;
  getToolRatings(serverId: string, toolName: string): Promise<Rating[]>;
  getUserRatings(userId: string): Promise<Rating[]>;
  getRatingById(ratingId: string): Promise<Rating>;
  
  // Reputation & Analytics
  getReputationScore(serverId: string): Promise<ReputationScore>;
  calculateWeightedRating(serverId: string): Promise<number>;
  detectRatingManipulation(serverId: string): Promise<ManipulationReport>;
  getRatingTrends(serverId: string, days: number): Promise<TrendData>;
  
  // Review Moderation
  flagReview(ratingId: string, reason: string): Promise<void>;
  moderateReview(ratingId: string, action: 'approve' | 'remove'): Promise<void>;
  getPendingReviews(): Promise<Rating[]>;
  
  // Voting
  voteOnReview(vote: ReviewVote): Promise<void>;
  getTopReviews(serverId: string, limit: number): Promise<Rating[]>;
}
```

#### Event Emissions

```typescript
// Rating Events
'rating:submitted'       → { ratingId, serverId, stars }
'rating:updated'         → { ratingId, changes }
'rating:deleted'         → { ratingId, serverId }

// Review Events
'review:published'       → { ratingId, serverId }
'review:flagged'         → { ratingId, reason }
'review:moderated'       → { ratingId, action }

// Reputation Events
'reputation:updated'     → { serverId, newScore, oldScore }
'reputation:threshold'   → { serverId, threshold, value }

// Fraud Detection
'rating:manipulation-detected' → { serverId, evidence }
```

#### Configuration

```typescript
// Environment Variables
RATING_MIN_VERIFIED_PERCENTAGE=20
RATING_FRAUD_DETECTION_ENABLED=true
RATING_MODERATION_AUTO_APPROVE=false
RATING_REVIEW_MAX_LENGTH=1000
RATING_CACHE_TTL_MINUTES=10
```

---

### 3. CommissionService

**File**: `src/services/marketplace/commission.service.ts`  
**Lines**: ~750  
**Purpose**: Marketplace fee tracking, revenue distribution, and affiliate management

#### Responsibilities
- Calculate platform commission on tool invocations
- Track revenue per server and publisher
- Manage revenue distribution schedules
- Support affiliate/referral programs
- Generate revenue reports and analytics
- Handle commission disputes and adjustments
- Integrate with Phase 5 payment system

#### Key Interfaces

```typescript
interface CommissionConfig {
  platformFeePercentage: number;  // e.g., 15%
  publisherPercentage: number;    // e.g., 80%
  affiliatePercentage: number;    // e.g., 5%
  minimumPayoutAmount: number;    // In Gwei
  payoutSchedule: 'weekly' | 'monthly';
  payoutDay: number;              // Day of week/month
}

interface CommissionRecord {
  id: string;                     // UUID
  invokeId: string;               // Link to tool invocation
  serverId: string;
  publisherId: string;
  affiliateId?: string;           // Optional referrer
  grossAmount: number;            // Total payment in Gwei
  platformFee: number;            // Platform commission
  publisherRevenue: number;       // To publisher
  affiliateRevenue: number;       // To affiliate (if any)
  status: CommissionStatus;
  paidOut: boolean;
  payoutBatchId?: string;
  createdAt: Date;
}

enum CommissionStatus {
  PENDING = 'pending',            // Payment not yet confirmed
  CONFIRMED = 'confirmed',        // Payment confirmed, awaiting payout
  PAID = 'paid',                  // Paid to publisher
  DISPUTED = 'disputed',          // Under dispute
  REVERSED = 'reversed'           // Refunded/reversed
}

interface RevenueReport {
  publisherId: string;
  period: ReportPeriod;
  totalRevenue: number;           // Total earned
  platformFees: number;           // Fees paid to platform
  netRevenue: number;             // Net after fees
  invocationCount: number;
  topServers: TopServerRevenue[];
  payoutsPending: number;
  payoutsCompleted: number;
}

interface PayoutBatch {
  id: string;                     // UUID
  publisherId: string;
  amount: number;                 // Total payout amount
  commissionRecords: string[];    // Record IDs included
  status: 'pending' | 'processing' | 'completed' | 'failed';
  transactionHash?: string;       // Blockchain tx hash
  scheduledDate: Date;
  completedDate?: Date;
  error?: string;
}

interface AffiliateLink {
  id: string;                     // UUID
  affiliateId: string;            // Referrer user ID
  serverId: string;               // Promoted server
  code: string;                   // Unique referral code
  clickCount: number;
  conversionCount: number;        // Successful sign-ups/purchases
  revenueGenerated: number;       // Total revenue from referrals
  commissionEarned: number;       // Affiliate's cut
  createdAt: Date;
}
```

#### Public Methods

```typescript
class CommissionService {
  // Commission Tracking
  recordCommission(invokeId: string, paymentAmount: number): Promise<CommissionRecord>;
  updateCommissionStatus(commissionId: string, status: CommissionStatus): Promise<void>;
  getCommissionRecord(commissionId: string): Promise<CommissionRecord>;
  getServerCommissions(serverId: string, period: ReportPeriod): Promise<CommissionRecord[]>;
  
  // Revenue Distribution
  calculateCommissionBreakdown(amount: number, config?: CommissionConfig): CommissionBreakdown;
  schedulePayouts(): Promise<PayoutBatch[]>;
  processPayoutBatch(batchId: string): Promise<PayoutResult>;
  getPublisherRevenue(publisherId: string, period: ReportPeriod): Promise<RevenueReport>;
  
  // Affiliate Management
  createAffiliateLink(affiliateId: string, serverId: string): Promise<AffiliateLink>;
  trackAffiliateClick(code: string): Promise<void>;
  recordAffiliateConversion(code: string, userId: string): Promise<void>;
  getAffiliateStats(affiliateId: string): Promise<AffiliateStats>;
  
  // Reporting & Analytics
  generateRevenueReport(publisherId: string, period: ReportPeriod): Promise<RevenueReport>;
  getPlatformRevenue(period: ReportPeriod): Promise<PlatformRevenueReport>;
  getTopEarningServers(limit: number, period: ReportPeriod): Promise<ServerRevenue[]>;
  
  // Dispute Management
  disputeCommission(commissionId: string, reason: string): Promise<void>;
  resolveDispute(commissionId: string, resolution: DisputeResolution): Promise<void>;
}
```

#### Event Emissions

```typescript
// Commission Events
'commission:recorded'      → { commissionId, serverId, amount }
'commission:confirmed'     → { commissionId, publisherId }
'commission:disputed'      → { commissionId, reason }

// Payout Events
'payout:scheduled'         → { batchId, publisherId, amount }
'payout:processing'        → { batchId, transactionHash }
'payout:completed'         → { batchId, publisherId, amount }
'payout:failed'            → { batchId, error }

// Affiliate Events
'affiliate:link-created'   → { linkId, serverId, affiliateId }
'affiliate:click'          → { code, serverId }
'affiliate:conversion'     → { code, userId, serverId }
'affiliate:commission'     → { affiliateId, amount }

// Platform Events
'platform:revenue-milestone' → { milestone, totalRevenue }
```

#### Configuration

```typescript
// Environment Variables
COMMISSION_PLATFORM_FEE_PERCENTAGE=15
COMMISSION_PUBLISHER_PERCENTAGE=80
COMMISSION_AFFILIATE_PERCENTAGE=5
COMMISSION_MIN_PAYOUT_GWEI=100000
COMMISSION_PAYOUT_SCHEDULE=monthly
COMMISSION_PAYOUT_DAY=1
COMMISSION_AUTO_PAYOUT_ENABLED=false
```

---

## API Endpoints

### MarketplaceController

**File**: `src/api/controllers/marketplace.controller.ts`  
**Lines**: ~500  

#### Server Discovery & Registration

```typescript
// Browse all servers
GET /api/v1/marketplace/servers
Query Parameters:
  - category?: ServerCategory
  - page?: number (default: 1)
  - limit?: number (default: 20)
  - sort?: 'rating' | 'popular' | 'newest' (default: 'rating')
Response: ServerPage

// Register new server
POST /api/v1/marketplace/servers
Body: ServerRegistration
Response: MCPServer (201 Created)

// Get server details
GET /api/v1/marketplace/servers/:id
Response: MCPServer

// Update server
PUT /api/v1/marketplace/servers/:id
Body: Partial<MCPServer>
Response: MCPServer

// Delete server
DELETE /api/v1/marketplace/servers/:id
Response: 204 No Content

// Get publisher's servers
GET /api/v1/marketplace/publishers/:id/servers
Response: MCPServer[]
```

#### Search & Discovery

```typescript
// Search servers
GET /api/v1/marketplace/search
Query Parameters:
  - q: string (search query)
  - category?: ServerCategory
  - minRating?: number (1-5)
  - tags?: string[] (comma-separated)
  - page?: number
Response: SearchResult

// Get trending servers
GET /api/v1/marketplace/trending
Query Parameters:
  - timeframe?: 'day' | 'week' | 'month' (default: 'week')
  - limit?: number (default: 10)
Response: MCPServer[]

// Get top rated servers
GET /api/v1/marketplace/top
Query Parameters:
  - category?: ServerCategory
  - limit?: number (default: 10)
Response: MCPServer[]

// Get server by category
GET /api/v1/marketplace/categories/:category
Query Parameters:
  - page?: number
  - limit?: number
Response: ServerPage
```

#### Ratings & Reviews

```typescript
// Submit rating
POST /api/v1/marketplace/ratings
Body: RatingSubmission
Response: Rating (201 Created)

// Get server ratings
GET /api/v1/marketplace/servers/:id/ratings
Query Parameters:
  - page?: number
  - limit?: number
  - sort?: 'helpful' | 'recent' (default: 'helpful')
Response: RatingPage

// Get reputation score
GET /api/v1/marketplace/servers/:id/reputation
Response: ReputationScore

// Update rating
PUT /api/v1/marketplace/ratings/:id
Body: Partial<Rating>
Response: Rating

// Delete rating
DELETE /api/v1/marketplace/ratings/:id
Response: 204 No Content

// Vote on review
POST /api/v1/marketplace/ratings/:id/vote
Body: { helpful: boolean }
Response: 204 No Content

// Flag review
POST /api/v1/marketplace/ratings/:id/flag
Body: { reason: string }
Response: 204 No Content
```

#### Revenue & Commission

```typescript
// Get publisher revenue
GET /api/v1/marketplace/publishers/:id/revenue
Query Parameters:
  - period?: 'week' | 'month' | 'year'
  - startDate?: ISO8601
  - endDate?: ISO8601
Response: RevenueReport

// Get commission details
GET /api/v1/marketplace/commissions/:id
Response: CommissionRecord

// Get server commissions
GET /api/v1/marketplace/servers/:id/commissions
Query Parameters:
  - period?: 'week' | 'month' | 'year'
Response: CommissionRecord[]

// Schedule payout
POST /api/v1/marketplace/publishers/:id/payout
Response: PayoutBatch (201 Created)

// Get payout history
GET /api/v1/marketplace/publishers/:id/payouts
Response: PayoutBatch[]

// Create affiliate link
POST /api/v1/marketplace/affiliate/links
Body: { serverId: string }
Response: AffiliateLink (201 Created)

// Get affiliate stats
GET /api/v1/marketplace/affiliate/stats
Response: AffiliateStats
```

#### Statistics & Analytics

```typescript
// Get server statistics
GET /api/v1/marketplace/servers/:id/stats
Response: ServerStatistics

// Get marketplace overview
GET /api/v1/marketplace/stats
Response: MarketplaceStats

// Get platform revenue
GET /api/v1/marketplace/platform/revenue
Query Parameters:
  - period?: 'week' | 'month' | 'year'
Response: PlatformRevenueReport
```

---

## Integration Points

### Phase 4 Integration (Tool Invocation)

```typescript
// In ToolInvocationService
async invokeTool(request: ToolInvokeRequest): Promise<ToolInvokeResponse> {
  // ... existing invocation logic ...
  
  // NEW: Update server statistics
  await serverRegistryService.updateServerStatistics(serverId);
  
  // Emit event for marketplace tracking
  this.emit('tool:invoked', {
    serverId,
    toolName: request.tool,
    userId: request.userId,
    success: response.success
  });
  
  return response;
}
```

### Phase 5 Integration (Payment System)

```typescript
// In EscrowService
async releaseFromEscrow(escrowId: string): Promise<void> {
  const escrow = await this.getEscrow(escrowId);
  
  // ... existing release logic ...
  
  // NEW: Record commission
  await commissionService.recordCommission(
    escrow.invokeId,
    escrow.amount
  );
  
  this.emit('escrow:released-with-commission', {
    escrowId,
    serverId: escrow.serverId,
    amount: escrow.amount
  });
}
```

---

## Database Schema Extensions

### New Tables

```sql
-- MCP Servers
CREATE TABLE mcp_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  publisher_id UUID NOT NULL,
  endpoint VARCHAR(500) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  category VARCHAR(100) NOT NULL,
  tags TEXT[] DEFAULT '{}',
  pricing_info JSONB NOT NULL DEFAULT '{}',
  statistics JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (publisher_id) REFERENCES users(id)
);

CREATE INDEX idx_servers_category ON mcp_servers(category);
CREATE INDEX idx_servers_status ON mcp_servers(status);
CREATE INDEX idx_servers_publisher ON mcp_servers(publisher_id);
CREATE INDEX idx_servers_tags ON mcp_servers USING GIN(tags);

-- Server Tools
CREATE TABLE server_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  input_schema JSONB,
  output_schema JSONB,
  statistics JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
);

CREATE INDEX idx_server_tools_server ON server_tools(server_id);

-- Ratings & Reviews
CREATE TABLE ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL,
  user_id UUID NOT NULL,
  tool_name VARCHAR(255),
  stars INTEGER NOT NULL CHECK (stars >= 1 AND stars <= 5),
  review TEXT,
  verified BOOLEAN DEFAULT false,
  helpful INTEGER DEFAULT 0,
  unhelpful INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'published',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE (server_id, user_id, tool_name)
);

CREATE INDEX idx_ratings_server ON ratings(server_id);
CREATE INDEX idx_ratings_user ON ratings(user_id);
CREATE INDEX idx_ratings_status ON ratings(status);

-- Review Votes
CREATE TABLE review_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rating_id UUID NOT NULL,
  user_id UUID NOT NULL,
  helpful BOOLEAN NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (rating_id) REFERENCES ratings(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE (rating_id, user_id)
);

-- Commission Records
CREATE TABLE commission_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoke_id UUID NOT NULL,
  server_id UUID NOT NULL,
  publisher_id UUID NOT NULL,
  affiliate_id UUID,
  gross_amount BIGINT NOT NULL,
  platform_fee BIGINT NOT NULL,
  publisher_revenue BIGINT NOT NULL,
  affiliate_revenue BIGINT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending',
  paid_out BOOLEAN DEFAULT false,
  payout_batch_id UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (server_id) REFERENCES mcp_servers(id),
  FOREIGN KEY (publisher_id) REFERENCES users(id),
  FOREIGN KEY (affiliate_id) REFERENCES users(id)
);

CREATE INDEX idx_commissions_server ON commission_records(server_id);
CREATE INDEX idx_commissions_publisher ON commission_records(publisher_id);
CREATE INDEX idx_commissions_status ON commission_records(status);
CREATE INDEX idx_commissions_payout_batch ON commission_records(payout_batch_id);

-- Payout Batches
CREATE TABLE payout_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id UUID NOT NULL,
  amount BIGINT NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  transaction_hash VARCHAR(66),
  scheduled_date TIMESTAMP NOT NULL,
  completed_date TIMESTAMP,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (publisher_id) REFERENCES users(id)
);

CREATE INDEX idx_payout_batches_publisher ON payout_batches(publisher_id);
CREATE INDEX idx_payout_batches_status ON payout_batches(status);

-- Affiliate Links
CREATE TABLE affiliate_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL,
  server_id UUID NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  click_count INTEGER DEFAULT 0,
  conversion_count INTEGER DEFAULT 0,
  revenue_generated BIGINT DEFAULT 0,
  commission_earned BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (affiliate_id) REFERENCES users(id),
  FOREIGN KEY (server_id) REFERENCES mcp_servers(id)
);

CREATE INDEX idx_affiliate_links_code ON affiliate_links(code);
CREATE INDEX idx_affiliate_links_affiliate ON affiliate_links(affiliate_id);
CREATE INDEX idx_affiliate_links_server ON affiliate_links(server_id);
```

---

## Event System

### New Event Types (25+)

**Server Registry Events** (8):
- `server:registered`
- `server:updated`
- `server:deleted`
- `server:suspended`
- `server:search`
- `server:viewed`
- `server:health-check`
- `server:endpoint-failed`

**Rating & Review Events** (9):
- `rating:submitted`
- `rating:updated`
- `rating:deleted`
- `review:published`
- `review:flagged`
- `review:moderated`
- `reputation:updated`
- `reputation:threshold`
- `rating:manipulation-detected`

**Commission & Payout Events** (8):
- `commission:recorded`
- `commission:confirmed`
- `commission:disputed`
- `payout:scheduled`
- `payout:processing`
- `payout:completed`
- `payout:failed`
- `platform:revenue-milestone`

**Affiliate Events** (4):
- `affiliate:link-created`
- `affiliate:click`
- `affiliate:conversion`
- `affiliate:commission`

---

## Testing Strategy

### Unit Tests (~35 tests)

**ServerRegistryService** (10 tests):
- Server registration with validation
- Server search with filters
- Category filtering
- Trending calculation
- Health check updates

**RatingService** (12 tests):
- Rating submission
- Review text handling
- Reputation score calculation
- Fraud detection
- Review moderation
- Helpful/unhelpful voting

**CommissionService** (13 tests):
- Commission calculation
- Revenue distribution
- Payout batch creation
- Affiliate tracking
- Report generation

### Integration Tests (~25 tests)

**Marketplace API** (10 tests):
- Server registration → listing → search flow
- Rating submission → reputation update
- Commission recording → payout scheduling

**Cross-Service Integration** (8 tests):
- Tool invocation → server stats update
- Payment release → commission recording
- Server search with ratings
- Revenue reporting

**Database Integration** (7 tests):
- Server CRUD operations
- Rating queries with pagination
- Commission aggregation
- Affiliate link resolution

### E2E Tests (~8 tests)

- Publisher registers server → user discovers → rates → commission recorded
- Search → filter → sort → paginate
- Affiliate link → user signup → commission tracking
- Revenue report generation

**Target Coverage**: 92%+ (matching Phase 5 quality)

---

## Security Considerations

### Authorization

- Only publishers can register/update/delete their own servers
- Users must have invoked a tool to leave a verified rating
- Only moderators can approve/remove flagged reviews
- Only publishers can view their revenue details
- Platform revenue data restricted to admin users

### Input Validation

- Server endpoint must be valid HTTPS URL
- Rating stars must be 1-5 integer
- Review text max 1000 characters
- Commission amounts validated against payment records
- Affiliate codes must be unique and URL-safe

### Fraud Prevention

- Detect rating manipulation (sudden spikes, same IP)
- Prevent duplicate ratings from same user
- Validate invokeId exists before accepting verified rating
- Rate limit review submissions (max 5 per day per user)
- Track affiliate conversion fraud (same user/IP)

### Data Privacy

- Do not expose user IDs in public endpoints
- Aggregate statistics only for public display
- Publisher revenue data only visible to owner
- Sanitize error messages in API responses

---

## Performance Optimization

### Caching Strategy

```typescript
// Redis cache keys
`server:${serverId}`                    // 30 min TTL
`server:search:${queryHash}`            // 15 min TTL
`server:trending:${timeframe}`          // 1 hour TTL
`server:top-rated:${category}`          // 1 hour TTL
`reputation:${serverId}`                // 10 min TTL
`revenue:${publisherId}:${period}`      // 5 min TTL
```

### Database Optimization

- Indexed columns: status, category, publisher_id, tags
- Materialized view for trending servers (refresh hourly)
- Aggregate statistics computed asynchronously
- Pagination with cursor-based approach for large result sets

### Rate Limiting

- Server registration: 5 per hour per user
- Rating submission: 10 per hour per user
- Search queries: 100 per minute per user
- Affiliate link creation: 20 per day per user

---

## Deployment Requirements

### Environment Variables (15 new)

```bash
# Server Registry
SERVER_REGISTRY_CACHE_TTL_MINUTES=30
SERVER_HEALTH_CHECK_INTERVAL_MINUTES=15
SERVER_SEARCH_MAX_RESULTS=50
SERVER_TRENDING_WINDOW_DAYS=7
SERVER_REGISTRATION_APPROVAL_REQUIRED=false

# Ratings
RATING_MIN_VERIFIED_PERCENTAGE=20
RATING_FRAUD_DETECTION_ENABLED=true
RATING_MODERATION_AUTO_APPROVE=false
RATING_REVIEW_MAX_LENGTH=1000
RATING_CACHE_TTL_MINUTES=10

# Commissions
COMMISSION_PLATFORM_FEE_PERCENTAGE=15
COMMISSION_PUBLISHER_PERCENTAGE=80
COMMISSION_AFFILIATE_PERCENTAGE=5
COMMISSION_MIN_PAYOUT_GWEI=100000
COMMISSION_PAYOUT_SCHEDULE=monthly
```

### Dependencies

```json
{
  "dependencies": {
    "natural": "^6.0.0",           // Text analysis for reviews
    "compromise": "^14.0.0",       // NLP for search
    "fuzzysort": "^2.0.0"          // Fuzzy search
  }
}
```

---

## Success Metrics

### Phase 6 Completion Criteria

- ✅ 3 core services implemented (800+ lines each)
- ✅ 1 controller with 25+ REST endpoints
- ✅ 25+ event types emitted
- ✅ 60+ tests with 92%+ coverage
- ✅ Database schema extended with 7 tables
- ✅ 15 configuration variables with defaults
- ✅ Integration with Phase 4 & 5
- ✅ Security & fraud prevention implemented
- ✅ Performance optimization with caching
- ✅ Comprehensive API documentation

### Target Metrics

- Server registration: < 200ms p95
- Search queries: < 300ms p95
- Rating submission: < 150ms p95
- Commission calculation: < 50ms p95
- Database queries: < 100ms p95
- Cache hit rate: > 80%
- Test coverage: > 92%

---

## Timeline

**Total Duration**: 18-22 hours

### Day 1 (6-8 hours)
- ✅ Architecture document (this file)
- Implement ServerRegistryService
- Create database schema
- Write unit tests for registry service

### Day 2 (6-7 hours)
- Implement RatingService
- Implement fraud detection
- Write unit tests for rating service
- Integration tests for registry + ratings

### Day 3 (6-7 hours)
- Implement CommissionService
- Integrate with Phase 5 payment system
- Create MarketplaceController
- Write integration and E2E tests
- Performance testing and optimization
- Final documentation

---

## Next Steps

1. ✅ **Phase 6.1**: Implement ServerRegistryService
2. **Phase 6.2**: Implement RatingService
3. **Phase 6.3**: Implement CommissionService
4. **Phase 6.4**: Create MarketplaceController
5. **Phase 6.5**: Write comprehensive tests
6. **Phase 6.6**: Integration with existing services
7. **Phase 6.7**: Documentation and deployment

---

## Appendix: Example Workflows

### Workflow 1: Server Registration

```typescript
// 1. Publisher registers new server
const server = await serverRegistryService.registerServer({
  name: "AI Content Generator",
  description: "GPT-4 powered content generation",
  endpoint: "https://api.example.com/mcp",
  category: ServerCategory.AI_MODELS,
  tags: ["ai", "content", "gpt4"],
  pricing: {
    defaultTier: 'tier-2',
    freeTrialInvocations: 10
  }
});

// 2. System validates endpoint
const validation = await serverRegistryService.validateServerEndpoint(server.endpoint);

// 3. Server appears in marketplace
const results = await serverRegistryService.searchServers({
  query: "content",
  category: ServerCategory.AI_MODELS
});
```

### Workflow 2: Rating & Review

```typescript
// 1. User invokes tool (Phase 4)
const response = await toolInvocationService.invokeTool({
  serverId: 'server-123',
  tool: 'generate_content',
  args: { prompt: "Write article" }
});

// 2. User leaves verified rating
const rating = await ratingService.submitRating({
  serverId: 'server-123',
  userId: 'user-456',
  toolName: 'generate_content',
  stars: 5,
  review: "Excellent results, very fast!",
  invokeId: response.invokeId  // Verified!
});

// 3. Reputation score updated
const reputation = await ratingService.getReputationScore('server-123');
// reputation.overallRating increased, verifiedRatingsPercentage high
```

### Workflow 3: Commission & Payout

```typescript
// 1. Payment released from escrow (Phase 5)
await escrowService.releaseFromEscrow(escrowId);

// 2. Commission automatically recorded
// CommissionService listens to 'escrow:released-with-commission' event
const commission = await commissionService.recordCommission(invokeId, amount);
// Breakdown: 15% platform, 80% publisher, 5% affiliate

// 3. Monthly payout scheduled
const batches = await commissionService.schedulePayouts();
// Groups all confirmed commissions for each publisher

// 4. Payout processed on payout day
const result = await commissionService.processPayoutBatch(batches[0].id);
// Blockchain transaction submitted, publishers receive revenue
```

---

**END OF ARCHITECTURE DOCUMENT**

This document serves as the comprehensive design specification for Phase 6. Implementation will follow this architecture with 95% autonomy, matching the quality standards established in Phase 5.

**Status**: 🚧 Architecture Complete - Ready for Implementation
**Next**: Begin ServerRegistryService implementation
