import { PrismaClient, Tool } from '@prisma/client';
import { BaseRepository } from './base.repository';

export class ToolRepository extends BaseRepository<Tool> {
  constructor(prisma: PrismaClient) {
    super(prisma, 'tool');
  }

  async findByServer(serverId: string): Promise<Tool[]> {
    return this.prisma.tool.findMany({
      where: { serverId },
      orderBy: { name: 'asc' },
    });
  }

  async findByName(serverId: string, name: string): Promise<Tool | null> {
    return this.prisma.tool.findUnique({
      where: {
        serverId_name: {
          serverId,
          name,
        },
      },
    });
  }

  async incrementCallCount(toolId: string): Promise<void> {
    await this.prisma.tool.update({
      where: { id: toolId },
      data: {
        totalCalls: {
          increment: 1,
        },
      },
    });
  }

  async updateRevenue(toolId: string, amount: number): Promise<void> {
    await this.prisma.tool.update({
      where: { id: toolId },
      data: {
        totalRevenue: {
          increment: amount,
        },
      },
    });
  }

  async updateMetrics(
    toolId: string,
    responseTime: number,
    success: boolean
  ): Promise<void> {
    const tool = await this.findById(toolId);
    if (!tool) return;

    const totalCalls = Number(tool.totalCalls) + 1;
    const currentSuccessRate = tool.successRate ? Number(tool.successRate) : 0;
    const currentAvgResponseTime = tool.avgResponseTime || 0;

    // Calculate new averages
    const newSuccessRate =
      (currentSuccessRate * Number(tool.totalCalls) + (success ? 100 : 0)) / totalCalls;
    const newAvgResponseTime =
      (currentAvgResponseTime * Number(tool.totalCalls) + responseTime) / totalCalls;

    await this.prisma.tool.update({
      where: { id: toolId },
      data: {
        avgResponseTime: Math.round(newAvgResponseTime),
        successRate: newSuccessRate,
      },
    });
  }

  async getPopularTools(limit: number = 10): Promise<Tool[]> {
    return this.prisma.tool.findMany({
      orderBy: { totalCalls: 'desc' },
      take: limit,
      include: {
        server: {
          select: {
            id: true,
            name: true,
            displayName: true,
            status: true,
          },
        },
      },
    });
  }
}
