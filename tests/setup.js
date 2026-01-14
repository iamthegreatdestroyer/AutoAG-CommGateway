"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://autoag:autoag_secret@localhost:5432/autoag_test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'test-secret';
process.env.LOG_LEVEL = 'error';
// Mock logger to suppress logs during tests
jest.mock('./src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
    },
}));
//# sourceMappingURL=setup.js.map