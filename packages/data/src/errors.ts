export type DataErrorCode = 'not_found' | 'conflict' | 'invalid' | 'unknown';

export class DataError extends Error {
  constructor(
    readonly code: DataErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DataError';
  }
}
