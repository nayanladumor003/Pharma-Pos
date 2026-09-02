import { Router } from 'express';
import mongoose from 'mongoose';
import { sendSuccess } from '../utils/response';

export const healthRouter = Router();

const dbStateNames: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting'
};

healthRouter.get('/', (_req, res) => {
  sendSuccess(res, {
    status: 'ok',
    db: dbStateNames[mongoose.connection.readyState] ?? 'unknown',
    timestamp: new Date().toISOString()
  });
});
