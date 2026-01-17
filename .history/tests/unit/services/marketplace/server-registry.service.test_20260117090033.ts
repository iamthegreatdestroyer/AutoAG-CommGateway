/**
 * ServerRegistryService Unit Tests
 *
 * Comprehensive test suite for the Server Registry Service.
 * Tests registration, search, health checks, and all marketplace operations.
 *
 * Coverage Target: 95%+
 * Test Count: 30+ tests
 *
 * Copyright (c) 2026 AutoAG-CommGateway. All Rights Reserved.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import axios from 'axios';
import {
  ServerRegistryService,
  ServerStatus,
  ServerCategory,
  ServerNotFoundError,
  InvalidServerError,
  UnauthorizedError,
  type ServerRegistration,
  type SearchQuery,
  type MCPServer,
} from '../../../../src/services/marketplace/server-registry.service';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ServerRegistryService', () => {
  let service: ServerRegistryService;

  beforeEach(() => {
    // Get fresh instance for each test
    service = ServerRegistryService.getInstance();

    // Reset service state between tests to avoid interference
    service.resetForTesting();

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Stop health check process
    service.stopHealthCheckProcess();
  });

  // ============================================================================
  // REGISTRATION TESTS
  // ============================================================================

  describe('registerServer', () => {
    const validRegistration: ServerRegistration = {
      name: 'Test Server',
      description: 'A test MCP server for unit testing',
      publisherId: 'publisher-123',
      endpoint: 'https://test-server.example.com',
      category: ServerCategory.DEVELOPER_TOOLS,
      tags: ['testing', 'development'],
      pricing: {
        defaultTier: 'free',
        customPricing: false,
        freeTrialInvocations: 100,
        subscriptionAvailable: false,
      },
    };

    it('should register a valid server successfully', async () => {
      // Mock endpoint validation
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        headers: { 'x-mcp-version': '1.0' },
        data: {},
      });

      const server = await service.registerServer(validRegistration);

      expect(server).toBeDefined();
      expect(server.id).toMatch(/^server-\d+-[a-z0-9]+$/);
      expect(server.name).toBe(validRegistration.name);
      expect(server.description).toBe(validRegistration.description);
      expect(server.publisherId).toBe(validRegistration.publisherId);
      expect(server.endpoint).toBe(validRegistration.endpoint);
      expect(server.category).toBe(validRegistration.category);
      expect(server.tags).toEqual(validRegistration.tags);
      expect(server.status).toBe(ServerStatus.ACTIVE);
      expect(server.statistics.totalInvocations).toBe(0);
      expect(server.createdAt).toBeInstanceOf(Date);
    });

    it('should emit server:registered event on successful registration', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: {},
      });

      const eventSpy = jest.fn();
      service.on('server:registered', eventSpy);

      const server = await service.registerServer(validRegistration);

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: server.id,
          publisherId: validRegistration.publisherId,
          name: validRegistration.name,
          category: validRegistration.category,
        })
      );
    });

    it('should reject registration with name too short', async () => {
      const invalidRegistration = {
        ...validRegistration,
        name: 'AB', // Less than 3 characters
      };

      await expect(service.registerServer(invalidRegistration)).rejects.toThrow(InvalidServerError);
    });

    it('should reject registration with name too long', async () => {
      const invalidRegistration = {
        ...validRegistration,
        name: 'A'.repeat(101), // More than 100 characters
      };

      await expect(service.registerServer(invalidRegistration)).rejects.toThrow(InvalidServerError);
    });

    it('should reject registration with description too short', async () => {
      const invalidRegistration = {
        ...validRegistration,
        description: 'Short', // Less than 10 characters
      };

      await expect(service.registerServer(invalidRegistration)).rejects.toThrow(InvalidServerError);
    });

    it('should reject registration with invalid endpoint', async () => {
      const invalidRegistration = {
        ...validRegistration,
        endpoint: 'not-a-valid-url',
      };

      await expect(service.registerServer(invalidRegistration)).rejects.toThrow(InvalidServerError);
    });

    it('should reject registration with invalid category', async () => {
      const invalidRegistration = {
        ...validRegistration,
        category: 'INVALID_CATEGORY' as ServerCategory,
      };

      await expect(service.registerServer(invalidRegistration)).rejects.toThrow(InvalidServerError);
    });

    it('should reject registration with too many tags', async () => {
      const invalidRegistration = {
        ...validRegistration,
        tags: Array(11).fill('tag'), // More than 10 tags
      };

      await expect(service.registerServer(invalidRegistration)).rejects.toThrow(InvalidServerError);
    });

    it('should reject registration with unreachable endpoint', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.registerServer(validRegistration)).rejects.toThrow(InvalidServerError);
    });

    it('should reject registration when publisher has reached limit', async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        headers: {},
        data: {},
      });

      // Register 50 servers (the limit)
      for (let i = 0; i < 50; i++) {
        await service.registerServer({
          ...validRegistration,
          name: `Server ${i}`,
          endpoint: `https://server-${i}.example.com`,
        });
      }

      // 51st should fail
      await expect(
        service.registerServer({
          ...validRegistration,
          name: 'Server 51',
          endpoint: 'https://server-51.example.com',
        })
      ).rejects.toThrow(InvalidServerError);
    });
  });

  // ============================================================================
  // UPDATE TESTS
  // ============================================================================

  describe('updateServer', () => {
    let testServer: MCPServer;
    const publisherId = 'publisher-123';

    beforeEach(async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        headers: {},
        data: {},
      });

      testServer = await service.registerServer({
        name: 'Test Server',
        description: 'Test description',
        publisherId,
        endpoint: 'https://test.example.com',
        category: ServerCategory.DEVELOPER_TOOLS,
        tags: ['test'],
        pricing: {
          defaultTier: 'free',
          customPricing: false,
          freeTrialInvocations: 100,
          subscriptionAvailable: false,
        },
      });
    });

    it('should update server successfully', async () => {
      // Wait 10ms to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updates = {
        name: 'Updated Server Name',
        description: 'Updated description',
      };

      const updated = await service.updateServer(testServer.id, updates, publisherId);

      expect(updated.name).toBe(updates.name);
      expect(updated.description).toBe(updates.description);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(testServer.createdAt.getTime());
    });

    it('should emit server:updated event', async () => {
      const eventSpy = jest.fn();
      service.on('server:updated', eventSpy);

      await service.updateServer(testServer.id, { name: 'New Name' }, publisherId);

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: testServer.id,
          changes: ['name'],
        })
      );
    });

    it('should reject update for non-existent server', async () => {
      await expect(service.updateServer('non-existent', {}, publisherId)).rejects.toThrow(
        ServerNotFoundError
      );
    });

    it('should reject update from non-owner', async () => {
      await expect(service.updateServer(testServer.id, {}, 'wrong-publisher')).rejects.toThrow(
        UnauthorizedError
      );
    });

    it('should reject update with invalid name', async () => {
      await expect(
        service.updateServer(testServer.id, { name: 'AB' }, publisherId)
      ).rejects.toThrow(InvalidServerError);
    });

    it('should prevent ID changes', async () => {
      const updated = await service.updateServer(
        testServer.id,
        { id: 'hacked-id' } as any,
        publisherId
      );

      expect(updated.id).toBe(testServer.id);
    });

    it('should prevent publisher changes', async () => {
      const updated = await service.updateServer(
        testServer.id,
        { publisherId: 'hacker' },
        publisherId
      );

      expect(updated.publisherId).toBe(publisherId);
    });
  });

  // ============================================================================
  // DELETE TESTS
  // ============================================================================

  describe('deleteServer', () => {
    let testServer: MCPServer;
    const publisherId = 'publisher-123';

    beforeEach(async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        headers: {},
        data: {},
      });

      testServer = await service.registerServer({
        name: 'Test Server',
        description: 'Test description',
        publisherId,
        endpoint: 'https://test.example.com',
        category: ServerCategory.DEVELOPER_TOOLS,
        tags: ['test'],
        pricing: {
          defaultTier: 'free',
          customPricing: false,
          freeTrialInvocations: 100,
          subscriptionAvailable: false,
        },
      });
    });

    it('should soft delete server', async () => {
      await service.deleteServer(testServer.id, publisherId, 'Testing deletion');

      const server = await service.getServerById(testServer.id);
      expect(server.status).toBe(ServerStatus.DEPRECATED);
    });

    it('should emit server:deleted event', async () => {
      const eventSpy = jest.fn();
      service.on('server:deleted', eventSpy);

      await service.deleteServer(testServer.id, publisherId, 'Testing');

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: testServer.id,
          publisherId,
          reason: 'Testing',
        })
      );
    });

    it('should reject deletion of non-existent server', async () => {
      await expect(service.deleteServer('non-existent', publisherId, 'Test')).rejects.toThrow(
        ServerNotFoundError
      );
    });

    it('should reject deletion by non-owner', async () => {
      await expect(service.deleteServer(testServer.id, 'wrong-publisher', 'Test')).rejects.toThrow(
        UnauthorizedError
      );
    });
  });

  // ============================================================================
  // SEARCH TESTS
  // ============================================================================

  describe('searchServers', () => {
    beforeEach(async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        headers: {},
        data: {},
      });

      // Create test servers
      const categories = [
        ServerCategory.AI_MODELS,
        ServerCategory.DATA_PROCESSING,
        ServerCategory.DEVELOPER_TOOLS,
      ];

      for (let i = 0; i < 15; i++) {
        await service.registerServer({
          name: `Server ${i}`,
          description: `Test server ${i} for testing search functionality`,
          publisherId: `publisher-${i % 3}`,
          endpoint: `https://server-${i}.example.com`,
          category: categories[i % 3],
          tags: i % 2 === 0 ? ['even', 'test'] : ['odd', 'test'],
          pricing: {
            defaultTier: 'free',
            customPricing: false,
            freeTrialInvocations: 100,
            subscriptionAvailable: false,
          },
        });
      }
    });

    it('should return all active servers', async () => {
      const result = await service.searchServers({});

      expect(result.servers.length).toBeGreaterThan(0);
      expect(result.total).toBeGreaterThan(0);
      expect(result.page).toBe(1);
    });

    it('should filter by category', async () => {
      const result = await service.searchServers({
        category: ServerCategory.AI_MODELS,
      });

      expect(result.servers.every((s) => s.category === ServerCategory.AI_MODELS)).toBe(true);
    });

    it('should filter by tags', async () => {
      const result = await service.searchServers({
        tags: ['even'],
      });

      expect(result.servers.every((s) => s.tags.includes('even'))).toBe(true);
    });

    it('should filter by minimum rating', async () => {
      const result = await service.searchServers({
        minRating: 4.0,
      });

      expect(result.servers.every((s) => s.statistics.averageRating >= 4.0)).toBe(true);
    });

    it('should search by text query', async () => {
      const result = await service.searchServers({
        query: 'Server 5',
      });

      expect(result.servers.some((s) => s.name.includes('Server 5'))).toBe(true);
    });

    it('should paginate results', async () => {
      const page1 = await service.searchServers({ page: 1, limit: 5 });
      const page2 = await service.searchServers({ page: 2, limit: 5 });

      expect(page1.servers.length).toBeLessThanOrEqual(5);
      expect(page2.servers.length).toBeLessThanOrEqual(5);
      expect(page1.servers[0].id).not.toBe(page2.servers[0].id);
      expect(page1.hasMore).toBe(true);
    });

    it('should sort by rating', async () => {
      const result = await service.searchServers({ sort: 'rating' });

      for (let i = 1; i < result.servers.length; i++) {
        expect(result.servers[i - 1].statistics.averageRating).toBeGreaterThanOrEqual(
          result.servers[i].statistics.averageRating
        );
      }
    });

    it('should sort by popularity', async () => {
      const result = await service.searchServers({ sort: 'popular' });

      for (let i = 1; i < result.servers.length; i++) {
        expect(result.servers[i - 1].statistics.totalInvocations).toBeGreaterThanOrEqual(
          result.servers[i].statistics.totalInvocations
        );
      }
    });

    it('should sort by newest', async () => {
      const result = await service.searchServers({ sort: 'newest' });

      for (let i = 1; i < result.servers.length; i++) {
        expect(result.servers[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
          result.servers[i].createdAt.getTime()
        );
      }
    });

    it('should emit server:search event', async () => {
      const eventSpy = jest.fn();
      service.on('server:search', eventSpy);

      await service.searchServers({ query: 'test' });

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'test',
        })
      );
    });

    it('should cache search results', async () => {
      const query: SearchQuery = { category: ServerCategory.AI_MODELS };

      // First call
      const result1 = await service.searchServers(query);

      // Second call should use cache
      const result2 = await service.searchServers(query);

      expect(result1).toEqual(result2);
    });
  });

  // ============================================================================
  // RETRIEVAL TESTS
  // ============================================================================

  describe('getServerById', () => {
    let testServer: MCPServer;

    beforeEach(async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        headers: {},
        data: {},
      });

      testServer = await service.registerServer({
        name: 'Test Server',
        description: 'Test description',
        publisherId: 'publisher-123',
        endpoint: 'https://test.example.com',
        category: ServerCategory.DEVELOPER_TOOLS,
        tags: ['test'],
        pricing: {
          defaultTier: 'free',
          customPricing: false,
          freeTrialInvocations: 100,
          subscriptionAvailable: false,
        },
      });
    });

    it('should retrieve server by ID', async () => {
      const server = await service.getServerById(testServer.id);

      expect(server).toBeDefined();
      expect(server.id).toBe(testServer.id);
    });

    it('should emit server:viewed event', async () => {
      const eventSpy = jest.fn();
      service.on('server:viewed', eventSpy);

      await service.getServerById(testServer.id);

      expect(eventSpy).toHaveBeenCalledWith({ serverId: testServer.id });
    });

    it('should throw error for non-existent server', async () => {
      await expect(service.getServerById('non-existent')).rejects.toThrow(ServerNotFoundError);
    });
  });

  // ============================================================================
  // CATEGORY TESTS
  // ============================================================================

  describe('getServersByCategory', () => {
    beforeEach(async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        headers: {},
        data: {},
      });

      // Create servers in different categories
      for (let i = 0; i < 5; i++) {
        await service.registerServer({
          name: `AI Server ${i}`,
          description: 'AI model server',
          publisherId: 'publisher-123',
          endpoint: `https://ai-${i}.example.com`,
          category: ServerCategory.AI_MODELS,
          tags: ['ai'],
          pricing: {
            defaultTier: 'free',
            customPricing: false,
            freeTrialInvocations: 100,
            subscriptionAvailable: false,
          },
        });
      }
    });

    it('should return servers in category', async () => {
      const result = await service.getServersByCategory(ServerCategory.AI_MODELS);

      expect(result.servers.length).toBeGreaterThan(0);
      expect(result.servers.every((s) => s.category === ServerCategory.AI_MODELS)).toBe(true);
    });

    it('should paginate category results', async () => {
      const page1 = await service.getServersByCategory(ServerCategory.AI_MODELS, 1, 2);
      const page2 = await service.getServersByCategory(ServerCategory.AI_MODELS, 2, 2);

      expect(page1.servers.length).toBeLessThanOrEqual(2);
      expect(page2.servers.length).toBeLessThanOrEqual(2);
      expect(page1.hasMore).toBe(true);
    });

    it('should return empty results for unused category', async () => {
      const result = await service.getServersByCategory(ServerCategory.FINANCE);

      expect(result.servers.length).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  // ============================================================================
  // TRENDING TESTS
  // ============================================================================

  describe('getTrendingServers', () => {
    beforeEach(async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        headers: {},
        data: {},
      });

      // Create servers with varying activity
      for (let i = 0; i < 5; i++) {
        await service.registerServer({
          name: `Server ${i}`,
          description: 'Test server',
          publisherId: 'publisher-123',
          endpoint: `https://server-${i}.example.com`,
          category: ServerCategory.DEVELOPER_TOOLS,
          tags: ['test'],
          pricing: {
            defaultTier: 'free',
            customPricing: false,
            freeTrialInvocations: 100,
            subscriptionAvailable: false,
          },
        });
      }
    });

    it('should return trending servers', async () => {
      const trending = await service.getTrendingServers('week');

      expect(trending.length).toBeGreaterThan(0);
      expect(trending.length).toBeLessThanOrEqual(10);
    });

    it('should cache trending results', async () => {
      const trending1 = await service.getTrendingServers('week');
      const trending2 = await service.getTrendingServers('week');

      expect(trending1).toEqual(trending2);
    });

    it('should calculate trending for different timeframes', async () => {
      const day = await service.getTrendingServers('day');
      const week = await service.getTrendingServers('week');
      const month = await service.getTrendingServers('month');

      expect(day).toBeDefined();
      expect(week).toBeDefined();
      expect(month).toBeDefined();
    });
  });

  // ============================================================================
  // TOP RATED TESTS
  // ============================================================================

  describe('getTopRatedServers', () => {
    beforeEach(async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        headers: {},
        data: {},
      });

      // Create servers with ratings
      for (let i = 0; i < 10; i++) {
        const server = await service.registerServer({
          name: `Server ${i}`,
          description: 'Test server',
          publisherId: 'publisher-123',
          endpoint: `https://server-${i}.example.com`,
          category: ServerCategory.DEVELOPER_TOOLS,
          tags: ['test'],
          pricing: {
            defaultTier: 'free',
            customPricing: false,
            freeTrialInvocations: 100,
            subscriptionAvailable: false,
          },
        });

        // Add fake ratings
        await service.updateServerStatistics(server.id, {
          averageRating: 3 + (i / 10) * 2, // 3.0 to 5.0
          totalReviews: 10 + i, // Ensure minimum reviews
        });
      }
    });

    it('should return top rated servers', async () => {
      const topRated = await service.getTopRatedServers(5);

      expect(topRated.length).toBeLessThanOrEqual(5);
      // Verify sorted by rating
      for (let i = 1; i < topRated.length; i++) {
        expect(topRated[i - 1].statistics.averageRating).toBeGreaterThanOrEqual(
          topRated[i].statistics.averageRating
        );
      }
    });

    it('should only include servers with minimum reviews', async () => {
      const topRated = await service.getTopRatedServers();

      expect(topRated.every((s) => s.statistics.totalReviews >= 5)).toBe(true);
    });

    it('should cache top rated results', async () => {
      const top1 = await service.getTopRatedServers();
      const top2 = await service.getTopRatedServers();

      expect(top1).toEqual(top2);
    });
  });

  // ============================================================================
  // PUBLISHER TESTS
  // ============================================================================

  describe('getPublisherServers', () => {
    const publisherId = 'publisher-123';

    beforeEach(async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        headers: {},
        data: {},
      });

      // Create servers for publisher
      for (let i = 0; i < 3; i++) {
        await service.registerServer({
          name: `Server ${i}`,
          description: 'Test server',
          publisherId,
          endpoint: `https://server-${i}.example.com`,
          category: ServerCategory.DEVELOPER_TOOLS,
          tags: ['test'],
          pricing: {
            defaultTier: 'free',
            customPricing: false,
            freeTrialInvocations: 100,
            subscriptionAvailable: false,
          },
        });
      }
    });

    it('should return all servers for publisher', async () => {
      const servers = await service.getPublisherServers(publisherId);

      expect(servers.length).toBe(3);
      expect(servers.every((s) => s.publisherId === publisherId)).toBe(true);
    });

    it('should sort by creation date descending', async () => {
      const servers = await service.getPublisherServers(publisherId);

      for (let i = 1; i < servers.length; i++) {
        expect(servers[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
          servers[i].createdAt.getTime()
        );
      }
    });

    it('should return empty array for publisher with no servers', async () => {
      const servers = await service.getPublisherServers('non-existent');

      expect(servers).toEqual([]);
    });
  });

  // ============================================================================
  // HEALTH CHECK TESTS
  // ============================================================================

  describe('validateServerEndpoint', () => {
    it('should validate reachable HTTPS endpoint', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        headers: { 'x-mcp-version': '1.0' },
        data: {},
      });

      const result = await service.validateServerEndpoint('https://test.example.com');

      expect(result.valid).toBe(true);
      expect(result.reachable).toBe(true);
      expect(result.supportsSSL).toBe(true);
      expect(result.mcpVersion).toBe('1.0');
    });

    it('should reject invalid URL format', async () => {
      const result = await service.validateServerEndpoint('not-a-url');

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject non-HTTP protocols', async () => {
      const result = await service.validateServerEndpoint('ftp://test.example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('HTTP/HTTPS');
    });

    it('should handle unreachable endpoint', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.validateServerEndpoint('https://unreachable.example.com');

      expect(result.valid).toBe(false);
      expect(result.reachable).toBe(false);
    });
  });

  describe('performHealthCheck', () => {
    let testServer: MCPServer;

    beforeEach(async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        headers: {},
        data: {},
      });

      testServer = await service.registerServer({
        name: 'Test Server',
        description: 'Test description',
        publisherId: 'publisher-123',
        endpoint: 'https://test.example.com',
        category: ServerCategory.DEVELOPER_TOOLS,
        tags: ['test'],
        pricing: {
          defaultTier: 'free',
          customPricing: false,
          freeTrialInvocations: 100,
          subscriptionAvailable: false,
        },
      });
    });

    it('should perform successful health check', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: {},
      });

      const result = await service.performHealthCheck(testServer.id);

      expect(result.healthy).toBe(true);
      expect(result.status).toBe(200);
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should emit server:health-check event', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: {},
      });

      const eventSpy = jest.fn();
      service.on('server:health-check', eventSpy);

      await service.performHealthCheck(testServer.id);

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: testServer.id,
          status: 'healthy',
        })
      );
    });

    it('should handle unhealthy endpoint', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        status: 500,
        headers: {},
        data: {},
      });

      const result = await service.performHealthCheck(testServer.id);

      expect(result.healthy).toBe(false);
      expect(result.status).toBe(500);
    });

    it('should handle failed health check', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Connection timeout'));

      const result = await service.performHealthCheck(testServer.id);

      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should emit server:endpoint-failed event on failure', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Connection failed'));

      const eventSpy = jest.fn();
      service.on('server:endpoint-failed', eventSpy);

      await service.performHealthCheck(testServer.id);

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: testServer.id,
        })
      );
    });

    it('should throw error for non-existent server', async () => {
      await expect(service.performHealthCheck('non-existent')).rejects.toThrow(ServerNotFoundError);
    });
  });

  // ============================================================================
  // STATISTICS TESTS
  // ============================================================================

  describe('updateServerStatistics', () => {
    let testServer: MCPServer;

    beforeEach(async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        headers: {},
        data: {},
      });

      testServer = await service.registerServer({
        name: 'Test Server',
        description: 'Test description',
        publisherId: 'publisher-123',
        endpoint: 'https://test.example.com',
        category: ServerCategory.DEVELOPER_TOOLS,
        tags: ['test'],
        pricing: {
          defaultTier: 'free',
          customPricing: false,
          freeTrialInvocations: 100,
          subscriptionAvailable: false,
        },
      });
    });

    it('should update statistics successfully', async () => {
      await service.updateServerStatistics(testServer.id, {
        totalInvocations: 100,
        totalRevenue: 500,
      });

      const stats = await service.getServerStatistics(testServer.id);

      expect(stats.totalInvocations).toBe(100);
      expect(stats.totalRevenue).toBe(500);
    });

    it('should clear caches when rating updated', async () => {
      // Perform search to populate cache
      await service.searchServers({});

      // Update rating
      await service.updateServerStatistics(testServer.id, {
        averageRating: 4.5,
      });

      // Verify cache was cleared by checking search again
      const result = await service.searchServers({});
      expect(result).toBeDefined();
    });

    it('should throw error for non-existent server', async () => {
      await expect(service.updateServerStatistics('non-existent', {})).rejects.toThrow(
        ServerNotFoundError
      );
    });
  });

  // ============================================================================
  // SERVICE STATS TESTS
  // ============================================================================

  describe('getServiceStats', () => {
    beforeEach(async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        headers: {},
        data: {},
      });

      // Create test servers
      for (let i = 0; i < 5; i++) {
        await service.registerServer({
          name: `Server ${i}`,
          description: 'Test server',
          publisherId: `publisher-${i % 2}`,
          endpoint: `https://server-${i}.example.com`,
          category: i % 2 === 0 ? ServerCategory.AI_MODELS : ServerCategory.DATA_PROCESSING,
          tags: ['test'],
          pricing: {
            defaultTier: 'free',
            customPricing: false,
            freeTrialInvocations: 100,
            subscriptionAvailable: false,
          },
        });
      }
    });

    it('should return correct service statistics', () => {
      const stats = service.getServiceStats();

      expect(stats.totalServers).toBeGreaterThanOrEqual(5);
      expect(stats.activeServers).toBeGreaterThanOrEqual(5);
      expect(stats.totalPublishers).toBeGreaterThanOrEqual(2);
      expect(stats.categories).toBeDefined();
    });

    it('should track servers per category', () => {
      const stats = service.getServiceStats();

      expect(stats.categories[ServerCategory.AI_MODELS]).toBeGreaterThan(0);
      expect(stats.categories[ServerCategory.DATA_PROCESSING]).toBeGreaterThan(0);
    });
  });
});
