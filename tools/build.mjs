// Bundles the Electron app: main process, preload, render worker, MCP stdio bridge, renderer, audio worklet.
import { build, context } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(path.join(dist, 'main'), { recursive: true });
fs.mkdirSync(path.join(dist, 'renderer'), { recursive: true });
fs.mkdirSync(path.join(dist, 'mcp'), { recursive: true });

const nodeBanner = `const __import_meta_url = require('url').pathToFileURL(__filename).href;`;
const node = {
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  banner: { js: nodeBanner },
  define: { 'import.meta.url': '__import_meta_url' },
  loader: { '.wasm': 'binary' },
};

const jobs = [
  { ...node, entryPoints: [path.join(root, 'src/app/main/main.ts')], outfile: path.join(dist, 'main/main.cjs'), external: ['electron'] },
  { ...node, entryPoints: [path.join(root, 'src/app/main/preload.ts')], outfile: path.join(dist, 'main/preload.cjs'), external: ['electron'], banner: {}, define: {} },
  { ...node, entryPoints: [path.join(root, 'src/core/render-worker.ts')], outfile: path.join(dist, 'main/render-worker.cjs') },
  { ...node, entryPoints: [path.join(root, 'src/mcp/stdio.ts')], outfile: path.join(dist, 'mcp/stdio.cjs') },
  {
    platform: 'browser', format: 'iife', target: 'chrome140', bundle: true, sourcemap: true, logLevel: 'info', minify: !watch,
    entryPoints: [path.join(root, 'src/app/renderer/main.tsx')], outfile: path.join(dist, 'renderer/app.js'),
    jsx: 'automatic', jsxImportSource: 'preact', loader: { '.css': 'css' },
  },
  {
    platform: 'browser', format: 'iife', target: 'chrome140', bundle: true, sourcemap: false, logLevel: 'info', minify: !watch,
    entryPoints: [path.join(root, 'src/app/worklet/processor.ts')], outfile: path.join(dist, 'renderer/worklet.js'),
  },
];

function copyStatic() {
  fs.copyFileSync(path.join(root, 'src/app/renderer/index.html'), path.join(dist, 'renderer/index.html'));
  fs.copyFileSync(path.join(root, 'src/app/renderer/styles.css'), path.join(dist, 'renderer/styles.css'));
  const lame = path.join(root, 'node_modules/lamejs/lame.all.js');
  if (fs.existsSync(lame)) fs.copyFileSync(lame, path.join(dist, 'main/lame.all.js'));
  const skills = path.join(root, 'skills');
  if (fs.existsSync(skills)) fs.cpSync(skills, path.join(dist, 'skills'), { recursive: true });
  const assets = path.join(root, 'assets');
  if (fs.existsSync(assets)) fs.cpSync(assets, path.join(dist, 'assets'), { recursive: true });
}

if (watch) {
  for (const j of jobs) (await context(j)).watch();
  copyStatic();
  console.log('watching...');
} else {
  await Promise.all(jobs.map((j) => build(j)));
  copyStatic();
}
