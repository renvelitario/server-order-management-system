import 'dotenv/config';
import { refreshDemoData } from './src/utils/demoData.js';

async function main() {
  try {
    await refreshDemoData();
    console.log('Demo data refresh complete.');
    process.exit(0);
  } catch (error) {
    console.error('Failed to refresh demo data:', error);
    process.exit(1);
  }
}

void main();
