import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '../../src/models/repositories';

describe('MCPServerRepository', () => {
  let testUser: any;

  beforeAll(async () => {
    await db.connect();

    // Create test user for server ownership
    testUser = await db.users.createUser({
      email: 'server@test.repository.com',
      password: 'TestPassword123!',
      username: 'serverowner',
    });
  });

  afterAll(async () => {
    await db.prisma.mCPServer.deleteMany({
      where: { ownerId: testUser.id },
    });
    await db.prisma.user.delete({ where: { id: testUser.id } });
    await db.disconnect();
  });

  describe('create', () => {
    it('should create a new MCP server', async () => {
      const serverData = {
        ownerId: testUser.id,
        name: 'test-server',
        displayName: 'Test Server',
        description: 'A test MCP server',
        baseUrl: 'https://test.example.com',
        version: '1.0.0',
        category: ['test', 'demo'],
        tags: ['testing'],
      };

      const server = await db.mcpServers.create(serverData);

      expect(server.id).toBeDefined();
      expect(server.name).toBe(serverData.name);
      expect(server.status).toBe('PENDING');
      expect(server.visibility).toBe('PRIVATE');
      expect(server.pricingModel).toBe('FREE');
    });
  });

  describe('findByOwner', () => {
    it('should find all servers owned by user', async () => {
      await db.mcpServers.create({
        ownerId: testUser.id,
        name: 'server1',
        displayName: 'Server 1',
        baseUrl: 'https://server1.example.com',
        version: '1.0.0',
        category: ['test'],
      });

      await db.mcpServers.create({
        ownerId: testUser.id,
        name: 'server2',
        displayName: 'Server 2',
        baseUrl: 'https://server2.example.com',
        version: '1.0.0',
        category: ['test'],
      });

      const servers = await db.mcpServers.findByOwner(testUser.id);

      expect(servers.length).toBeGreaterThanOrEqual(2);
      expect(servers.every((s: any) => s.ownerId === testUser.id)).toBe(true);
    });
  });

  describe('search', () => {
    beforeAll(async () => {
      // Create servers with different properties
      await db.mcpServers.create({
        ownerId: testUser.id,
        name: 'weather-api',
        displayName: 'Weather API',
        description: 'Weather data service',
        baseUrl: 'https://weather.example.com',
        version: '1.0.0',
        status: 'ACTIVE',
        visibility: 'PUBLIC',
        category: ['weather', 'data'],
        tags: ['api'],
      });
    });

    it('should search servers by name', async () => {
      const result = await db.mcpServers.search({
        search: 'weather',
        page: 1,
        limit: 10,
      });

      expect(result.servers.length).toBeGreaterThan(0);
      expect(result.total).toBeGreaterThan(0);
      expect(result.servers.some((s: any) => s.name.includes('weather'))).toBe(true);
    });

    it('should filter by status', async () => {
      const result = await db.mcpServers.search({
        status: 'ACTIVE',
        page: 1,
        limit: 10,
      });

      expect(result.servers.every((s: any) => s.status === 'ACTIVE')).toBe(true);
    });

    it('should filter by category', async () => {
      const result = await db.mcpServers.search({
        category: 'weather',
        page: 1,
        limit: 10,
      });

      expect(result.servers.every((s: any) => s.category.includes('weather'))).toBe(true);
    });

    it('should support pagination', async () => {
      const page1 = await db.mcpServers.search({ page: 1, limit: 2 });
      const page2 = await db.mcpServers.search({ page: 2, limit: 2 });

      expect(page1.servers.length).toBeLessThanOrEqual(2);
      expect(page2.servers.length).toBeLessThanOrEqual(2);
      // Results should be different
      if (page1.servers.length > 0 && page2.servers.length > 0) {
        expect(page1.servers[0].id).not.toBe(page2.servers[0].id);
      }
    });
  });

  describe('incrementCallCount', () => {
    it('should increment total calls', async () => {
      const server = await db.mcpServers.create({
        ownerId: testUser.id,
        name: 'call-counter',
        displayName: 'Call Counter',
        baseUrl: 'https://counter.example.com',
        version: '1.0.0',
        category: ['test'],
      });

      await db.mcpServers.incrementCallCount(server.id);
      await db.mcpServers.incrementCallCount(server.id);

      const updated = await db.mcpServers.findById(server.id);
      expect(Number(updated?.totalCalls)).toBe(2);
    });
  });

  describe('updateRevenue', () => {
    it('should update total revenue', async () => {
      const server = await db.mcpServers.create({
        ownerId: testUser.id,
        name: 'revenue-tracker',
        displayName: 'Revenue Tracker',
        baseUrl: 'https://revenue.example.com',
        version: '1.0.0',
        category: ['test'],
      });

      await db.mcpServers.updateRevenue(server.id, 10.5);
      await db.mcpServers.updateRevenue(server.id, 5.25);

      const updated = await db.mcpServers.findById(server.id);
      expect(Number(updated?.totalRevenue)).toBe(15.75);
    });
  });
});
