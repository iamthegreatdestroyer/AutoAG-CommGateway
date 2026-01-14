import { z } from 'zod';

export const CreateReviewSchema = z.object({
  serverId: z.string().uuid('Invalid server ID'),
  userId: z.string().uuid('Invalid user ID'),
  rating: z.number().int().min(1, 'Rating must be at least 1').max(5, 'Rating cannot exceed 5'),
  title: z.string().max(200, 'Title too long').optional(),
  comment: z.string().max(2000, 'Comment too long').optional(),
});

export const UpdateReviewSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  title: z.string().max(200).optional(),
  comment: z.string().max(2000).optional(),
});

export const ReviewQuerySchema = z.object({
  serverId: z.string().uuid().optional(),
  rating: z.number().int().min(1).max(5).optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export type CreateReviewInput = z.infer<typeof CreateReviewSchema>;
export type UpdateReviewInput = z.infer<typeof UpdateReviewSchema>;
export type ReviewQueryInput = z.infer<typeof ReviewQuerySchema>;
