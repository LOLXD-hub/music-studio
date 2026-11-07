import { toast } from './state.ts';

declare global {
  interface Window {
    msai: {
      invoke(channel: string, ...args: unknown[]): Promise<any>;
      send(channel: string, payload: unknown): void;
      onEvent(cb: (name: string, payload: any) => void): () => void;
      pathForFile?(f: File): string;
      platform: string;
    };
    __msai: Record<string, any>;
  }
}

export interface ExecImage {
  mime: string;
  base64: string;
  caption?: string;
}

/** Run a Studio tool action as the human (source "ui"). Errors become toasts unless `quiet`. */
export async function exec(tool: string, args: Record<string, unknown>, opts: { quiet?: boolean } = {}): Promise<{ result: any; images: ExecImage[] } | null> {
  const r = await window.msai.invoke('exec', tool, args);
  if (!r.ok) {
    if (!opts.quiet) toast(r.error, true);
    return null;
  }
  return { result: r.result, images: r.images ?? [] };
}

export const invoke = (channel: string, ...args: unknown[]) => window.msai.invoke(channel, ...args);

export async function pickFiles(title: string, filters: { name: string; extensions: string[] }[], multi = false): Promise<string[]> {
  return window.msai.invoke('dialog-open', { title, filters, multi });
}
