import mongoose from 'mongoose';

const globalCache = globalThis;

if (!globalCache.__mongooseCache) {
  globalCache.__mongooseCache = { conn: null, promise: null };
}

export async function connectDb() {
  const cache = globalCache.__mongooseCache;
  if (cache.conn) {
    return cache.conn;
  }

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/job-url-copier';
  mongoose.set('strictQuery', true);

  if (!cache.promise) {
    cache.promise = mongoose.connect(uri).then((connection) => {
      console.log(`MongoDB connected: ${uri.replace(/\/\/.*@/, '//***@')}`);
      return connection;
    });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}
