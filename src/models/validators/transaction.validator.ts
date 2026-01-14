import { z } from 'zod';

export const TransactionTypeSchema = z.enum([
  'PAYMENT',
  'PAYOUT',
  'DEPOSIT',
  'WITHDRAWAL',
  'REFUND',
  'COMMISSION',
]);

export const TransactionStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
]);

export const CreateTransactionSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  serverId: z.string().uuid('Invalid server ID').optional(),
  type: TransactionTypeSchema,
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().length(3, 'Currency must be 3 characters').default('USD'),
  description: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export const UpdateTransactionSchema = z.object({
  status: TransactionStatusSchema,
  x402TxHash: z.string().optional(),
  x402Network: z.string().optional(),
  x402BlockHeight: z.number().int().positive().optional(),
});

export const TransactionQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  serverId: z.string().uuid().optional(),
  type: TransactionTypeSchema.optional(),
  status: TransactionStatusSchema.optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof UpdateTransactionSchema>;
export type TransactionQueryInput = z.infer<typeof TransactionQuerySchema>;
