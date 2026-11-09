import { z } from 'zod';

// Fail fast, with a readable error, if required configuration is missing or
// malformed -- instead of letting the app start in a broken state and fail
// confusingly later on the first request that needs the missing value.
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:');
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
