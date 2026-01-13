# AutoAG-CommGateway Quick Reference Guide

## 🚀 Project Overview

**Mission:** Build a marketplace for MCP (Model Context Protocol) servers with integrated x402 micropayment system  
**Target:** $500-2,000+ monthly recurring revenue  
**Timeline:** 8 phases, 100-150 hours, ~8 weeks  
**Repository:** https://github.com/iamthegreatdestroyer/AutoAG-CommGateway.git

---

## 📦 Port Assignments (18500-18599)

### Core Services

| Service           | Port  | URL                          |
| ----------------- | ----- | ---------------------------- |
| API (Production)  | 18500 | http://localhost:18500       |
| API (Development) | 18501 | http://localhost:18501       |
| PostgreSQL        | 18510 | postgresql://localhost:18510 |
| Redis             | 18520 | redis://localhost:18520      |
| Nginx             | 18530 | http://localhost:18530       |

### Monitoring Stack

| Service          | Port      | URL                    |
| ---------------- | --------- | ---------------------- |
| Prometheus       | 18540     | http://localhost:18540 |
| Grafana          | 18541     | http://localhost:18541 |
| Loki             | 18550     | http://localhost:18550 |
| Jaeger UI        | 18560     | http://localhost:18560 |
| Jaeger Collector | 18561     | http://localhost:18561 |
| Jaeger Agent     | 18562/udp | -                      |

### Development Tools

| Service          | Port  | URL                    |
| ---------------- | ----- | ---------------------- |
| Swagger/API Docs | 18570 | http://localhost:18570 |
| Database Admin   | 18580 | http://localhost:18580 |
| Redis Commander  | 18581 | http://localhost:18581 |
| Mailhog (SMTP)   | 18590 | -                      |
| Mailhog (Web UI) | 18591 | http://localhost:18591 |

---

## 🎯 Quick Start Commands

### Initial Setup

```bash
# Clone repository
git clone https://github.com/iamthegreatdestroyer/AutoAG-CommGateway.git
cd AutoAG-CommGateway

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Start Docker services
cd docker
docker-compose up -d

# Run migrations
npm run db:migrate

# Seed database
npm run db:seed
```

### Development

```bash
# Start development server (with hot reload)
npm run dev

# Run tests
npm test
npm run test:watch
npm run test:coverage

# Linting
npm run lint
npm run lint:fix

# Type checking
npm run type-check
```

### Database Operations

```bash
# Generate Prisma client
npx prisma generate

# Create migration
npx prisma migrate dev --name migration_name

# Reset database
npm run db:reset

# Open Prisma Studio (GUI)
npx prisma studio
```

### Docker Operations

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f api
docker-compose logs -f postgres

# Stop services
docker-compose down

# Rebuild after changes
docker-compose up -d --build
```

---

## 📁 Project Structure

```
AutoAG-CommGateway/
├── ACTION-PLANS/           ✅ Planning documents
│   ├── 00-PORT-ASSIGNMENTS.md
│   ├── 00-MASTER-PROJECT-TRACKER.md
│   ├── PHASE-1-FOUNDATION.md
│   ├── PHASE-2-DATABASE.md
│   └── PHASES-3-8-SUMMARY.md
├── src/                    🔄 Source code (to be created)
│   ├── api/                → Routes, middleware, controllers
│   ├── services/           → Business logic
│   ├── models/             → Database models & repositories
│   ├── types/              → TypeScript type definitions
│   ├── utils/              → Helper functions
│   └── config/             → Configuration
├── tests/                  🔄 Test files (to be created)
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docker/                 🔄 Docker configuration (to be created)
│   ├── Dockerfile.api
│   └── docker-compose.yml
├── scripts/                🔄 Utility scripts (to be created)
├── docs/                   🔄 Documentation (to be created)
└── prisma/                 🔄 Database schema (to be created)
```

---

## 🔑 Key Technologies

### Backend Stack

- **Runtime:** Node.js 20+
- **Language:** TypeScript 5.3+
- **API Framework:** Express 4.18+
- **Database:** PostgreSQL 15
- **Cache:** Redis 7
- **ORM:** Prisma

### Development Tools

- **Testing:** Jest + Supertest
- **Linting:** ESLint + Prettier
- **Git Hooks:** Husky
- **Validation:** Zod
- **Documentation:** OpenAPI 3.0

### Infrastructure

- **Containerization:** Docker + Docker Compose
- **Reverse Proxy:** Nginx
- **CI/CD:** GitHub Actions
- **Monitoring:** Prometheus + Grafana
- **Logging:** Winston + Loki
- **Tracing:** Jaeger

---

## 📊 Phase Status

| Phase | Name                          | Status         | Hours | Dependencies |
| ----- | ----------------------------- | -------------- | ----- | ------------ |
| 1     | Foundation & Repository Setup | ⚪ Not Started | 0/15h | None         |
| 2     | Database Schema & Models      | ⚪ Not Started | 0/18h | Phase 1      |
| 3     | MCP Server Discovery Engine   | ⚪ Not Started | 0/22h | Phase 2      |
| 4     | Tool Invocation Engine        | ⚪ Not Started | 0/25h | Phase 2      |
| 5     | x402 Payment Integration      | ⚪ Not Started | 0/20h | Phase 4      |
| 6     | Analytics & Monitoring        | ⚪ Not Started | 0/15h | Phase 1      |
| 7     | API Gateway & Security        | ⚪ Not Started | 0/18h | Phase 6      |
| 8     | Testing, Docs & Deployment    | ⚪ Not Started | 0/20h | Phase 7      |

**Total Progress:** 0/153 hours (0%)

---

## ⚠️ Critical Decision Points

### Phase 2: Database Schema

- [ ] Approve database schema design
- [ ] Confirm indexing strategy
- [ ] Review data retention policies

### Phase 4: Tool Invocation

- [ ] Approve payment integration approach

### Phase 5: x402 Payment

- [ ] Select wallet provider
- [ ] Define key management strategy
- [ ] Set commission structure (%)
- [ ] Choose settlement schedule

### Phase 7: Security

- [ ] Confirm rate limit thresholds
- [ ] Approve CORS configuration

### Phase 8: Deployment

- [ ] Select hosting provider
- [ ] Choose orchestration platform
- [ ] Approve production configuration

---

## 🎯 Success Metrics

### Technical KPIs (90 days post-launch)

- ✅ Uptime ≥99.5%
- ✅ P95 response time <2s
- ✅ Error rate <1%
- ✅ Test coverage ≥85%
- ✅ Zero critical security incidents

### Business KPIs (90 days post-launch)

- ✅ MRR ≥$500
- ✅ ≥25 registered MCP servers
- ✅ ≥5,000 tool invocations/month
- ✅ ≥10 paying users

---

## 🔗 Important Links

- **Repository:** https://github.com/iamthegreatdestroyer/AutoAG-CommGateway.git
- **MCP Protocol:** https://modelcontextprotocol.io/
- **Master Road Map:** [AutoAG-CommGateway Road Map.md](../AutoAG-CommGateway%20Road%20Map.md)

---

## 📞 Getting Help

### Documentation Locations

- **Action Plans:** `ACTION-PLANS/` directory
- **API Docs:** http://localhost:18570 (when running)
- **Database Schema:** `prisma/schema.prisma` (after Phase 2)

### Common Issues

1. **Port conflicts:** Verify no other services using 18500-18599
2. **Database connection:** Check PostgreSQL is running on 18510
3. **Build errors:** Run `npm run type-check` for TypeScript issues

---

## 🚦 Next Steps

### Current Status: 🔴 PLANNING PHASE

**Ready to Begin:** Phase 1 - Foundation & Repository Setup  
**Awaiting:** Human approval to start implementation

**To begin execution:**

1. Review all action plan files
2. Verify port assignments (18500-18599)
3. Approve Phase 1 execution plan
4. Grant permission to start implementation

---

**Last Updated:** January 13, 2026  
**Version:** 1.0.0  
**Status:** Ready for approval and execution
