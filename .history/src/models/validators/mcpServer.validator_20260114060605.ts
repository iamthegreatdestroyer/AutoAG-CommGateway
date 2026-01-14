import { z } from 'zod';

export const ServerStatusSchema = z.enum([
  'PENDING',
  'ACTIVE',
  'INACTIVE',
  'DEPRECATED',
  'REJECTED',
]);

export const VisibilitySchema = z.enum(['PUBLIC', 'PRIVATE', 'UNLISTED']);

export const PricingModelSchema = z.enum(['FREE', 'PAY_PER_CALL', 'SUBSCRIPTION', 'FREEMIUM']);

export const HealthStatusSchema = z.enum(['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN']);

export const CreateMCPServerSchema = z.object({
  name: z
    .string()
    .min(3, 'Name must be at least 3 characters')
    .max(100, 'Name must not exceed 100 characters')
    .regex(/^[a-zA-Z0-9-_]+$/, 'Name can only contain letters, numbers, hyphens and underscores'),
  displayName: z.string().min(3, 'Display name must be at least 3 characters').max(200),
  description: z.string().max(5000, 'Description too long').optional(),
  baseUrl: z.string().url('Invalid base URL'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be in semver format (e.g., 1.0.0)'),
  visibility: VisibilitySchema.default('PRIVATE'),
  pricingModel: PricingModelSchema.default('FREE'),
  pricePerCall: z.number().positive().optional(),
  subscriptionPrice: z.number().positive().optional(),
  category: z.array(z.string()).min(1, 'At least one category is required'),
  tags: z.array(z.string()).optional(),
  logoUrl: z.string().url('Invalid logo URL').optional(),
  documentationUrl: z.string().url('Invalid documentation URL').optional(),
  repositoryUrl: z.string().url('Invalid repository URL').optional(),
  licenseType: z.string().optional(),
});

export const UpdateMCPServerSchema = CreateMCPServerSchema.partial().extend({
  status: ServerStatusSchema.optional(),
  healthStatus: HealthStatusSchema.optional(),
});

export const MCPServerQuerySchema = z.object({
  status: ServerStatusSchema.optional(),
  visibility: VisibilitySchema.optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  sortBy: z.enum(['createdAt', 'updatedAt', 'rating', 'totalCalls']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateMCPServerInput = z.infer<typeof CreateMCPServerSchema>;
export type UpdateMCPServerInput = z.infer<typeof UpdateMCPServerSchema>;
export type MCPServerQueryInput = z.infer<typeof MCPServerQuerySchema>;
