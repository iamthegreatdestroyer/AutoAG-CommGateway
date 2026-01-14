import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '../../src/models/repositories';
import bcrypt from 'bcrypt';

describe('UserRepository', () => {
  beforeAll(async () => {
    await db.connect();
  });

  afterAll(async () => {
    // Cleanup test data
    await db.prisma.user.deleteMany({
      where: { email: { contains: '@test.repository' } },
    });
    await db.disconnect();
  });

  describe('createUser', () => {
    it('should create a new user with hashed password', async () => {
      const userData = {
        email: 'test@test.repository.com',
        password: 'TestPassword123!',
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
      };

      const user = await db.users.createUser(userData);

      expect(user.id).toBeDefined();
      expect(user.email).toBe(userData.email);
      expect(user.username).toBe(userData.username);
      expect(user.passwordHash).not.toBe(userData.password);
      expect(user.role).toBe('USER');
      expect(user.status).toBe('ACTIVE');
    });

    it('should fail to create user with duplicate email', async () => {
      const userData = {
        email: 'duplicate@test.repository.com',
        password: 'TestPassword123!',
        username: 'duplicate1',
      };

      await db.users.createUser(userData);

      await expect(
        db.users.createUser({ ...userData, username: 'duplicate2' })
      ).rejects.toThrow();
    });
  });

  describe('findByEmail', () => {
    it('should find user by email', async () => {
      const userData = {
        email: 'findemail@test.repository.com',
        password: 'TestPassword123!',
        username: 'findemail',
      };

      await db.users.createUser(userData);
      const user = await db.users.findByEmail(userData.email);

      expect(user).not.toBeNull();
      expect(user?.email).toBe(userData.email);
    });

    it('should return null for non-existent email', async () => {
      const user = await db.users.findByEmail('nonexistent@test.repository.com');
      expect(user).toBeNull();
    });
  });

  describe('verifyPassword', () => {
    it('should verify correct password', async () => {
      const userData = {
        email: 'password@test.repository.com',
        password: 'TestPassword123!',
        username: 'passwordtest',
      };

      const user = await db.users.createUser(userData);
      const isValid = await db.users.verifyPassword(user, userData.password);

      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const userData = {
        email: 'password2@test.repository.com',
        password: 'TestPassword123!',
        username: 'passwordtest2',
      };

      const user = await db.users.createUser(userData);
      const isValid = await db.users.verifyPassword(user, 'WrongPassword123!');

      expect(isValid).toBe(false);
    });
  });

  describe('generateApiKey', () => {
    it('should generate unique API key', async () => {
      const userData = {
        email: 'apikey@test.repository.com',
        password: 'TestPassword123!',
        username: 'apikeytest',
      };

      const user = await db.users.createUser(userData);
      const apiKey = await db.users.generateApiKey(user.id);

      expect(apiKey).toBeDefined();
      expect(apiKey).toMatch(/^sk_[A-Za-z0-9]{32}$/);

      const updatedUser = await db.users.findById(user.id);
      expect(updatedUser?.apiKey).toBe(apiKey);
    });
  });

  describe('updateWalletBalance', () => {
    it('should increment wallet balance', async () => {
      const userData = {
        email: 'wallet@test.repository.com',
        password: 'TestPassword123!',
        username: 'wallettest',
      };

      const user = await db.users.createUser(userData);
      await db.users.updateWalletBalance(user.id, 50.0);
      await db.users.updateWalletBalance(user.id, 25.50);

      const updatedUser = await db.users.findById(user.id);
      expect(Number(updatedUser?.walletBalance)).toBe(75.50);
    });

    it('should decrement wallet balance with negative amount', async () => {
      const userData = {
        email: 'wallet2@test.repository.com',
        password: 'TestPassword123!',
        username: 'wallettest2',
      };

      const user = await db.users.createUser(userData);
      await db.users.updateWalletBalance(user.id, 100.0);
      await db.users.updateWalletBalance(user.id, -30.0);

      const updatedUser = await db.users.findById(user.id);
      expect(Number(updatedUser?.walletBalance)).toBe(70.0);
    });
  });
});
