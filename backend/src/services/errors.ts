export class ApplicationError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
