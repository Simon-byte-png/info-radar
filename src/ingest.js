import { runIngest } from './ingest-core.js';

const args = parseArgs(process.argv.slice(2));
const result = await runIngest({
  limit: Number(args.limit || 3),
  minScore: Number(args['min-score'] || 70),
  dryRun: Boolean(args['dry-run'])
});

console.table(result.stats);

function parseArgs(argv) {
  return Object.fromEntries(argv.map((arg) => {
    if (!arg.startsWith('--')) return [arg, true];
    const [key, value] = arg.slice(2).split('=');
    return [key, value ?? true];
  }));
}
