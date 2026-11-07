import { contextBridge, ipcRenderer, webUtils } from 'electron';

const INVOKE = new Set([
  'snapshot', 'exec', 'asset', 'catalog', 'dialog-open', 'dialog-save', 'connect-detect', 'connect-install', 'connect-info', 'open-path',
  'settings-get', 'settings-set', 'feedback-add', 'sfx-wave', 'window-control', 'copy',
]);

contextBridge.exposeInMainWorld('msai', {
  invoke: (channel: string, ...args: unknown[]) => {
    if (!INVOKE.has(channel)) throw new Error('Blocked channel ' + channel);
    return ipcRenderer.invoke('msai:' + channel, ...args);
  },
  send: (channel: string, payload: unknown) => {
    if (channel !== 'transport-state' && channel !== 'ready') throw new Error('Blocked channel ' + channel);
    ipcRenderer.send('msai:' + channel, payload);
  },
  onEvent: (cb: (name: string, payload: unknown) => void) => {
    const h = (_e: unknown, name: string, payload: unknown) => cb(name, payload);
    ipcRenderer.on('msai:event', h);
    return () => ipcRenderer.removeListener('msai:event', h);
  },
  pathForFile: (f: File) => webUtils.getPathForFile(f),
  platform: process.platform,
});
