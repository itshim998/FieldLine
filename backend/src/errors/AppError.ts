export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    details?: unknown,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource Not Found', details?: unknown) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string = 'Validation Failed', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource Conflict', details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication Failed', details?: unknown) {
    super(message, 401, 'AUTHENTICATION_ERROR', details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden', details?: unknown) {
    super(message, 403, 'FORBIDDEN', details);
  }
}

export class AIProviderError extends AppError {
  constructor(message: string = 'AI Provider Error', details?: unknown) {
    super(message, 502, 'AI_PROVIDER_ERROR', details);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string = 'Database Operation Failed', details?: unknown) {
    super(message, 500, 'DATABASE_ERROR', details);
  }
}

export class NormalizationError extends AppError {
  public readonly fieldName: string;
  public readonly sourceValue: unknown;
  public readonly reason: string;
  public readonly rowNumber?: number;

  constructor(
    fieldName: string,
    sourceValue: unknown,
    reason: string,
    rowNumber?: number
  ) {
    const displayVal = sourceValue === undefined ? 'undefined' : sourceValue === null ? 'null' : String(sourceValue);
    const rowPrefix = rowNumber !== undefined ? `Row ${rowNumber}: ` : '';
    const message = `${rowPrefix}Could not normalize ${fieldName} '${displayVal}': ${reason}`;

    super(message, 400, 'NORMALIZATION_ERROR', {
      fieldName,
      sourceValue,
      reason,
      rowNumber
    });

    this.fieldName = fieldName;
    this.sourceValue = sourceValue;
    this.reason = reason;
    this.rowNumber = rowNumber;
  }
}

export interface ScheduleValidationIssuePayload {
  code: string;
  message: string;
  rowNumber?: number;
  field?: string;
  value?: unknown;
}

export class ScheduleValidationError extends AppError {
  public readonly issues: ScheduleValidationIssuePayload[];

  constructor(issues: ScheduleValidationIssuePayload[], message?: string) {
    const issueCount = issues.length;
    const defaultMsg =
      issueCount === 1
        ? `Schedule validation error: ${issues[0].message}`
        : `Schedule contains ${issueCount} validation error${issueCount > 1 ? 's' : ''}`;

    super(message || defaultMsg, 422, 'SCHEDULE_VALIDATION_ERROR', {
      issues
    });

    this.issues = issues;
  }
}


