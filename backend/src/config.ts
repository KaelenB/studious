import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL: z
    .url()
    .refine(
      (value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
      'DATABASE_URL must be a PostgreSQL connection URL',
    ),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(
      z.array(
        z
          .url()
          .refine(
            (origin) => new URL(origin).origin === origin,
            'CORS_ORIGINS entries must be exact origins such as https://user.github.io',
          ),
      ),
    ),
});

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  return configSchema.parse(environment);
}
