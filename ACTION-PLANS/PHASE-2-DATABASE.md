# Phase 2: Database Schema & Models

**REF:** P2-004  
**Duration:** 15-18 hours  
**Autonomy Level:** 85% autonomous (requires schema approval)  
**Status:** ⚪ NOT STARTED  
**Dependencies:** Phase 1 must be complete

---

## Objectives

- [ ] Design and implement PostgreSQL schema
- [ ] Create TypeORM/Prisma models
- [ ] Set up migrations
- [ ] Implement seed data
- [ ] Build repository pattern

---

## Task Checklist

### 2.1 Database Schema Design (3 hours) ⚠️ REQUIRES CONSULTATION

#### Schema Planning

- [ ] Design entity relationship diagram
- [ ] Define all tables and relationships
- [ ] Plan indexing strategy
- [ ] Define constraints and cascades
- [ ] Document schema design

**Core Entities:**

```sql
-- MCP Servers
CREATE TABLE mcp_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  base_url VARCHAR(500) NOT NULL,
  protocol_version VARCHAR(10) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',  -- pending, active, inactive, suspended
  metadata JSONB DEFAULT '{}',
  health_check_url VARCHAR(500),
  last_health_check TIMESTAMP,
  health_status VARCHAR(20),  -- healthy, unhealthy, unknown
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID,

  CONSTRAINT chk_status CHECK (status IN ('pending', 'active', 'inactive', 'suspended')),
  CONSTRAINT chk_health CHECK (health_status IN ('healthy', 'unhealthy', 'unknown'))
);

-- Tools offered by MCP servers
CREATE TABLE tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  input_schema JSONB NOT NULL,
  output_schema JSONB,
  pricing_model VARCHAR(50) DEFAULT 'per_invocation',  -- per_invocation, tiered, free
  base_price DECIMAL(10, 4) DEFAULT 0.0000,
  metadata JSONB DEFAULT '{}',
  tags TEXT[],
  category VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(server_id, name),
  CONSTRAINT chk_pricing CHECK (pricing_model IN ('per_invocation', 'tiered', 'subscription', 'free'))
);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  wallet_address VARCHAR(100),
  api_key_hash VARCHAR(255) UNIQUE NOT NULL,
  role VARCHAR(20) DEFAULT 'user',  -- user, premium, admin
  is_active BOOLEAN DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP,

  CONSTRAINT chk_role CHECK (role IN ('user', 'premium', 'admin'))
);

-- Tool Invocations
CREATE TABLE invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  input_hash VARCHAR(64) NOT NULL,  -- SHA-256 hash for privacy
  output_hash VARCHAR(64),
  cost DECIMAL(10, 4) DEFAULT 0.0000,
  duration_ms INTEGER,
  status VARCHAR(20) NOT NULL,  -- pending, success, failed, timeout, refunded
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,

  CONSTRAINT chk_status CHECK (status IN ('pending', 'success', 'failed', 'timeout', 'refunded'))
);

-- Payments
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invocation_id UUID REFERENCES invocations(id) ON DELETE SET NULL,
  amount DECIMAL(10, 4) NOT NULL,
  tx_hash VARCHAR(100),
  status VARCHAR(20) NOT NULL,  -- pending, confirmed, failed, refunded
  payment_method VARCHAR(50) DEFAULT 'x402',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP,

  CONSTRAINT chk_status CHECK (status IN ('pending', 'confirmed', 'failed', 'refunded'))
);

-- Analytics (aggregated daily)
CREATE TABLE analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  invocation_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  total_revenue DECIMAL(10, 4) DEFAULT 0.0000,
  avg_duration_ms INTEGER,
  min_duration_ms INTEGER,
  max_duration_ms INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(tool_id, date)
);
```

#### Indexes

- [ ] Create indexes for performance

```sql
-- MCP Servers
CREATE INDEX idx_mcp_servers_status ON mcp_servers(status);
CREATE INDEX idx_mcp_servers_created_at ON mcp_servers(created_at);

-- Tools
CREATE INDEX idx_tools_server_id ON tools(server_id);
CREATE INDEX idx_tools_category ON tools(category);
CREATE INDEX idx_tools_tags ON tools USING GIN(tags);
CREATE INDEX idx_tools_is_active ON tools(is_active);

-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- Invocations
CREATE INDEX idx_invocations_tool_id ON invocations(tool_id);
CREATE INDEX idx_invocations_user_id ON invocations(user_id);
CREATE INDEX idx_invocations_status ON invocations(status);
CREATE INDEX idx_invocations_created_at ON invocations(created_at);

-- Payments
CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_created_at ON payments(created_at);

-- Analytics
CREATE INDEX idx_analytics_tool_id_date ON analytics(tool_id, date);
CREATE INDEX idx_analytics_date ON analytics(date);
```

---

### 2.2 ORM Setup with Prisma (4 hours)

#### Install Prisma

- [ ] Add Prisma dependencies

```bash
npm install @prisma/client
npm install -D prisma
npx prisma init
```

#### Create Prisma Schema

- [ ] Define `prisma/schema.prisma`
- [ ] Configure PostgreSQL datasource
- [ ] Define all models with relations
- [ ] Add indexes and constraints
- [ ] Configure Prisma Client generator

**prisma/schema.prisma:**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model MCPServer {
  id                String    @id @default(uuid())
  name              String    @unique
  description       String?
  baseUrl           String    @map("base_url")
  protocolVersion   String    @map("protocol_version")
  status            ServerStatus @default(PENDING)
  metadata          Json      @default("{}")
  healthCheckUrl    String?   @map("health_check_url")
  lastHealthCheck   DateTime? @map("last_health_check")
  healthStatus      HealthStatus? @map("health_status")
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")
  createdBy         String?   @map("created_by")

  tools             Tool[]

  @@index([status])
  @@index([createdAt])
  @@map("mcp_servers")
}

model Tool {
  id            String    @id @default(uuid())
  serverId      String    @map("server_id")
  name          String
  description   String?
  inputSchema   Json      @map("input_schema")
  outputSchema  Json?     @map("output_schema")
  pricingModel  PricingModel @default(PER_INVOCATION) @map("pricing_model")
  basePrice     Decimal   @default(0) @map("base_price") @db.Decimal(10, 4)
  metadata      Json      @default("{}")
  tags          String[]
  category      String?
  isActive      Boolean   @default(true) @map("is_active")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  server        MCPServer @relation(fields: [serverId], references: [id], onDelete: Cascade)
  invocations   Invocation[]
  analytics     Analytics[]

  @@unique([serverId, name])
  @@index([serverId])
  @@index([category])
  @@index([isActive])
  @@map("tools")
}

model User {
  id            String    @id @default(uuid())
  email         String    @unique
  walletAddress String?   @map("wallet_address")
  apiKeyHash    String    @unique @map("api_key_hash")
  role          UserRole  @default(USER)
  isActive      Boolean   @default(true) @map("is_active")
  metadata      Json      @default("{}")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")
  lastLogin     DateTime? @map("last_login")

  invocations   Invocation[]
  payments      Payment[]

  @@index([email])
  @@index([role])
  @@map("users")
}

model Invocation {
  id           String    @id @default(uuid())
  toolId       String    @map("tool_id")
  userId       String    @map("user_id")
  inputHash    String    @map("input_hash")
  outputHash   String?   @map("output_hash")
  cost         Decimal   @default(0) @db.Decimal(10, 4)
  durationMs   Int?      @map("duration_ms")
  status       InvocationStatus
  errorMessage String?   @map("error_message")
  metadata     Json      @default("{}")
  createdAt    DateTime  @default(now()) @map("created_at")
  completedAt  DateTime? @map("completed_at")

  tool         Tool      @relation(fields: [toolId], references: [id], onDelete: Cascade)
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  payments     Payment[]

  @@index([toolId])
  @@index([userId])
  @@index([status])
  @@index([createdAt])
  @@map("invocations")
}

model Payment {
  id            String    @id @default(uuid())
  userId        String    @map("user_id")
  invocationId  String?   @map("invocation_id")
  amount        Decimal   @db.Decimal(10, 4)
  txHash        String?   @map("tx_hash")
  status        PaymentStatus
  paymentMethod String    @default("x402") @map("payment_method")
  metadata      Json      @default("{}")
  createdAt     DateTime  @default(now()) @map("created_at")
  confirmedAt   DateTime? @map("confirmed_at")

  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  invocation    Invocation? @relation(fields: [invocationId], references: [id], onDelete: SetNull)

  @@index([userId])
  @@index([status])
  @@index([createdAt])
  @@map("payments")
}

model Analytics {
  id              String   @id @default(uuid())
  toolId          String   @map("tool_id")
  date            DateTime @db.Date
  invocationCount Int      @default(0) @map("invocation_count")
  successCount    Int      @default(0) @map("success_count")
  failureCount    Int      @default(0) @map("failure_count")
  totalRevenue    Decimal  @default(0) @map("total_revenue") @db.Decimal(10, 4)
  avgDurationMs   Int?     @map("avg_duration_ms")
  minDurationMs   Int?     @map("min_duration_ms")
  maxDurationMs   Int?     @map("max_duration_ms")
  createdAt       DateTime @default(now()) @map("created_at")

  tool            Tool     @relation(fields: [toolId], references: [id], onDelete: Cascade)

  @@unique([toolId, date])
  @@index([toolId, date])
  @@index([date])
  @@map("analytics")
}

enum ServerStatus {
  PENDING
  ACTIVE
  INACTIVE
  SUSPENDED
}

enum HealthStatus {
  HEALTHY
  UNHEALTHY
  UNKNOWN
}

enum PricingModel {
  PER_INVOCATION
  TIERED
  SUBSCRIPTION
  FREE
}

enum UserRole {
  USER
  PREMIUM
  ADMIN
}

enum InvocationStatus {
  PENDING
  SUCCESS
  FAILED
  TIMEOUT
  REFUNDED
}

enum PaymentStatus {
  PENDING
  CONFIRMED
  FAILED
  REFUNDED
}
```

#### Generate Prisma Client

- [ ] Run `npx prisma generate`
- [ ] Verify types are generated
- [ ] Test Prisma Client instantiation

---

### 2.3 Database Migrations (2 hours)

#### Initial Migration

- [ ] Create initial migration

```bash
npx prisma migrate dev --name init
```

- [ ] Review generated SQL
- [ ] Test migration up/down
- [ ] Document migration strategy

#### Migration Scripts

- [ ] Create `scripts/migrate-up.sh`
- [ ] Create `scripts/migrate-down.sh`
- [ ] Create `scripts/migrate-reset.sh`

---

### 2.4 Repository Pattern Implementation (4 hours)

#### Base Repository

- [ ] Create `src/models/repositories/BaseRepository.ts`

```typescript
import { PrismaClient } from "@prisma/client";

export abstract class BaseRepository<T> {
  constructor(protected prisma: PrismaClient) {}

  abstract findById(id: string): Promise<T | null>;
  abstract findAll(options?: PaginationOptions): Promise<T[]>;
  abstract create(data: Partial<T>): Promise<T>;
  abstract update(id: string, data: Partial<T>): Promise<T>;
  abstract delete(id: string): Promise<void>;
}

export interface PaginationOptions {
  page?: number;
  limit?: number;
  orderBy?: string;
  order?: "asc" | "desc";
}
```

#### Specific Repositories

- [ ] Create `MCPServerRepository.ts`
- [ ] Create `ToolRepository.ts`
- [ ] Create `UserRepository.ts`
- [ ] Create `InvocationRepository.ts`
- [ ] Create `PaymentRepository.ts`
- [ ] Create `AnalyticsRepository.ts`

**Example - ToolRepository.ts:**

```typescript
import { PrismaClient, Tool, Prisma } from "@prisma/client";
import { BaseRepository, PaginationOptions } from "./BaseRepository";

export class ToolRepository extends BaseRepository<Tool> {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  async findById(id: string): Promise<Tool | null> {
    return this.prisma.tool.findUnique({
      where: { id },
      include: { server: true },
    });
  }

  async findAll(options?: PaginationOptions): Promise<Tool[]> {
    const page = options?.page || 1;
    const limit = options?.limit || 50;
    const skip = (page - 1) * limit;

    return this.prisma.tool.findMany({
      skip,
      take: limit,
      where: { isActive: true },
      include: { server: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async findByCategory(category: string): Promise<Tool[]> {
    return this.prisma.tool.findMany({
      where: {
        category,
        isActive: true,
      },
      include: { server: true },
    });
  }

  async search(query: string): Promise<Tool[]> {
    return this.prisma.tool.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
          { tags: { has: query } },
        ],
        isActive: true,
      },
      include: { server: true },
    });
  }

  async create(data: Prisma.ToolCreateInput): Promise<Tool> {
    return this.prisma.tool.create({
      data,
      include: { server: true },
    });
  }

  async update(id: string, data: Prisma.ToolUpdateInput): Promise<Tool> {
    return this.prisma.tool.update({
      where: { id },
      data,
      include: { server: true },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.tool.delete({ where: { id } });
  }
}
```

---

### 2.5 Seed Data (2 hours)

#### Create Seed Script

- [ ] Create `scripts/seed-db.ts`
- [ ] Generate sample MCP servers (5-10)
- [ ] Generate sample tools (20-30)
- [ ] Generate test users (3-5)
- [ ] Generate development API keys

**seed-db.ts:**

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Create sample MCP servers
  const servers = await Promise.all([
    prisma.mCPServer.create({
      data: {
        name: "DataAnalysis Server",
        description: "Tools for data analysis and visualization",
        baseUrl: "http://localhost:3001",
        protocolVersion: "1.0.0",
        status: "ACTIVE",
        healthStatus: "HEALTHY",
      },
    }),
    // Add more servers...
  ]);

  // Create sample tools
  await Promise.all([
    prisma.tool.create({
      data: {
        serverId: servers[0].id,
        name: "analyze_csv",
        description: "Analyze CSV data and generate insights",
        inputSchema: {
          type: "object",
          properties: { csv: { type: "string" } },
        },
        pricingModel: "PER_INVOCATION",
        basePrice: 0.01,
        category: "data-analysis",
        tags: ["csv", "analysis", "statistics"],
      },
    }),
    // Add more tools...
  ]);

  // Create test users
  await prisma.user.create({
    data: {
      email: "test@example.com",
      apiKeyHash: "hashed_key_here",
      role: "USER",
    },
  });

  console.log("✅ Seeding complete!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

#### Add Seed Script to package.json

```json
{
  "scripts": {
    "db:seed": "ts-node scripts/seed-db.ts",
    "db:reset": "npx prisma migrate reset --force"
  }
}
```

---

### 2.6 Repository Tests (3 hours)

#### Unit Tests for Repositories

- [ ] Test CRUD operations
- [ ] Test custom query methods
- [ ] Test transaction support
- [ ] Test error handling

**Example Test:**

```typescript
import { PrismaClient } from "@prisma/client";
import { ToolRepository } from "@/models/repositories/ToolRepository";

describe("ToolRepository", () => {
  let prisma: PrismaClient;
  let repo: ToolRepository;

  beforeAll(() => {
    prisma = new PrismaClient();
    repo = new ToolRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("findById", () => {
    it("should return tool with server", async () => {
      const tool = await repo.findById("test-id");
      expect(tool).toBeDefined();
      expect(tool?.server).toBeDefined();
    });

    it("should return null for non-existent id", async () => {
      const tool = await repo.findById("non-existent");
      expect(tool).toBeNull();
    });
  });

  // Add more tests...
});
```

---

## Checkpoint 2.1: Human Review Required

### Verification Commands

```bash
# Migration
npm run db:migrate

# Seed
npm run db:seed

# Test
npm run test:integration -- --grep="Repository"

# Prisma Studio (GUI)
npx prisma studio
```

### Expected Outcomes

- ✅ Migrations run without errors
- ✅ All tables created with correct schema
- ✅ Seed data populates successfully
- ✅ Repository tests pass (85%+ coverage)
- ✅ Prisma Client generates without warnings
- ✅ Prisma Studio shows all tables with data

### Human Decision Points

1. **[CRITICAL]** Approve final database schema
2. Review indexing strategy
3. Confirm data retention policies
4. Approve seed data examples

---

## Success Criteria

- [ ] Database schema implemented and migrated
- [ ] Prisma Client generated successfully
- [ ] All repositories implement CRUD operations
- [ ] Test coverage ≥85% for repositories
- [ ] Seed data creates sample records
- [ ] No TypeScript errors
- [ ] Documentation complete

---

## Time Tracking

| Task          | Estimated | Actual | Notes                 |
| ------------- | --------- | ------ | --------------------- |
| Schema Design | 3h        | -      | Includes human review |
| ORM Setup     | 4h        | -      |                       |
| Migrations    | 2h        | -      |                       |
| Repositories  | 4h        | -      |                       |
| Seed Data     | 2h        | -      |                       |
| Testing       | 3h        | -      |                       |
| **Total**     | **18h**   | **-**  |                       |

---

## Notes & Blockers

### Current Blockers

- Awaiting Phase 1 completion
- Requires schema approval before implementation

### Dependencies

- Phase 1 must be complete (database running)

### Future Phases Enabled

Upon completion:

- ✅ Phase 3 (Discovery Engine needs repositories)
- ✅ Phase 4 (Invocation Engine needs repositories)

---

**Status:** ⚪ NOT STARTED  
**Last Updated:** January 13, 2026  
**Next Action:** Complete Phase 1, then seek schema approval
