module.exports = {
  ...require('./jest.config'),
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/*.test.ts'],
  testTimeout: 30000,
};
