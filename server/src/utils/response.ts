/**
 * Response Utilities
 * 
 * Standardized API response formatting and error handling.
 */

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
  timestamp: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
  trace_id?: string;
}

export class ResponseBuilder {
  /**
   * Builds a success response
   */
  static success<T>(data: T): ApiResponse<T> {
    return {
      success: true,
      data,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Builds an error response
   */
  static error(code: string, message: string, details?: Record<string, any>, traceId?: string): ApiResponse {
    return {
      success: false,
      error: {
        code,
        message,
        details,
        trace_id: traceId
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Builds a validation error response
   */
  static validationError(field: string, message: string): ApiResponse {
    return this.error('VALIDATION_ERROR', message, { field });
  }

  /**
   * Builds a not found error response
   */
  static notFound(resource: string, id: string): ApiResponse {
    return this.error('NOT_FOUND', `${resource} not found`, { id });
  }

  /**
   * Builds an unauthorized error response
   */
  static unauthorized(message: string = 'Unauthorized'): ApiResponse {
    return this.error('UNAUTHORIZED', message);
  }

  /**
   * Builds a forbidden error response
   */
  static forbidden(message: string = 'Forbidden'): ApiResponse {
    return this.error('FORBIDDEN', message);
  }

  /**
   * Builds a rate limit error response
   */
  static rateLimitExceeded(retryAfter?: number): ApiResponse {
    return this.error('RATE_LIMIT_EXCEEDED', 'Too many requests', {
      retry_after: retryAfter
    });
  }

  /**
   * Builds an internal server error response
   */
  static internalError(error?: Error, traceId?: string): ApiResponse {
    return this.error(
      'INTERNAL_ERROR',
      'An internal error occurred',
      error ? { error: error.message } : undefined,
      traceId
    );
  }
}
