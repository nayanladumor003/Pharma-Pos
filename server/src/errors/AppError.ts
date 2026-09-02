import { ErrorCode, ErrorCodeType, httpStatusForErrorCode } from './errorCodes';

/**
 * Every intentional, expected failure (bad input, missing resource, business-rule
 * violation) should throw an AppError so the central error handler can map it to
 * the standard { success:false, error:{code,message} } envelope. Anything that
 * throws a plain Error is treated as unexpected and reported as INTERNAL_ERROR
 * without leaking its message to the client.
 */
export class AppError extends Error {
  readonly code: ErrorCodeType;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCodeType, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = httpStatusForErrorCode[code];
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  static validation(message: string, details?: unknown) {
    return new AppError(ErrorCode.VALIDATION_ERROR, message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new AppError(ErrorCode.UNAUTHORIZED, message);
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new AppError(ErrorCode.FORBIDDEN, message);
  }
  static notFound(resource: string) {
    return new AppError(ErrorCode.NOT_FOUND, `${resource} not found`);
  }
  static duplicate(message: string, details?: unknown) {
    return new AppError(ErrorCode.DUPLICATE_RESOURCE, message, details);
  }
  static insufficientStock(message = 'Insufficient stock for the selected batch') {
    return new AppError(ErrorCode.INSUFFICIENT_STOCK, message);
  }
  static expiredBatch(message = 'This batch has expired and cannot be dispensed') {
    return new AppError(ErrorCode.EXPIRED_BATCH, message);
  }
  static prescriptionRequired(message = 'A valid prescription/doctor name is required for this item') {
    return new AppError(ErrorCode.PRESCRIPTION_REQUIRED, message);
  }
  static invalidPayment(message: string) {
    return new AppError(ErrorCode.INVALID_PAYMENT, message);
  }
  static concurrentModification(message = 'This record changed elsewhere — please retry') {
    return new AppError(ErrorCode.CONCURRENT_MODIFICATION, message);
  }
}
