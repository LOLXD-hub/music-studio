(async () => {
  const m = window.__msai;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const mode = (window.__shot || 'mixer');
  m.connect(mode === 'connect');
  m.setMode('studio');
  m.setZoom(window.__zoom || 7.5);
  m.openClip('Violin', 0);
  if (mode === 'mixer') { m.setDock('mixer'); }
  if (mode === 'sfx') { m.setMode('sfx'); await wait(900); const row = document.querySelector('.sfx-row'); row && row.click(); await wait(1400); }
  if (mode === 'live') { m.setMode('live'); await wait(600); }
  if (mode === 'critic') { await wait(100); const tabs = [...document.querySelectorAll('.deck .tabs button')]; tabs.find((b) => b.textContent === 'Critic')?.click(); await wait(300); [...document.querySelectorAll('.deck .btn')].find((b) => /Review/.test(b.textContent))?.click(); await wait(1200); }
  if (mode === 'settings') { m.ui.set({ showSettings: true }); await wait(300); }
  if (mode === 'menu') { await wait(100); document.querySelector('.menubar .mi')?.click(); await wait(300); }
  await wait(500);
})();
