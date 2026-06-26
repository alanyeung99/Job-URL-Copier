import 'dotenv/config';
import { connectDb } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const app = createApp();

async function start() {
  await connectDb();
  app.listen(port, () => {
    console.log(`Job URL Copier API listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start backend:', error);
  process.exit(1);
});
