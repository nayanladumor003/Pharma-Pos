import dns from 'dns';
import mongoose from 'mongoose';
import { env } from './env';

// Some Windows/OS DNS resolver configs fail Node's SRV lookups (used by
// mongodb+srv:// URIs) even though plain DNS works fine otherwise. Pointing
// Node at public resolvers avoids spurious ECONNREFUSED on the SRV query.
dns.setServers(['8.8.8.8', '1.1.1.1']);

mongoose.set('strictQuery', true);

let connected = false;

export async function connectDB(): Promise<typeof mongoose> {
  if (connected) return mongoose;

  mongoose.connection.on('error', (err) => {
    console.error('[mongo] connection error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    connected = false;
    console.warn('[mongo] disconnected');
  });

  await mongoose.connect(env.MONGODB_URI);
  connected = true;
  console.log(`[mongo] connected (db: ${mongoose.connection.name})`);
  return mongoose;
}

export async function disconnectDB(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}
