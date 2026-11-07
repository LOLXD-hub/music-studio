import { app, BrowserWindow, ipcMain, protocol, net, dialog, shell, clipboard, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createStudio } from '../../core/tools.ts';
import { setRenderWorkerPath } from '../../core/studio.ts';
import type { Studio } from '../../core/studio.ts';
import { startHttpMcp } from '../../mcp/server.ts';
import type { HttpMcp } from '../../mcp/server.ts';
import { INSTRUMENT_DEFS } from '../../engine/instruments/index.ts';
import { FX_DEFS } from '../../engine/fx/index.ts';
import { familyParams } from '../../sfx/catalog.ts';
import { detectClients, installMcp, installSkill, configSnippets } from './connect.ts';
import type { ConnectEnv } from './connect.ts';

const argv = process.argv.slice(1);
const opt = (name: string): string | undefined => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

if (opt('record')) app.commandLine.appendSwitch('mute-audio');
if (opt('capture') || opt('record')) {
  // an off-screen window keeps painting; a hidden one would hand back a stale frame
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}

protocol.registerSchemesAsPrivileged([{ scheme: 'msai', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const dataDir = process.env.MSAI_DATA ?? path.join(os.homedir(), 'Music studio');
fs.mkdirSync(dataDir, { recursive: true });
const rendererDir = path.join(__dirname, '..', 'renderer');
setRenderWorkerPath(path.join(__dirname, 'render-worker.cjs').replace('app.asar', 'app.asar.unpacked'));

interface Settings {
  token: string;
  port: number;
  onboarded: boolean;
  lastProject?: string;
}

const settingsFile = path.join(dataDir, '.settings.json');
function loadSettings(): Settings {
  try {
    return { token: randomUUID().replace(/-/g, ''), port: 39871, onboarded: false, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) };
  } catch {
    return { token: randomUUID().replace(/-/g, ''), port: 39871, onboarded: false };
  }
}
let settings = loadSettings();
const saveSettings = () => fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 1), { mode: 0o600 });
saveSettings();

let studio: Studio;
let mcp: HttpMcp | null = null;
let win: BrowserWindow | null = null;

function send(name: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send('msai:event', name, payload);
}

function connectEnv(): ConnectEnv {
  const bridge = path.join(__dirname, '..', 'mcp', 'stdio.cjs').replace('app.asar', 'app.asar.unpacked');
  return {
    url: mcp?.url ?? `http://127.0.0.1:${settings.port}/mcp`,
    token: settings.token,
    stdioCommand: process.execPath,
    stdioArgs: [bridge],
    skillSource: path.join(__dirname, '..', 'skills', 'music-studio').replace('app.asar', 'app.asar.unpacked'),
    dataDir,
  };
}

function wireStudio(): void {
  for (const ev of ['change', 'replaced', 'activity', 'agent', 'feedback', 'transport', 'audition', 'audition-note', 'asset', 'saved', 'transport-state']) {
    studio.on(ev, (payload: unknown) => send(ev, payload));
  }
}

function registerIpc(): void {
  ipcMain.handle('msai:snapshot', () => ({
    snap: studio.snapshot(),
    activity: studio.activity.slice(-250),
    agent: studio.agent,
    feedback: studio.feedback,
    endpoint: { url: mcp?.url, token: settings.token },
    onboarded: settings.onboarded,
    sfx: studio.sfx.count(),
    dataDir,
    version: app.getVersion(),
    platform: process.platform,
    projectPath: studio.projectPath,
    historyLength: studio.historyLength(),
  }));
  ipcMain.handle('msai:exec', async (_e, tool: string, args: Record<string, unknown>, source?: string) => {
    try {
      const { result, images } = await studio.exec(tool, args, { source: source === 'cli' ? 'cli' : 'ui' });
      return { ok: true, result, images };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
  ipcMain.handle('msai:asset', (_e, id: string) => {
    const a = studio.assets.get(id);
    return a ? { channels: a.data.channels, sampleRate: a.data.sampleRate } : null;
  });
  ipcMain.handle('msai:sfx-wave', async (_e, id: string) => {
    const r = await studio.sfx.render(id, 44100);
    return { L: r.L, R: r.R, sampleRate: r.sr };
  });
  ipcMain.handle('msai:catalog', () => ({
    instruments: INSTRUMENT_DEFS.map((d) => ({ type: d.type, name: d.name, category: d.category, description: d.description, range: d.range, polyphony: d.polyphony, presets: Object.keys(d.presets), presetValues: d.presets, articulations: d.articulations ?? [], params: d.params })),
    effects: FX_DEFS.map((d) => ({ type: d.type, name: d.name, category: d.category, description: d.description, presets: Object.keys(d.presets ?? {}), presetValues: d.presets ?? {}, params: d.params })),
    sfxFamilies: Object.fromEntries(studio.sfx.families().map((f) => [f.id, familyParams(f.id)])),
  }));
  ipcMain.handle('msai:dialog-open', async (_e, o: { title?: string; filters?: { name: string; extensions: string[] }[]; multi?: boolean; dir?: boolean }) => {
    const r = await dialog.showOpenDialog(win!, { title: o.title, filters: o.filters, properties: [o.dir ? 'openDirectory' : 'openFile', ...(o.multi ? (['multiSelections'] as const) : [])] });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('msai:dialog-save', async (_e, o: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const r = await dialog.showSaveDialog(win!, { title: o.title, defaultPath: o.defaultPath, filters: o.filters });
    return r.canceled ? null : r.filePath;
  });
  ipcMain.handle('msai:connect-detect', () => detectClients());
  ipcMain.handle('msai:connect-install', (_e, o: { client: string; what: 'skill' | 'mcp' | 'both' }) => {
    const env = connectEnv();
    const done: string[] = [];
    try {
      if (o.what === 'skill' || o.what === 'both') done.push(...installSkill(o.client, env));
      if (o.what === 'mcp' || o.what === 'both') done.push(installMcp(o.client, env));
      return { ok: true, written: done };
    } catch (e) {
      return { ok: false, error: (e as Error).message, written: done };
    }
  });
  ipcMain.handle('msai:connect-info', () => ({ env: connectEnv(), snippets: configSnippets(connectEnv()), skillFolder: connectEnv().skillSource }));
  ipcMain.handle('msai:open-path', (_e, p: string) => {
    if (fs.existsSync(p)) shell.showItemInFolder(p);
    else shell.openPath(path.dirname(p));
  });
  ipcMain.handle('msai:copy', (_e, text: string) => clipboard.writeText(text));
  ipcMain.handle('msai:settings-get', () => ({ ...settings, token: undefined }));
  ipcMain.handle('msai:settings-set', (_e, patch: Partial<Settings>) => {
    settings = { ...settings, ...patch, token: settings.token };
    saveSettings();
    return true;
  });
  ipcMain.handle('msai:feedback-add', (_e, f: Parameters<Studio['addFeedback']>[0]) => studio.addFeedback(f));
  ipcMain.on('msai:transport-state', (_e, st) => studio.reportTransport({ ...st, uiConnected: true }));
}

function createWindow(): void {
  const wopt = opt('size')?.split('x').map(Number);
  win = new BrowserWindow({
    width: wopt?.[0] ?? 1560,
    height: wopt?.[1] ?? 940,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#1e2327',
    title: 'Music studio',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#363e45', symbolColor: '#aab4bb', height: 28 },
    show: true,
    ...(opt('capture') || opt('record') ? { x: -((wopt?.[0] ?? 1560) + 300), y: 20 } : {}),
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win?.webContents.toggleDevTools();
  });
  win.webContents.on('console-message', (e) => {
    if (opt('capture') || opt('record') || process.env.MSAI_DEBUG) console.log(`[renderer ${e.level}]`, e.message);
  });
  win.loadURL('msai://app/index.html');
  win.on('closed', () => {
    win = null;
  });
}

async function runCapture(): Promise<void> {
  const out = opt('capture');
  if (!out || !win) return;
  await loaded();
  const evalFile = opt('eval');
  await new Promise((r) => setTimeout(r, Number(opt('wait') ?? 1500)));
  if (evalFile) {
    const code = fs.readFileSync(evalFile, 'utf8');
    try {
      await win.webContents.executeJavaScript(code, true);
    } catch (e) {
      console.log('[eval error]', (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, Number(opt('after') ?? 1200)));
  }
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  console.log('captured', out, img.getSize());
  app.quit();
}

function loaded(): Promise<void> {
  const wc = win!.webContents;
  return wc.isLoading() ? new Promise<void>((r) => wc.once('did-finish-load', () => r())) : Promise.resolve();
}

/** Writes numbered JPEG frames and their timestamps while the driver runs, for the demo video. */
async function runRecord(driverDone: Promise<void>): Promise<void> {
  const dir = path.resolve(opt('record')!);
  fs.mkdirSync(dir, { recursive: true });
  const stamps: number[] = [];
  let finished = false;
  const t0 = Date.now();
  (globalThis as { __recT0?: number }).__recT0 = t0;
  let size = { width: 0, height: 0 };
  const tail = Number(opt('after') ?? 1500);
  driverDone.catch((e) => console.error('driver failed', e)).finally(() => setTimeout(() => { finished = true; }, tail));
  while (!finished && win) {
    const img = await win.webContents.capturePage();
    size = img.getSize();
    fs.writeFileSync(path.join(dir, 'f' + String(stamps.length).padStart(5, '0') + '.jpg'), img.toJPEG(90));
    stamps.push(Date.now() - t0);
  }
  fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify({ stamps, ...size }));
  console.log('recorded', stamps.length, 'frames,', ((Date.now() - t0) / 1000).toFixed(1), 's', size);
  app.quit();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock && !opt('capture') && !opt('record')) app.quit();
else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    protocol.handle('msai', (req) => {
      const u = new URL(req.url);
      let rel = decodeURIComponent(u.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = path.normalize(path.join(rendererDir, rel));
      if (!file.startsWith(rendererDir)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });
    studio = createStudio({ dataDir });
    wireStudio();
    try {
      mcp = await startHttpMcp(studio, { port: settings.port, token: settings.token, dataDir });
      settings.port = mcp.port;
      saveSettings();
    } catch (e) {
      console.error('MCP server failed to start:', e);
    }
    registerIpc();
    if (settings.lastProject && fs.existsSync(settings.lastProject) && !opt('capture') && !opt('record')) {
      try {
        await studio.openProject(settings.lastProject);
      } catch { /* start empty */ }
    }
    studio.on('saved', (f: string) => {
      settings.lastProject = f;
      saveSettings();
    });
    setInterval(() => {
      if (studio.dirty && studio.project.tracks.length) studio.saveProject(path.join(dataDir, 'Projects', 'autosave.msai')).catch(() => undefined);
    }, 60000).unref();
    createWindow();
    const runDriver = async (): Promise<void> => {
      if (!opt('driver')) return;
      // a script that drives the studio from the main process (used for demos and screenshots)
      const driver = await import(pathToFileURL(path.resolve(opt('driver')!)).toString()).catch(() => require(path.resolve(opt('driver')!)));
      await (driver.default ?? driver.run)?.({ studio, win, send, app, opt });
    };
    if (opt('record')) {
      await loaded();
      await new Promise((r) => setTimeout(r, 1800));
      await runRecord(runDriver());
    } else {
      await runDriver();
      runCapture();
    }
  });
  app.on('window-all-closed', () => {
    mcp?.close();
    app.quit();
  });
}
