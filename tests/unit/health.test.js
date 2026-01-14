"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_1 = __importDefault(require("../../src/index"));
describe('Health Endpoint', () => {
    it('should return health status', async () => {
        const response = await (0, supertest_1.default)(index_1.default).get('/health');
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('status');
        expect(response.body).toHaveProperty('timestamp');
        expect(response.body).toHaveProperty('uptime');
        expect(response.body).toHaveProperty('services');
    });
    it('should include service health checks', async () => {
        const response = await (0, supertest_1.default)(index_1.default).get('/health');
        expect(response.body.services).toHaveProperty('api');
        expect(response.body.services).toHaveProperty('database');
        expect(response.body.services).toHaveProperty('redis');
        expect(response.body.services.api).toBe('healthy');
    });
});
//# sourceMappingURL=health.test.js.map