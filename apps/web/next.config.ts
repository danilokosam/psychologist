import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Tailwind v4 runs as a Turbopack loader (@tailwindcss/turbopack). It was
  // installed in Milestone 0 but never registered here, so `@import
  // 'tailwindcss'` was never expanded: no utilities were generated and
  // `@theme` in globals.css failed to parse -- the app shipped unstyled.
  // Found during the Milestone 1 browser pass.
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
      },
    },
  },
};

export default withNextIntl(nextConfig);
