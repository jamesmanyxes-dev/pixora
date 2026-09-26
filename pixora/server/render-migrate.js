// One-shot migration runner for Render deploy
import { migrate } from './migrate.js';
await migrate();
console.log('schema migrated');
process.exit(0);
