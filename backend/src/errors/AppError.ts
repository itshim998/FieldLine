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
