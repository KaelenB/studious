/** Errors raised by SQLite drivers, normalised so the HTTP layer works the same in Node and browsers. */
export class DatabaseConstraintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConstraintError';
  }
}

export class StorageLimitError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`Storage limit of ${Math.round(limitBytes / 1024 / 1024)} MiB reached.`);
    this.name = 'StorageLimitError';
  }
}

/** Maps a SQLite primary result code (the low byte of an extended code) to a normalised error. */
export function sqliteError(code: number | undefined, message: string, limitBytes: number) {
  const primary = (code ?? 0) & 0xff;
  if (primary === 19) return new DatabaseConstraintError(message);
  if (primary === 13) return new StorageLimitError(limitBytes);
  return undefined;
}

export function databaseError(error: unknown) {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (current instanceof DatabaseConstraintError || current instanceof StorageLimitError)
      return current;
  }
  return undefined;
}
