import { PrismaClient, User, UserRole, UserStatus } from '@prisma/client';
import { BaseRepository } from './base.repository';
import bcrypt from 'bcrypt';

export class UserRepository extends BaseRepository<User> {
  constructor(prisma: PrismaClient) {
    super(prisma, 'user');
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { username },
    });
  }

  async findByApiKey(apiKey: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { apiKey },
    });
  }

  async createUser(data: {
    email: string;
    password: string;
    username: string;
    firstName?: string;
    lastName?: string;
    role?: UserRole;
  }): Promise<User> {
    const passwordHash = await bcrypt.hash(data.password, 10);

    return this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        username: data.username,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role || 'USER',
        status: 'ACTIVE',
      },
    });
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  async updateLastLogin(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  async updateWalletBalance(userId: string, amount: number): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        walletBalance: {
          increment: amount,
        },
      },
    });
  }

  async updateStatus(userId: string, status: UserStatus): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { status },
    });
  }

  async generateApiKey(userId: string): Promise<string> {
    const apiKey = this.generateRandomApiKey();

    await this.prisma.user.update({
      where: { id: userId },
      data: { apiKey },
    });

    return apiKey;
  }

  private generateRandomApiKey(): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'sk_';
    for (let i = 0; i < 32; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  }
}
