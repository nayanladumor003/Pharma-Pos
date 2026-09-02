import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { env } from './config/env';
import { apiRouter } from './routes';
import { notFoundHandler } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { generalRateLimiter } from './middleware/rateLimit';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  if (!env.isTest) {
    app.use(morgan(env.isProduction ? 'combined' : 'dev'));
  }

  app.use(generalRateLimiter);

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
