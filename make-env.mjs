// .env → env.js, because a browser cannot read .env and there is no build step yet.
// Run: node make-env.mjs      Both files are gitignored.
// Deleted once Vite lands and import.meta.env takes over (ARCHITECTURE.md §8.2).
import { readFileSync, writeFileSync } from 'node:fs';

const key = (readFileSync('.env', 'utf8').match(/^PRIVATEMODE_AI_API_KEY=(.*)$/m)?.[1] ?? '').trim();
if (!key) throw new Error('PRIVATEMODE_AI_API_KEY is empty in .env');
writeFileSync('env.js', `globalThis.HC_DEV_API_KEY = ${JSON.stringify(key)};\n`);
console.log('env.js written');
