import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required; copy .env.example to .env and configure PostgreSQL.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/models/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL },
  strict: true,
});
