// Fills the studio the way an agent would (source "mcp") so the UI can be screenshotted with real content.
module.exports = async ({ studio }) => {
  const call = (tool, args) => studio.exec(tool, args, { source: 'mcp', client: 'Claude Code' });
  studio.markSeen('Claude Code');
  await call('studio', { action: 'new', name: 'Glass Garden', tempo: 84, key: 'A minor' });
  await call('agent', { action: 'brief', title: 'Glass Garden', genre: 'Neo-classical', mood: 'wistful, slowly opening', key: 'A minor', tempo: 84, form: ['Intro', 'Theme', 'Development', 'Climax', 'Resolution'], notes: 'Felt piano carries the theme, cellos hold the harmony, a solo violin answers. Drums only enter in the climax.', steps: [{ text: 'Chords and bass', done: true }, { text: 'Theme on violin', done: true }, { text: 'Drums for the climax', done: false }, { text: 'Mix and check', done: false }] });
  const prog = await call('theory', { action: 'progression', key: 'A minor', bars: 8, style: 'cinematic', mood: 'dark', count: 1, cadence: 'authentic' });
  const chords = prog.result.options[0].chords;
  await call('tracks', { action: 'add', name: 'Piano', instrument: 'piano', preset: 'Felt / mellow', vol: -4 });
  await call('tracks', { action: 'add', name: 'Cellos', instrument: 'wind_string', preset: 'Cellos (section)', vol: -8 });
  await call('tracks', { action: 'add', name: 'Bass', instrument: 'plucked', preset: 'Finger bass', vol: -6 });
  await call('tracks', { action: 'add', name: 'Violin', instrument: 'wind_string', preset: 'Violin (solo)', vol: -6 });
  await call('tracks', { action: 'add', name: 'Drums', instrument: 'drums', preset: 'Acoustic kit', vol: -7 });
  await call('tracks', { action: 'add', name: 'Hall', kind: 'bus' });
  await call('effects', { action: 'add', track: 'Hall', type: 'reverb', preset: 'Concert hall', params: { mix: 1 } });
  for (const t of ['Piano', 'Cellos', 'Violin']) await call('effects', { action: 'send', track: t, to: 'Hall', level: -10 });
  await call('compose', { action: 'chords', track: 'Piano', progression: chords, bars: 16, style: 'ballad', voices: 4 });
  await call('compose', { action: 'chords', track: 'Cellos', style: 'sustain', voices: 3, range_lo: 'A2', range_hi: 'E4' });
  await call('compose', { action: 'bass', track: 'Bass', style: 'root-fifth' });
  await call('compose', { action: 'melody', track: 'Violin', start: '3:1', bars: 12, density: 0.45, contour: 'arch', seed: 7 });
  await call('compose', { action: 'drums', track: 'Drums', style: 'half', start: '9:1', sections: [{ bars: 4, intensity: 0.4 }, { bars: 4, intensity: 0.8, ride: true }] });
  for (const t of ['Piano', 'Cellos', 'Bass', 'Violin', 'Drums']) await call('compose', { action: 'perform', track: t });
  await call('compose', { action: 'mark_form', form: 'cinematic-build' });
  await call('critique', { action: 'composition' });
  studio.setAgent('mixing', 'Balancing the strings against the piano', 'mixer', 600);
  studio.addFeedback({ kind: 'pin', text: 'Violin enters too early here', target: { track: 'Violin', beat: 12, bar: 4 } });
  studio.addFeedback({ kind: 'message', text: 'Make the climax bigger, but keep the piano soft.' });
};
