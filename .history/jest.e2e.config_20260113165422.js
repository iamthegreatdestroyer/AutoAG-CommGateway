module.exports = {
  ...require('./jest.config'),
  roots: ['<rootDir>/tests/e2e'],
  testMatch: ['**/*.test.ts'],
  testTimeout: 60000,
};
