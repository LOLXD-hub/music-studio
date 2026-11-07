// Runs every test file in this folder as its own Node process and reports a summary.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = import.meta.dirname;
const only = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'run.ts' && (only.length === 0 || only.some((o) => f.includes(o)))).sort();
let failed = 0;
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8', timeout: 600_000, maxBuffer: 1 << 26 });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${f.padEnd(24)} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (!ok) console.log((r.stdout + r.stderr).split('\n').slice(-25).join('\n'));
}
console.log(failed ? `\n${failed} of ${files.length} failed` : `\nall ${files.length} passed`);
process.exit(failed ? 1 : 0);
