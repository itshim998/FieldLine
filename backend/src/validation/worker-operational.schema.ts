import { z } from 'zod';
import { ActivityRiskClassification } from '../models/domain.types.js';

export const workerOperationalParamsSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required')
});

export const workerOperationalQuerySchema = z.object({
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional(),
  locationFilter: z.string().optional(),
  statusFilter: z
    .enum(['ALL', 'ON_TRACK', 'AT_RISK', 'DELAYED', 'COMPLETED', 'AHEAD'])
    .optional(),
  horizonDays: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(30)
    .default(3),
  scope: z
    .enum(['horizon', 'today', 'upcoming', 'delayed', 'all'])
    .default('horizon')
});

export type WorkerOperationalParamsDto = z.infer<typeof workerOperationalParamsSchema>;
export type WorkerOperationalQueryDto = z.infer<typeof workerOperationalQuerySchema>;

export interface OperationalTaskItem {
  id: string;
  externalId: string;
  name: string;
  description: string | null;
  location: string | null;
  plannedStart: string;
  plannedFinish: string;
  plannedQuantity: number | null;
  unit: string | null;
  plannedProgress: number;
  actualProgress: number;
  status: ActivityRiskClassification;
  statusLabel: string;
  isToday: boolean;
  isUpcoming: boolean;
  isOverdue: boolean;
  isCompleted: boolean;
}

export interface OperationalTaskSummary {
  total: number;
  today: number;
  upcoming: number;
  completed: number;
  delayed: number;
  atRisk: number;
  onTrack: number;
}

export interface OperationalTaskListResponse {
  projectId: string;
  asOfDate: string;
  tasks: OperationalTaskItem[];
  summary: OperationalTaskSummary;
}

export const workerQuickReportSchema = z.object({
  reportDate: z
    .string({ required_error: 'Report date is required' })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Report date must be in YYYY-MM-DD format'),
  activityId: z.string().trim().min(1).nullable().optional(),
  actualQuantity: z.number().min(0).nullable().optional(),
  quantityUnit: z.string().trim().nullable().optional(),
  progressPercent: z.number().min(0).max(100).nullable().optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
  reporterName: z
    .string({ required_error: 'Reporter name is required for field attribution' })
    .trim()
    .min(1, 'Reporter name cannot be empty'),
  reporterRole: z.string().trim().nullable().optional(),
  sourceType: z.enum(['manual', 'voice', 'image']).default('manual')
});

export type WorkerQuickReportDto = z.infer<typeof workerQuickReportSchema>;

export interface WorkerQuickReportResponseDto {
  status: 'confirmed' | 'awaiting_review' | 'received';
  message: string;
  progressUpdate: Record<string, any>;
  match?: Record<string, any> | null;
  activityProgress?: Record<string, any> | null;
  derivedPercent?: number | null;
}

