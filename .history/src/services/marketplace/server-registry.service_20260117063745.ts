/**
 * ServerRegistryService
 * 
 * Core marketplace service for MCP server registration, discovery, and management.
 * Enables publishers to list servers, users to discover tools, and system to track statistics.
 * 
 * Key Features:
 * - Server registration with comprehensive metadata
 * - Advanced search with filters (category, tags, rating)
 * - Trending and top-rated server calculations
 * - Health monitoring and endpoint validation
 * - Publisher dashboard statistics
 * 
 * @singleton
 * @emits server:registered, server:updated, server:deleted, server:suspended
 * @emits server:search, server:viewed, server:health-check, server:endpoint-failed
 * 
 * Copyright (c) 2026 AutoAG-CommGateway. All Rights Reserved.
 */

import { EventEmitter } from 'events';
import axios, { AxiosError } from 'axios';

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

/**
 * Server operational status
 */
export enum ServerStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DEPRECATED = 'deprecated',
  PENDING_REVIEW = 'pending_review'
}

/**
 * Server categories for marketplace organization
 */
export enum ServerCategory {
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

/**
 * Configuration constants
 */
const CONFIG = {
  CACHE_TTL_MINUTES: parseInt(process.env.SERVER_REGISTRY_CACHE_TTL_MINUTES || '30', 10),
  HEALTH_CHECK_INTERVAL_MINUTES: parseInt(process.env.SERVER_HEALTH_CHECK_INTERVAL_MINUTES || '15', 10),
  SEARCH_MAX_RESULTS: parseInt(process.env.SERVER_SEARCH_MAX_RESULTS || '50', 10),
  TRENDING_WINDOW_DAYS: parseInt(process.env.SERVER_TRENDING_WINDOW_DAYS || '7', 10),
  REGISTRATION_APPROVAL_REQUIRED: process.env.SERVER_REGISTRATION_APPROVAL_REQUIRED === 'true',
  ENDPOINT_VALIDATION_TIMEOUT_MS: 5000,
  MAX_SERVERS_PER_PUBLISHER: 50,
  MIN_SERVER_NAME_LENGTH: 3,
  MAX_SERVER_NAME_LENGTH: 100,
  MAX_DESCRIPTION_LENGTH: 2000,
  MAX_TAGS: 10
};

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Tool metadata within a server
 */
export interface ToolMetadata {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  averageLatency: number;
  successRate: number;
  totalInvocations: number;
}

/**
 * Pricing information for server access
 */
export interface PricingInfo {
  defaultTier: string;
  customPricing: boolean;
  freeTrialInvocations: number;
  subscriptionAvailable: boolean;
}

/**
 * Server usage statistics
 */
export interface ServerStatistics {
  totalInvocations: number;
  totalRevenue: number;
  averageRating: number;
  totalReviews: number;
  activeUsers: number;
  uptimePercentage: number;
  lastHealthCheck: Date;
}

/**
 * Complete MCP server record
 */
export interface MCPServer {
  id: string;
  name: string;
  description: string;
  publisherId: string;
  endpoint: string;
  status: ServerStatus;
  category: ServerCategory;
  tags: string[];
  tools: ToolMetadata[];
  pricing: PricingInfo;
  statistics: ServerStatistics;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Server registration request
 */
export interface ServerRegistration {
  name: string;
  description: string;
  publisherId: string;
  endpoint: string;
  category: ServerCategory;
  tags?: string[];
  pricing: PricingInfo;
}

/**
 * Search query parameters
 */
export interface SearchQuery {
  query?: string;
  category?: ServerCategory;
  minRating?: number;
  tags?: string[];
  page?: number;
  limit?: number;
  sort?: 'rating' | 'popular' | 'newest';
}

/**
 * Search result with pagination
 */
export interface SearchResult {
  servers: MCPServer[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Paginated server listing
 */
export interface ServerPage {
  servers: MCPServer[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

/**
 * Endpoint validation result
 */
export interface ValidationResult {
  valid: boolean;
  reachable: boolean;
  supportsSSL: boolean;
  responseTime?: number;
  error?: string;
  mcpVersion?: string;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  healthy: boolean;
  responseTime: number;
  status: number;
  toolsAvailable: number;
  error?: string;
  timestamp: Date;
}

// ============================================================================
// ERRORS
// ============================================================================

export class ServerRegistryError extends Error {
  constructor(message: string, public code: string, public statusCode: number = 500) {
    super(message);
    this.name = 'ServerRegistryError';
  }
}

export class ServerNotFoundError extends ServerRegistryError {
  constructor(serverId: string) {
    super(`Server not found: ${serverId}`, 'SERVER_NOT_FOUND', 404);
  }
}

export class InvalidServerError extends ServerRegistryError {
  constructor(message: string) {
    super(message, 'INVALID_SERVER', 400);
  }
}

export class UnauthorizedError extends ServerRegistryError {
  constructor(message: string) {
    super(message, 'UNAUTHORIZED', 403);
  }
}

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

/**
 * ServerRegistryService
 * 
 * Manages the lifecycle and discovery of MCP servers in the marketplace.
 * Implements singleton pattern for shared state management.
 */
export class ServerRegistryService extends EventEmitter {
  private static instance: ServerRegistryService;
  private servers: Map<string, MCPServer>;
  private publisherServers: Map<string, Set<string>>;
  private categoryIndex: Map<ServerCategory, Set<string>>;
  private tagIndex: Map<string, Set<string>>;
  private cache: Map<string, { data: unknown; expiry: number }>;
  private healthCheckIntervalId?: NodeJS.Timeout;

  /**
   * Private constructor for singleton pattern
   */
  private constructor() {
    super();
    this.servers = new Map();
    this.publisherServers = new Map();
    this.categoryIndex = new Map();
    this.tagIndex = new Map();
    this.cache = new Map();

    // Initialize category index
    Object.values(ServerCategory).forEach(category => {
      this.categoryIndex.set(category as ServerCategory, new Set());
    });

    // Start background health check process
    this.startHealthCheckProcess();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): ServerRegistryService {
    if (!ServerRegistryService.instance) {
      ServerRegistryService.instance = new ServerRegistryService();
    }
    return ServerRegistryService.instance;
  }

  // ==========================================================================
  // PUBLIC API - REGISTRATION
  // ==========================================================================

  /**
   * Register a new MCP server in the marketplace
   * 
   * @param registration - Server registration details
   * @returns Newly created server record
   * @throws InvalidServerError if validation fails
   * @throws ServerRegistryError if registration fails
   * 
   * @emits server:registered
   */
  public async registerServer(registration: ServerRegistration): Promise<MCPServer> {
    // Validate registration
    this.validateRegistration(registration);

    // Check publisher server limit
    const publisherServerCount = this.publisherServers.get(registration.publisherId)?.size || 0;
    if (publisherServerCount >= CONFIG.MAX_SERVERS_PER_PUBLISHER) {
      throw new InvalidServerError(
        `Publisher has reached maximum server limit (${CONFIG.MAX_SERVERS_PER_PUBLISHER})`
      );
    }

    // Validate endpoint
    const validation = await this.validateServerEndpoint(registration.endpoint);
    if (!validation.valid) {
      throw new InvalidServerError(`Invalid server endpoint: ${validation.error}`);
    }

    // Create server record
    const server: MCPServer = {
      id: this.generateServerId(),
      name: registration.name,
      description: registration.description,
      publisherId: registration.publisherId,
      endpoint: registration.endpoint,
      status: CONFIG.REGISTRATION_APPROVAL_REQUIRED 
        ? ServerStatus.PENDING_REVIEW 
        : ServerStatus.ACTIVE,
      category: registration.category,
      tags: registration.tags || [],
      tools: [],
      pricing: registration.pricing,
      statistics: {
        totalInvocations: 0,
        totalRevenue: 0,
        averageRating: 0,
        totalReviews: 0,
        activeUsers: 0,
        uptimePercentage: 100,
        lastHealthCheck: new Date()
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Store server
    this.servers.set(server.id, server);

    // Update indices
    this.indexServer(server);

    // Clear relevant caches
    this.clearCaches(['search', 'trending', 'top', 'category']);

    // Emit event
    this.emit('server:registered', {
      serverId: server.id,
      publisherId: server.publisherId,
      name: server.name,
      category: server.category
    });

    return server;
  }

  /**
   * Update an existing server
   * 
   * @param serverId - Server ID to update
   * @param updates - Partial server updates
   * @returns Updated server record
   * @throws ServerNotFoundError if server doesn't exist
   * @throws UnauthorizedError if not the owner
   * 
   * @emits server:updated
   */
  public async updateServer(
    serverId: string,
    updates: Partial<MCPServer>,
    requesterId: string
  ): Promise<MCPServer> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new ServerNotFoundError(serverId);
    }

    // Authorization check
    if (server.publisherId !== requesterId) {
      throw new UnauthorizedError('Only the publisher can update this server');
    }

    // Validate updates
    if (updates.name && updates.name.length < CONFIG.MIN_SERVER_NAME_LENGTH) {
      throw new InvalidServerError('Server name too short');
    }

    // Apply updates
    const updatedServer: MCPServer = {
      ...server,
      ...updates,
      id: server.id, // Prevent ID change
      publisherId: server.publisherId, // Prevent owner change
      updatedAt: new Date()
    };

    // Re-index if category or tags changed
    if (updates.category || updates.tags) {
      this.unindexServer(server);
      this.indexServer(updatedServer);
    }

    // Store updated server
    this.servers.set(serverId, updatedServer);

    // Clear caches
    this.clearCaches(['search', 'server']);

    // Emit event
    this.emit('server:updated', {
      serverId,
      changes: Object.keys(updates)
    });

    return updatedServer;
  }

  /**
   * Delete a server (soft delete by setting status to deprecated)
   * 
   * @param serverId - Server ID to delete
   * @param requesterId - User requesting deletion
   * @param reason - Reason for deletion
   * @throws ServerNotFoundError if server doesn't exist
   * @throws UnauthorizedError if not the owner
   * 
   * @emits server:deleted
   */
  public async deleteServer(
    serverId: string,
    requesterId: string,
    reason: string
  ): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new ServerNotFoundError(serverId);
    }

    // Authorization check
    if (server.publisherId !== requesterId) {
      throw new UnauthorizedError('Only the publisher can delete this server');
    }

    // Soft delete by marking as deprecated
    server.status = ServerStatus.DEPRECATED;
    server.updatedAt = new Date();

    // Unindex from searchable indices
    this.unindexServer(server);

    // Clear caches
    this.clearCaches(['search', 'trending', 'top', 'category']);

    // Emit event
    this.emit('server:deleted', {
      serverId,
      publisherId: server.publisherId,
      reason
    });
  }

  // ==========================================================================
  // PUBLIC API - DISCOVERY
  // ==========================================================================

  /**
   * Search servers with filters and pagination
   * 
   * @param query - Search query parameters
   * @returns Paginated search results
   * 
   * @emits server:search
   */
  public async searchServers(query: SearchQuery): Promise<SearchResult> {
    const page = query.page || 1;
    const limit = Math.min(query.limit || 20, CONFIG.SEARCH_MAX_RESULTS);
    const offset = (page - 1) * limit;

    // Check cache
    const cacheKey = this.generateCacheKey('search', query);
    const cached = this.getFromCache<SearchResult>(cacheKey);
    if (cached) {
      return cached;
    }

    // Get all active servers
    let serverList = Array.from(this.servers.values())
      .filter(s => s.status === ServerStatus.ACTIVE);

    // Apply filters
    if (query.category) {
      serverList = serverList.filter(s => s.category === query.category);
    }

    if (query.minRating) {
      serverList = serverList.filter(s => s.statistics.averageRating >= query.minRating!);
    }

    if (query.tags && query.tags.length > 0) {
      serverList = serverList.filter(s => 
        query.tags!.some(tag => s.tags.includes(tag))
      );
    }

    // Apply text search
    if (query.query) {
      const searchTerm = query.query.toLowerCase();
      serverList = serverList.filter(s => 
        s.name.toLowerCase().includes(searchTerm) ||
        s.description.toLowerCase().includes(searchTerm) ||
        s.tags.some(tag => tag.toLowerCase().includes(searchTerm))
      );
    }

    // Sort results
    const sortBy = query.sort || 'rating';
    serverList.sort((a, b) => {
      switch (sortBy) {
        case 'rating':
          return b.statistics.averageRating - a.statistics.averageRating;
        case 'popular':
          return b.statistics.totalInvocations - a.statistics.totalInvocations;
        case 'newest':
          return b.createdAt.getTime() - a.createdAt.getTime();
        default:
          return 0;
      }
    });

    // Paginate
    const total = serverList.length;
    const servers = serverList.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    const result: SearchResult = {
      servers,
      total,
      page,
      limit,
      hasMore
    };

    // Cache result
    this.setCache(cacheKey, result, CONFIG.CACHE_TTL_MINUTES);

    // Emit event
    this.emit('server:search', {
      query: query.query,
      category: query.category,
      resultsCount: servers.length
    });

    return result;
  }

  /**
   * Get server by ID
   * 
   * @param serverId - Server ID
   * @returns Server record
   * @throws ServerNotFoundError if server doesn't exist
   * 
   * @emits server:viewed
   */
  public async getServerById(serverId: string): Promise<MCPServer> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new ServerNotFoundError(serverId);
    }

    // Emit view event
    this.emit('server:viewed', { serverId });

    return server;
  }

  /**
   * Get servers by category with pagination
   * 
   * @param category - Server category
   * @param page - Page number (1-indexed)
   * @param limit - Results per page
   * @returns Paginated servers
   */
  public async getServersByCategory(
    category: ServerCategory,
    page: number = 1,
    limit: number = 20
  ): Promise<ServerPage> {
    const serverIds = this.categoryIndex.get(category) || new Set();
    const servers = Array.from(serverIds)
      .map(id => this.servers.get(id))
      .filter((s): s is MCPServer => s !== undefined && s.status === ServerStatus.ACTIVE);

    // Sort by rating
    servers.sort((a, b) => b.statistics.averageRating - a.statistics.averageRating);

    // Paginate
    const offset = (page - 1) * limit;
    const total = servers.length;
    const paginatedServers = servers.slice(offset, offset + limit);

    return {
      servers: paginatedServers,
      page,
      limit,
      total,
      hasMore: offset + limit < total
    };
  }

  /**
   * Get trending servers based on recent activity
   * 
   * @param timeframe - Time window for trending calculation
   * @returns List of trending servers
   */
  public async getTrendingServers(
    timeframe: 'day' | 'week' | 'month' = 'week'
  ): Promise<MCPServer[]> {
    // Check cache
    const cacheKey = `trending:${timeframe}`;
    const cached = this.getFromCache<MCPServer[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Get all active servers
    const servers = Array.from(this.servers.values())
      .filter(s => s.status === ServerStatus.ACTIVE);

    // Calculate trending score (simplified algorithm)
    // Score = invocations * (1 + rating/5) * recency_factor
    const now = Date.now();
    const windowMs = this.getTimeframeMs(timeframe);

    const scored = servers
      .map(server => {
        const age = now - server.createdAt.getTime();
        const recency = Math.max(0, 1 - (age / windowMs));
        const ratingBoost = 1 + (server.statistics.averageRating / 5);
        const score = server.statistics.totalInvocations * ratingBoost * recency;

        return { server, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(item => item.server);

    // Cache result
    this.setCache(cacheKey, scored, 60); // 1 hour TTL

    return scored;
  }

  /**
   * Get top rated servers
   * 
   * @param limit - Number of servers to return
   * @returns List of top rated servers
   */
  public async getTopRatedServers(limit: number = 10): Promise<MCPServer[]> {
    // Check cache
    const cacheKey = `top:${limit}`;
    const cached = this.getFromCache<MCPServer[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Get active servers with minimum reviews
    const servers = Array.from(this.servers.values())
      .filter(s => 
        s.status === ServerStatus.ACTIVE &&
        s.statistics.totalReviews >= 5 // Minimum reviews for credibility
      )
      .sort((a, b) => {
        // Sort by rating, then by review count
        if (b.statistics.averageRating !== a.statistics.averageRating) {
          return b.statistics.averageRating - a.statistics.averageRating;
        }
        return b.statistics.totalReviews - a.statistics.totalReviews;
      })
      .slice(0, limit);

    // Cache result
    this.setCache(cacheKey, servers, 60); // 1 hour TTL

    return servers;
  }

  // ==========================================================================
  // PUBLIC API - PUBLISHER MANAGEMENT
  // ==========================================================================

  /**
   * Get all servers owned by a publisher
   * 
   * @param publisherId - Publisher user ID
   * @returns List of publisher's servers
   */
  public async getPublisherServers(publisherId: string): Promise<MCPServer[]> {
    const serverIds = this.publisherServers.get(publisherId) || new Set();
    return Array.from(serverIds)
      .map(id => this.servers.get(id))
      .filter((s): s is MCPServer => s !== undefined)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get detailed statistics for a server
   * 
   * @param serverId - Server ID
   * @returns Server statistics
   * @throws ServerNotFoundError if server doesn't exist
   */
  public async getServerStatistics(serverId: string): Promise<ServerStatistics> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new ServerNotFoundError(serverId);
    }
    return server.statistics;
  }

  /**
   * Update server status (admin/moderator function)
   * 
   * @param serverId - Server ID
   * @param status - New status
   * @throws ServerNotFoundError if server doesn't exist
   * 
   * @emits server:suspended
   */
  public async updateServerStatus(
    serverId: string,
    status: ServerStatus
  ): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new ServerNotFoundError(serverId);
    }

    const oldStatus = server.status;
    server.status = status;
    server.updatedAt = new Date();

    // Re-index if moving to/from active status
    if (oldStatus === ServerStatus.ACTIVE || status === ServerStatus.ACTIVE) {
      this.unindexServer(server);
      if (status === ServerStatus.ACTIVE) {
        this.indexServer(server);
      }
    }

    // Clear caches
    this.clearCaches(['search', 'trending', 'top', 'category']);

    // Emit event if suspended
    if (status === ServerStatus.SUSPENDED) {
      this.emit('server:suspended', {
        serverId,
        previousStatus: oldStatus
      });
    }
  }

  // ==========================================================================
  // PUBLIC API - HEALTH & VALIDATION
  // ==========================================================================

  /**
   * Validate server endpoint is reachable and supports MCP
   * 
   * @param endpoint - Server endpoint URL
   * @returns Validation result
   */
  public async validateServerEndpoint(endpoint: string): Promise<ValidationResult> {
    try {
      // Validate URL format
      const url = new URL(endpoint);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return {
          valid: false,
          reachable: false,
          supportsSSL: false,
          error: 'Only HTTP/HTTPS protocols supported'
        };
      }

      // Attempt connection
      const start = Date.now();
      const response = await axios.get(endpoint, {
        timeout: CONFIG.ENDPOINT_VALIDATION_TIMEOUT_MS,
        validateStatus: () => true // Accept any status code
      });
      const responseTime = Date.now() - start;

      // Check for MCP support (look for common MCP headers/responses)
      const mcpVersion = response.headers['x-mcp-version'] || 
                        response.headers['x-model-context-protocol'] ||
                        undefined;

      return {
        valid: true,
        reachable: response.status < 500,
        supportsSSL: url.protocol === 'https:',
        responseTime,
        mcpVersion
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      return {
        valid: false,
        reachable: false,
        supportsSSL: false,
        error: axiosError.message
      };
    }
  }

  /**
   * Perform health check on a server
   * 
   * @param serverId - Server ID
   * @returns Health check result
   * @throws ServerNotFoundError if server doesn't exist
   * 
   * @emits server:health-check, server:endpoint-failed
   */
  public async performHealthCheck(serverId: string): Promise<HealthCheckResult> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new ServerNotFoundError(serverId);
    }

    try {
      const start = Date.now();
      const response = await axios.get(server.endpoint, {
        timeout: CONFIG.ENDPOINT_VALIDATION_TIMEOUT_MS,
        validateStatus: () => true
      });
      const responseTime = Date.now() - start;

      const result: HealthCheckResult = {
        healthy: response.status >= 200 && response.status < 300,
        responseTime,
        status: response.status,
        toolsAvailable: server.tools.length,
        timestamp: new Date()
      };

      // Update server statistics
      server.statistics.lastHealthCheck = result.timestamp;
      server.statistics.uptimePercentage = this.calculateUptime(server, result.healthy);

      // Emit event
      this.emit('server:health-check', {
        serverId,
        status: result.healthy ? 'healthy' : 'unhealthy',
        latency: responseTime
      });

      return result;
    } catch (error) {
      const axiosError = error as AxiosError;
      const result: HealthCheckResult = {
        healthy: false,
        responseTime: 0,
        status: 0,
        toolsAvailable: server.tools.length,
        error: axiosError.message,
        timestamp: new Date()
      };

      // Update statistics
      server.statistics.lastHealthCheck = result.timestamp;
      server.statistics.uptimePercentage = this.calculateUptime(server, false);

      // Emit failure event
      this.emit('server:endpoint-failed', {
        serverId,
        error: axiosError.message
      });

      return result;
    }
  }

  /**
   * Update server statistics (called by other services)
   * 
   * @param serverId - Server ID
   * @param updates - Statistics updates
   * @throws ServerNotFoundError if server doesn't exist
   */
  public async updateServerStatistics(
    serverId: string,
    updates: Partial<ServerStatistics>
  ): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new ServerNotFoundError(serverId);
    }

    // Apply updates
    server.statistics = {
      ...server.statistics,
      ...updates
    };

    // Clear caches if rating changed
    if (updates.averageRating !== undefined) {
      this.clearCaches(['search', 'trending', 'top']);
    }
  }

  // ==========================================================================
  // PRIVATE METHODS - INDEXING
  // ==========================================================================

  /**
   * Index a server for fast lookups
   */
  private indexServer(server: MCPServer): void {
    // Publisher index
    if (!this.publisherServers.has(server.publisherId)) {
      this.publisherServers.set(server.publisherId, new Set());
    }
    this.publisherServers.get(server.publisherId)!.add(server.id);

    // Category index
    if (server.status === ServerStatus.ACTIVE) {
      this.categoryIndex.get(server.category)!.add(server.id);

      // Tag index
      server.tags.forEach(tag => {
        const normalizedTag = tag.toLowerCase();
        if (!this.tagIndex.has(normalizedTag)) {
          this.tagIndex.set(normalizedTag, new Set());
        }
        this.tagIndex.get(normalizedTag)!.add(server.id);
      });
    }
  }

  /**
   * Remove server from indices
   */
  private unindexServer(server: MCPServer): void {
    // Publisher index
    this.publisherServers.get(server.publisherId)?.delete(server.id);

    // Category index
    this.categoryIndex.get(server.category)?.delete(server.id);

    // Tag index
    server.tags.forEach(tag => {
      this.tagIndex.get(tag.toLowerCase())?.delete(server.id);
    });
  }

  // ==========================================================================
  // PRIVATE METHODS - VALIDATION
  // ==========================================================================

  /**
   * Validate server registration
   */
  private validateRegistration(registration: ServerRegistration): void {
    if (!registration.name || registration.name.length < CONFIG.MIN_SERVER_NAME_LENGTH) {
      throw new InvalidServerError(
        `Server name must be at least ${CONFIG.MIN_SERVER_NAME_LENGTH} characters`
      );
    }

    if (registration.name.length > CONFIG.MAX_SERVER_NAME_LENGTH) {
      throw new InvalidServerError(
        `Server name must not exceed ${CONFIG.MAX_SERVER_NAME_LENGTH} characters`
      );
    }

    if (!registration.description || registration.description.length < 10) {
      throw new InvalidServerError('Server description must be at least 10 characters');
    }

    if (registration.description.length > CONFIG.MAX_DESCRIPTION_LENGTH) {
      throw new InvalidServerError(
        `Server description must not exceed ${CONFIG.MAX_DESCRIPTION_LENGTH} characters`
      );
    }

    if (!registration.endpoint || !this.isValidUrl(registration.endpoint)) {
      throw new InvalidServerError('Invalid server endpoint URL');
    }

    if (!Object.values(ServerCategory).includes(registration.category)) {
      throw new InvalidServerError('Invalid server category');
    }

    if (registration.tags && registration.tags.length > CONFIG.MAX_TAGS) {
      throw new InvalidServerError(`Maximum ${CONFIG.MAX_TAGS} tags allowed`);
    }

    if (!registration.pricing || typeof registration.pricing.freeTrialInvocations !== 'number') {
      throw new InvalidServerError('Invalid pricing information');
    }
  }

  /**
   * Validate URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // PRIVATE METHODS - UTILITIES
  // ==========================================================================

  /**
   * Generate unique server ID
   */
  private generateServerId(): string {
    return `server-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate cache key from query
   */
  private generateCacheKey(prefix: string, data: unknown): string {
    return `${prefix}:${JSON.stringify(data)}`;
  }

  /**
   * Get value from cache
   */
  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set value in cache
   */
  private setCache(key: string, data: unknown, ttlMinutes: number): void {
    this.cache.set(key, {
      data,
      expiry: Date.now() + (ttlMinutes * 60 * 1000)
    });
  }

  /**
   * Clear caches by prefix
   */
  private clearCaches(prefixes: string[]): void {
    Array.from(this.cache.keys()).forEach(key => {
      if (prefixes.some(prefix => key.startsWith(prefix))) {
        this.cache.delete(key);
      }
    });
  }

  /**
   * Get timeframe in milliseconds
   */
  private getTimeframeMs(timeframe: 'day' | 'week' | 'month'): number {
    const day = 24 * 60 * 60 * 1000;
    switch (timeframe) {
      case 'day': return day;
      case 'week': return 7 * day;
      case 'month': return 30 * day;
    }
  }

  /**
   * Calculate uptime percentage
   */
  private calculateUptime(server: MCPServer, currentHealthy: boolean): number {
    // Simplified: weight recent status more heavily
    const current = server.statistics.uptimePercentage;
    return currentHealthy 
      ? Math.min(100, current + (100 - current) * 0.1)
      : Math.max(0, current - current * 0.2);
  }

  /**
   * Start background health check process
   */
  private startHealthCheckProcess(): void {
    const intervalMs = CONFIG.HEALTH_CHECK_INTERVAL_MINUTES * 60 * 1000;

    this.healthCheckIntervalId = setInterval(async () => {
      const servers = Array.from(this.servers.values())
        .filter(s => s.status === ServerStatus.ACTIVE);

      for (const server of servers) {
        try {
          await this.performHealthCheck(server.id);
        } catch (error) {
          // Log error but continue with other servers
          console.error(`Health check failed for server ${server.id}:`, error);
        }
      }
    }, intervalMs);
  }

  /**
   * Stop health check process
   */
  public stopHealthCheckProcess(): void {
    if (this.healthCheckIntervalId) {
      clearInterval(this.healthCheckIntervalId);
      this.healthCheckIntervalId = undefined;
    }
  }

  /**
   * Get service statistics
   */
  public getServiceStats(): {
    totalServers: number;
    activeServers: number;
    totalPublishers: number;
    categories: Record<string, number>;
  } {
    const servers = Array.from(this.servers.values());
    return {
      totalServers: servers.length,
      activeServers: servers.filter(s => s.status === ServerStatus.ACTIVE).length,
      totalPublishers: this.publisherServers.size,
      categories: Object.fromEntries(
        Array.from(this.categoryIndex.entries()).map(([cat, ids]) => [cat, ids.size])
      )
    };
  }
}

// Export singleton instance
export const serverRegistryService = ServerRegistryService.getInstance();

/**
 * Type guard for checking if an object is a valid MCPServer
 */
export function isMCPServer(obj: unknown): obj is MCPServer {
  const server = obj as MCPServer;
  return (
    typeof server.id === 'string' &&
    typeof server.name === 'string' &&
    typeof server.publisherId === 'string' &&
    typeof server.endpoint === 'string' &&
    Object.values(ServerStatus).includes(server.status) &&
    Object.values(ServerCategory).includes(server.category)
  );
}
