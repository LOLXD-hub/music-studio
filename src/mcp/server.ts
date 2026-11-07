// MCP server: exposes the Studio tools to any MCP client (Claude Code, Claude Desktop, Codex, Antigravity, Cursor ...).
// Two transports: Streamable HTTP on localhost (the app hosts it) and stdio (a thin bridge, see stdio.ts).

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Studio } from '../core/studio.ts';
import { mcpInputShape, describeActions } from '../core/toolkit.ts';

export const SERVER_NAME = 'music-studio';
export const SERVER_VERSION = '0.1.0';

const INSTRUCTIONS = `Music studio is a digital audio workstation with its own synthesis engine. You compose by calling tools; a human watches and listens in the app.
Start with studio {action:"status"} and studio {action:"help"} (guides: workflow, time, listen, realism, mix, sfx, mistakes).
Write music with notes {action:"add", text:"C4:1 E4:0.5 ..."} or compose {action:"chords|bass|drums|melody"}, make it human with compose {action:"perform"} and {action:"humanize"}, then LISTEN: listen {action:"analyze"} returns loudness, spectrum and a spectrogram image, critique {action:"composition"|"mix"} lists problems and fixes.
Show your state with agent {action:"status"}, post your plan with agent {action:"brief"}, and read the human's pins and messages with agent {action:"feedback"}.`;

type ContentItem = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export function buildMcpServer(studio: Studio, clientName: () => string | undefined): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  for (const def of studio.tools.values()) {
    server.registerTool(
      def.name,
      {
        title: def.name,
        description: `${def.description}\nActions:\n${describeActions(def)}`,
        inputSchema: mcpInputShape(def),
      },
      async (args: Record<string, unknown>) => {
        try {
          const { result, images } = await studio.exec(def.name, args, { source: 'mcp', client: clientName() });
          const content: ContentItem[] = [{ type: 'text', text: JSON.stringify(result, replacer, 1) }];
          for (const img of images) {
            content.push({ type: 'image', data: img.base64, mimeType: img.mime });
            if (img.caption) content.push({ type: 'text', text: img.caption });
          }
          return { content };
        } catch (e) {
          return { isError: true, content: [{ type: 'text', text: (e as Error).message }] };
        }
      },
    );
  }
  return server;
}

function replacer(_k: string, v: unknown): unknown {
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  if (v instanceof Float32Array) return `[Float32Array ${v.length}]`;
  return v;
}

export interface HttpMcp {
  port: number;
  token: string;
  url: string;
  close(): Promise<void>;
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 8 * 1024 * 1024) { reject(new Error('Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve(undefined);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/** Local Streamable-HTTP MCP endpoint at http://127.0.0.1:<port>/mcp, protected by a bearer token and Host/Origin checks. */
export async function startHttpMcp(studio: Studio, o: { port?: number; token?: string; dataDir?: string } = {}): Promise<HttpMcp> {
  const token = o.token ?? randomUUID().replace(/-/g, '');
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; client?: string }>();
  const okHost = (h: string | undefined) => !!h && /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h);
  const okOrigin = (origin: string | undefined) => !origin || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin) || origin === 'null';

  const srv = http.createServer(async (req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      if (!okHost(req.headers.host) || !okOrigin(req.headers.origin as string | undefined)) return send(403, { error: 'Forbidden host or origin' });
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/health') return send(200, { ok: true, name: SERVER_NAME, version: SERVER_VERSION });
      if (url.pathname !== '/mcp') return send(404, { error: 'Not found. The MCP endpoint is /mcp.' });
      const auth = req.headers.authorization ?? '';
      if (auth !== `Bearer ${token}`) return send(401, { error: 'Missing or wrong bearer token. Install the connection from the app (Connect your AI) to get a working configuration.' });
      const sid = req.headers['mcp-session-id'] as string | undefined;
      if (req.method === 'POST') {
        const body = await readBody(req);
        let entry = sid ? sessions.get(sid) : undefined;
        if (!entry) {
          if (sid || !isInitializeRequest(body)) return send(400, { jsonrpc: '2.0', error: { code: -32000, message: 'No valid session. Send initialize first.' }, id: null });
          const holder: { client?: string } = {};
          const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id: string): void => {
              sessions.set(id, { transport, client: holder.client });
            },
          });
          const info = (body as { params?: { clientInfo?: { name?: string } } }).params?.clientInfo;
          holder.client = info?.name;
          transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
          const server = buildMcpServer(studio, () => holder.client);
          await server.connect(transport);
          studio.markSeen(holder.client);
          await transport.handleRequest(req, res, body);
          return;
        }
        studio.markSeen(entry.client);
        await entry.transport.handleRequest(req, res, body);
        return;
      }
      if (req.method === 'GET' || req.method === 'DELETE') {
        const entry = sid ? sessions.get(sid) : undefined;
        if (!entry) return send(400, { error: 'Invalid or missing session id' });
        await entry.transport.handleRequest(req, res);
        return;
      }
      send(405, { error: 'Method not allowed' });
    } catch (e) {
      if (!res.headersSent) send(500, { error: (e as Error).message });
      else res.end();
    }
  });
  const port = await new Promise<number>((resolve, reject) => {
    const tryPort = (p: number, left: number) => {
      srv.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && left > 0) tryPort(p + 1, left - 1);
        else reject(err);
      });
      srv.listen(p, '127.0.0.1', () => resolve((srv.address() as { port: number }).port));
    };
    tryPort(o.port ?? 39871, 20);
  });
  const url = `http://127.0.0.1:${port}/mcp`;
  if (o.dataDir) {
    try {
      fs.writeFileSync(path.join(o.dataDir, '.endpoint.json'), JSON.stringify({ url, token, pid: process.pid, started: new Date().toISOString() }), { mode: 0o600 });
    } catch { /* not critical */ }
  }
  return {
    port, token, url,
    close: () => new Promise<void>((resolve) => {
      for (const s of sessions.values()) s.transport.close().catch(() => undefined);
      srv.close(() => resolve());
      srv.closeAllConnections?.();
    }),
  };
}
