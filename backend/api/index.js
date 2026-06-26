import { connectDb } from '../src/db.js';
import { createApp } from '../src/app.js';

let appPromise;

async function getApp() {
  if (!appPromise) {
    appPromise = connectDb().then(() => createApp());
  }
  return appPromise;
}

export default async function handler(req, res) {
  const app = await getApp();
  return app(req, res);
}
