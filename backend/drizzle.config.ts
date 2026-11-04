import { defineConfig } from 'drizzle-kit';

// Migrations are generated offline; runtime applies them from src/db/migrations.generated.ts.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/models/schema.ts',
  out: './drizzle',
  strict: true,
});
