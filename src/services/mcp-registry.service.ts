/**
 * MCP Server Registry Service
 * Manages MCP server discovery, registration, and metadata
 */

import { Logger } from '../utils/logger';
import { MCPServerRegistry, MCPServerRegistryEntry, MCPServerCategory } from '../types/mcp.types';

/**
 * In-memory MCP Server Registry
 * Maintains a catalog of known/registered MCP servers
 */
export class MCPServerRegistryService implements MCPServerRegistry {
  private servers: Map<string, MCPServerRegistryEntry> = new Map();
  private categories: Map<MCPServerCategory, Set<string>> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = Logger.getInstance();
    this.initializeCategories();
  }

  /**
   * Initialize category mappings
   */
  private initializeCategories(): void {
    const categories: MCPServerCategory[] = [
      'data_processing',
      'ai_ml',
      'cloud_services',
      'authentication',
      'analytics',
      'integration',
      'utilities',
      'security',
      'monitoring',
      'other',
    ];

    categories.forEach((category) => {
      this.categories.set(category, new Set());
    });
  }

  /**
   * Register MCP server in registry
   */
  registerServer(entry: MCPServerRegistryEntry): void {
    if (this.servers.has(entry.id)) {
      this.logger.warn(`[MCP Registry] Server already registered: ${entry.id}`);
      return;
    }

    this.servers.set(entry.id, {
      ...entry,
      registeredAt: new Date(),
      lastCheckedAt: new Date(),
      status: 'unknown',
    });

    // Add to category index
    if (this.categories.has(entry.category)) {
      this.categories.get(entry.category)!.add(entry.id);
    }

    this.logger.info(`[MCP Registry] Server registered: ${entry.id}`, {
      name: entry.name,
      category: entry.category,
    });
  }

  /**
   * Unregister MCP server from registry
   */
  unregisterServer(serverId: string): void {
    const entry = this.servers.get(serverId);
    if (entry) {
      this.servers.delete(serverId);

      // Remove from category index
      if (this.categories.has(entry.category)) {
        this.categories.get(entry.category)!.delete(serverId);
      }

      this.logger.info(`[MCP Registry] Server unregistered: ${serverId}`);
    }
  }

  /**
   * Get server registry entry
   */
  getServer(serverId: string): MCPServerRegistryEntry | null {
    return this.servers.get(serverId) || null;
  }

  /**
   * Find servers by category
   */
  findByCategory(category: MCPServerCategory): MCPServerRegistryEntry[] {
    const serverIds = this.categories.get(category) || new Set();
    return Array.from(serverIds)
      .map((id) => this.servers.get(id)!)
      .filter((entry): entry is MCPServerRegistryEntry => entry !== undefined);
  }

  /**
   * Find servers by name (regex)
   */
  findByName(namePattern: string): MCPServerRegistryEntry[] {
    const regex = new RegExp(namePattern, 'i');
    return Array.from(this.servers.values()).filter((entry) => regex.test(entry.name));
  }

  /**
   * Find servers by capability
   */
  findByCapability(capabilityType: string): MCPServerRegistryEntry[] {
    return Array.from(this.servers.values()).filter((entry) =>
      entry.capabilities.some((cap) => cap.type === capabilityType)
    );
  }

  /**
   * Get all registered servers
   */
  getAllServers(): MCPServerRegistryEntry[] {
    return Array.from(this.servers.values());
  }

  /**
   * Get servers by health status
   */
  getHealthyServers(): MCPServerRegistryEntry[] {
    return Array.from(this.servers.values()).filter((entry) => entry.status === 'healthy');
  }

  /**
   * Update server status
   */
  updateServerStatus(serverId: string, status: 'healthy' | 'degraded' | 'unknown' | 'error'): void {
    const entry = this.servers.get(serverId);
    if (entry) {
      entry.status = status;
      entry.lastCheckedAt = new Date();

      this.logger.info(`[MCP Registry] Server status updated: ${serverId}`, {
        status,
      });
    }
  }

  /**
   * Get registry statistics
   */
  getStatistics(): {
    totalServers: number;
    serversByCategory: Record<MCPServerCategory, number>;
    healthyServers: number;
    degradedServers: number;
  } {
    const stats = {
      totalServers: this.servers.size,
      serversByCategory: {} as Record<MCPServerCategory, number>,
      healthyServers: 0,
      degradedServers: 0,
    };

    this.categories.forEach((serverIds, category) => {
      stats.serversByCategory[category] = serverIds.size;
    });

    Array.from(this.servers.values()).forEach((entry) => {
      if (entry.status === 'healthy') stats.healthyServers++;
      else if (entry.status === 'degraded') stats.degradedServers++;
    });

    return stats;
  }

  /**
   * Load default server registry
   * Seeds the registry with commonly used MCP servers
   */
  loadDefaultRegistry(): void {
    const defaultServers: MCPServerRegistryEntry[] = [
      // Data Processing
      {
        id: 'postgres-server',
        name: 'PostgreSQL MCP Server',
        description: 'Execute SQL queries and manage PostgreSQL databases',
        version: '1.0.0',
        url: 'http://localhost:5433',
        category: 'data_processing',
        capabilities: [
          {
            type: 'database_access',
            supported: true,
            version: '1.0',
            features: ['query', 'transaction', 'migration'],
          },
        ],
        authentication: {
          type: 'connection_string',
          required: true,
        },
        documentation: 'https://docs.example.com/postgres',
        registeredAt: new Date(),
        lastCheckedAt: new Date(),
        status: 'unknown',
      },
      // AI/ML
      {
        id: 'openai-server',
        name: 'OpenAI MCP Server',
        description: 'Access OpenAI APIs for text, image, and audio generation',
        version: '1.0.0',
        url: 'http://localhost:5434',
        category: 'ai_ml',
        capabilities: [
          {
            type: 'text_generation',
            supported: true,
            version: '1.0',
            features: ['completion', 'chat', 'embedding'],
          },
          {
            type: 'image_generation',
            supported: true,
            version: '1.0',
            features: ['create', 'edit', 'variation'],
          },
        ],
        authentication: {
          type: 'api_key',
          required: true,
        },
        documentation: 'https://platform.openai.com/docs',
        registeredAt: new Date(),
        lastCheckedAt: new Date(),
        status: 'unknown',
      },
      // Cloud Services
      {
        id: 'aws-server',
        name: 'AWS MCP Server',
        description: 'Manage AWS services (S3, Lambda, RDS, etc.)',
        version: '1.0.0',
        url: 'http://localhost:5435',
        category: 'cloud_services',
        capabilities: [
          {
            type: 'cloud_storage',
            supported: true,
            version: '1.0',
            features: ['s3', 'ebs', 'efs'],
          },
          {
            type: 'compute',
            supported: true,
            version: '1.0',
            features: ['ec2', 'lambda', 'ecs'],
          },
        ],
        authentication: {
          type: 'oauth',
          required: true,
        },
        documentation: 'https://aws.amazon.com/mcp',
        registeredAt: new Date(),
        lastCheckedAt: new Date(),
        status: 'unknown',
      },
      // Authentication
      {
        id: 'auth0-server',
        name: 'Auth0 MCP Server',
        description: 'Manage authentication and authorization via Auth0',
        version: '1.0.0',
        url: 'http://localhost:5436',
        category: 'authentication',
        capabilities: [
          {
            type: 'user_management',
            supported: true,
            version: '1.0',
            features: ['create', 'update', 'delete', 'reset_password'],
          },
          {
            type: 'rule_management',
            supported: true,
            version: '1.0',
            features: ['create', 'update', 'test'],
          },
        ],
        authentication: {
          type: 'api_key',
          required: true,
        },
        documentation: 'https://auth0.com/docs',
        registeredAt: new Date(),
        lastCheckedAt: new Date(),
        status: 'unknown',
      },
      // Analytics
      {
        id: 'analytics-server',
        name: 'Analytics MCP Server',
        description: 'Perform data analysis and generate reports',
        version: '1.0.0',
        url: 'http://localhost:5437',
        category: 'analytics',
        capabilities: [
          {
            type: 'data_analysis',
            supported: true,
            version: '1.0',
            features: ['aggregation', 'statistics', 'visualization'],
          },
          {
            type: 'report_generation',
            supported: true,
            version: '1.0',
            features: ['pdf', 'excel', 'csv'],
          },
        ],
        authentication: {
          type: 'bearer_token',
          required: true,
        },
        documentation: 'https://analytics.example.com/docs',
        registeredAt: new Date(),
        lastCheckedAt: new Date(),
        status: 'unknown',
      },
    ];

    defaultServers.forEach((server) => this.registerServer(server));

    this.logger.info(`[MCP Registry] Loaded ${defaultServers.length} default servers`);
  }
}

// Export singleton instance
export const mcpServerRegistryService = new MCPServerRegistryService();
