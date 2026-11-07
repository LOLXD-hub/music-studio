// Demo driver for `electron . --record=<dir> --driver=tools/demo/showcase.cjs`.
// An "AI" builds Glass Garden with the same tool calls as examples/glass-garden.mjs, slowed down so the app can be watched:
// the tracks appear, the deck fills, Clawd changes state. Then it listens, a person leaves feedback, the piece plays, and the settings name switch is shown.
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async ({ studio, win, opt }) => {
  const root = path.resolve(__dirname, '..', '..');
  const js = (code) => win.webContents.executeJavaScript(code).catch((e) => console.error('js', e.message));
  const clock = () => Date.now() - (globalThis.__recT0 ?? Date.now());
  const marks = {};
  const pace = Number(opt('pace') ?? 260);
  let dock = 'roll';
  const setDock = (d) => { if (dock !== d) { dock = d; return js(`window.__msai.setDock('${d}')`); } };

  const call = async (tool, args, pause = pace) => {
    // show what the call is about before it runs
    if (tool === 'effects' || tool === 'mixer') await setDock('mixer');
    const r = await studio.exec(tool, args, { source: 'mcp', client: 'Claude Code' });
    if (tool === 'compose' && ['chords', 'melody', 'bass', 'drums'].includes(args.action) && args.track) {
      await setDock('roll');
      await js(`window.__msai.openClip(${JSON.stringify(args.track)}, 0)`);
    }
    await sleep(pause);
    return r.result;
  };

  await js(`window.__msai.connect(false); window.__msai.setMode('studio'); window.__msai.setZoom(10)`);
  await sleep(2200);
  marks.connected = clock();
  studio.markSeen('Claude Code');
  studio.setAgent('thinking', 'Reading the request and choosing a form', 'agent', 2);
  await sleep(2600);

  const { build } = await import(pathToFileURL(path.join(root, 'examples', 'glass-garden.build.mjs')).toString());
  marks.buildStart = clock();
  await build(call);
  marks.buildEnd = clock();

  await setDock('roll');
  await js(`window.__msai.openClip('Violin', 0); window.__msai.setZoom(7)`);
  await sleep(800);

  // listen and critique
  await call('listen', { action: 'analyze', save_preview: false, width: 1000 }, 600);
  await call('critique', { action: 'composition' }, 900);
  await call('critique', { action: 'mix' }, 900);
  marks.listened = clock();

  // a person answers
  studio.addFeedback({ kind: 'pin', text: 'The climax arrives too early here', target: { track: 'Violins', beat: 64, bar: 17 } });
  await sleep(1400);
  studio.addFeedback({ kind: 'message', text: 'Keep the piano softer under the strings.' });
  studio.setAgent('thinking', 'Reading your notes', 'agent', 2);
  await sleep(2600);
  const fb = await call('agent', { action: 'feedback' }, 800);
  const id = fb.items?.[0]?.id ?? fb.pending?.[0]?.id;
  if (id) await call('agent', { action: 'reply', id, text: 'Moved the drums in from bar 17 to bar 19 and lowered the piano by 3 dB.' }, 600);
  await call('tracks', { action: 'update', track: 'Felt piano', vol: -7 }, 700);
  studio.setAgent('idle', 'Ready', 'agent');

  // playback of the climax
  await setDock('mixer');
  await js(`window.__msai.setZoom(5.2)`);
  await sleep(600);
  await js(`window.__msai.audio.seekBeats(64); window.__msai.audio.play()`);
  marks.playStart = clock();
  await sleep(18000);
  await js(`window.__msai.audio.pause()`);
  marks.playEnd = clock();

  // settings: the name switch
  await js(`window.__msai.ui.set({ showSettings: true })`);
  await sleep(1800);
  await js(`document.querySelectorAll('.radio')[1].click()`);
  await sleep(2200);
  await js(`document.querySelectorAll('.radio')[0].click()`);
  await sleep(1400);
  await js(`window.__msai.ui.set({ showSettings: false })`);
  await sleep(600);
  marks.end = clock();

  const dir = opt('record');
  if (dir) fs.writeFileSync(path.join(path.resolve(dir), 'marks.json'), JSON.stringify(marks, null, 1));
};
