import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';

const app = await createApp();
await app.listen(loadConfig().PORT, '0.0.0.0');
