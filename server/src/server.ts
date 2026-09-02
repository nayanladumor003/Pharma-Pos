import { createApp } from './app';
import { connectDB } from './config/db';
import { env } from './config/env';

async function main() {
  await connectDB();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`[server] PharmaPOS API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} received, shutting down...`);
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
