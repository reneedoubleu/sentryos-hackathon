import * as Sentry from "@sentry/nextjs";

console.log('[Sentry Server] Initializing with DSN:', process.env.NEXT_PUBLIC_SENTRY_DSN ? 'DSN found' : 'DSN missing!');

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: true,
});

console.log('[Sentry Server] Initialized');
