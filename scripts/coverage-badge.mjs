/*
 * Turns the Vitest coverage summary into a shields.io endpoint document, written
 * into dist/ so it is published by our own GitHub Pages deploy.
 *
 * Why this rather than Codecov or Coveralls: the number is ours, served from our
 * own origin, and shields only renders what we publish. No account, no upload
 * token, no third party holding build data — consistent with the rest of the
 * project, where the only external services are the ones doing actual work.
 *
 * Run after `vite build`, which creates dist/.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SUMMARY = 'coverage/coverage-summary.json';
const OUT = 'dist/coverage.json';

if (!existsSync(SUMMARY)) {
  throw new Error(`${SUMMARY} is missing — run "npm run coverage" before this script.`);
}
if (!existsSync('dist')) {
  throw new Error('dist/ is missing — run "npm run build" before this script.');
}

const { total } = JSON.parse(readFileSync(SUMMARY, 'utf8'));
const pct = total.lines.pct;

// Bands, not a gradient: a badge that drifts through fifty shades tells you less
// than one that changes colour when something has actually gone wrong.
const color = pct >= 95 ? 'brightgreen' : pct >= 85 ? 'green' : pct >= 70 ? 'yellow' : 'orange';

writeFileSync(OUT, `${JSON.stringify({
  schemaVersion: 1,
  label: 'unit coverage',
  message: `${pct}%`,
  color,
}, null, 2)}\n`);

console.log(`${OUT}: ${pct}% lines, ${total.branches.pct}% branches (${color})`);
