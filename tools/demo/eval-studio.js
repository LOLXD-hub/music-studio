(async () => {
  const m = window.__msai;
  console.log('eval: keys', Object.keys(m).join(','), 'showConnect before', m.ui.get().showConnect);
  m.connect(false);
  m.setMode('studio');
  m.setZoom(15);
  m.openClip('Violin', 0);
  await new Promise((r) => setTimeout(r, 600));
  console.log('eval: showConnect after', m.ui.get().showConnect, 'tracks', m.project.get().project.tracks.length);
})();
