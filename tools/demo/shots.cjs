// Driver for the README screenshots: builds the whole Glass Garden project through tool calls, without pacing.
const path = require('node:path');
const { pathToFileURL } = require('node:url');

module.exports = async ({ studio }) => {
  const root = path.resolve(__dirname, '..', '..');
  let n = 0;
  const call = async (tool, args) => { console.log('call', ++n, tool, args.action); return (await studio.exec(tool, args, { source: 'mcp', client: 'Claude Code' })).result; };
  studio.markSeen('Claude Code');
  const { build } = await import(pathToFileURL(path.join(root, 'examples', 'glass-garden.build.mjs')).toString());
  await build(call);
  await call('critique', { action: 'composition' });
  await call('critique', { action: 'mix' });
  studio.addFeedback({ kind: 'pin', text: 'The climax arrives too early here', target: { track: 'Violins', beat: 64, bar: 17 } });
  studio.addFeedback({ kind: 'message', text: 'Keep the piano softer under the strings.' });
  studio.setAgent('listening', 'Reading the spectrogram of bars 17-24', 'listen', 600);
};
