import { z } from 'zod';

export const CreateToolSchema = z.object({
  serverId: z.string().uuid('Invalid server ID'),
  name: z
    .string()
    .min(3, 'Name must be at least 3 characters')
    .max(100, 'Name must not exceed 100 characters')
    .regex(/^[a-zA-Z0-9-_]+$/, 'Name can only contain letters, numbers, hyphens and underscores'),
  displayName: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  inputSchema: z.record(z.any()), // JSON Schema object
  outputSchema: z.record(z.any()).optional(),
  examples: z.array(z.record(z.any())).optional(),
  pricePerCall: z.number().positive().optional(),
});

export const UpdateToolSchema = CreateToolSchema.partial().omit({ serverId: true });

export const ToolInvocationSchema = z.object({
  toolId: z.string().uuid('Invalid tool ID'),
  inputData: z.record(z.any()),
  userId: z.string().uuid().optional(),
});

export type CreateToolInput = z.infer<typeof CreateToolSchema>;
export type UpdateToolInput = z.infer<typeof UpdateToolSchema>;
export type ToolInvocationInput = z.infer<typeof ToolInvocationSchema>;
