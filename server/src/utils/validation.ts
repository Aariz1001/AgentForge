/**
 * Validation Utilities
 * 
 * Provides input validation and sanitization for API requests.
 */

export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class Validator {
  /**
   * Validates that a value is not null or undefined
   */
  static required<T>(value: T | null | undefined, fieldName: string): T {
    if (value === null || value === undefined) {
      throw new ValidationError(`${fieldName} is required`, fieldName);
    }
    return value;
  }

  /**
   * Validates that a string is not empty
   */
  static nonEmptyString(value: string, fieldName: string): string {
    this.required(value, fieldName);
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ValidationError(`${fieldName} must be a non-empty string`, fieldName);
    }
    return value.trim();
  }

  /**
   * Validates that a number is within a range
   */
  static numberInRange(value: number, min: number, max: number, fieldName: string): number {
    this.required(value, fieldName);
    if (typeof value !== 'number' || isNaN(value)) {
      throw new ValidationError(`${fieldName} must be a number`, fieldName);
    }
    if (value < min || value > max) {
      throw new ValidationError(`${fieldName} must be between ${min} and ${max}`, fieldName);
    }
    return value;
  }

  /**
   * Validates that a value is one of the allowed values
   */
  static oneOf<T>(value: T, allowedValues: T[], fieldName: string): T {
    this.required(value, fieldName);
    if (!allowedValues.includes(value)) {
      throw new ValidationError(
        `${fieldName} must be one of: ${allowedValues.join(', ')}`,
        fieldName
      );
    }
    return value;
  }

  /**
   * Validates an array has minimum length
   */
  static minLength<T>(arr: T[], minLength: number, fieldName: string): T[] {
    this.required(arr, fieldName);
    if (!Array.isArray(arr)) {
      throw new ValidationError(`${fieldName} must be an array`, fieldName);
    }
    if (arr.length < minLength) {
      throw new ValidationError(
        `${fieldName} must have at least ${minLength} items`,
        fieldName
      );
    }
    return arr;
  }

  /**
   * Validates a UUID format
   */
  static uuid(value: string, fieldName: string): string {
    this.nonEmptyString(value, fieldName);
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(value)) {
      throw new ValidationError(`${fieldName} must be a valid UUID`, fieldName);
    }
    return value;
  }

  /**
   * Sanitizes a string by removing potentially dangerous characters
   */
  static sanitizeString(value: string): string {
    return value
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, ''); // Remove event handlers
  }

  /**
   * Validates an email format
   */
  static email(value: string, fieldName: string): string {
    this.nonEmptyString(value, fieldName);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      throw new ValidationError(`${fieldName} must be a valid email`, fieldName);
    }
    return value;
  }
}
