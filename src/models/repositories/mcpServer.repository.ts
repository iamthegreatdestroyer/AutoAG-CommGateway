import { PrismaClient, MCPServer, ServerStatus, Visibility, Prisma } from '@prisma/client';
import { BaseRepository } from './base.repository';

export class MCPServerRepository extends BaseRepository<MCPServer> {
  constructor(prisma: PrismaClient) {
    super(prisma, 'mCPServer');
  }

  async findByOwner(ownerId: string): Promise<MCPServer[]> {
    return this.prisma.mCPServer.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByName(ownerId: string, name: string): Promise<MCPServer | null> {
    return this.prisma.mCPServer.findUnique({
      where: {
        ownerId_name: {
          ownerId,
          name,
        },
      },
    });
  }

  async search(params: {
    search?: string;
    category?: string;
    status?: ServerStatus;
    visibility?: Visibility;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ servers: MCPServer[]; total: number }> {
    const {
      search,
      category,
      status,
      visibility,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = params;

    const where: Prisma.MCPServerWhereInput = {
      AND: [
        status ? { status } : {},
        visibility ? { visibility } : {},
        category ? { category: { has: category } } : {},
        search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { displayName: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    };

    const [servers, total] = await Promise.all([
      this.prisma.mCPServer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          owner: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
            },
          },
          _count: {
            select: {
              tools: true,
              reviews: true,
            },
          },
        },
      }),
      this.prisma.mCPServer.count({ where }),
    ]);

    return { servers, total };
  }

  async updateHealthStatus(serverId: string, healthStatus: string): Promise<MCPServer> {
    return this.prisma.mCPServer.update({
      where: { id: serverId },
      data: {
        healthStatus: healthStatus as any,
        lastHealthCheck: new Date(),
      },
    });
  }

  async incrementCallCount(serverId: string): Promise<void> {
    await this.prisma.mCPServer.update({
      where: { id: serverId },
      data: {
        totalCalls: {
          increment: 1,
        },
      },
    });
  }

  async updateRevenue(serverId: string, amount: number): Promise<void> {
    await this.prisma.mCPServer.update({
      where: { id: serverId },
      data: {
        totalRevenue: {
          increment: amount,
        },
      },
    });
  }

  async updateStatus(serverId: string, status: ServerStatus): Promise<MCPServer> {
    return this.prisma.mCPServer.update({
      where: { id: serverId },
      data: { status },
    });
  }

  async getTopServers(limit: number = 10): Promise<MCPServer[]> {
    return this.prisma.mCPServer.findMany({
      where: {
        status: 'ACTIVE',
        visibility: 'PUBLIC',
      },
      orderBy: [{ rating: 'desc' }, { totalCalls: 'desc' }],
      take: limit,
      include: {
        owner: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });
  }
}
