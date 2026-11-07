// stdio MCP bridge. Clients that only speak stdio (Claude Desktop, Codex, Antigravity, Cursor ...) launch this process.
// It forwards every tool call to the running app (so the human sees and hears the work); if the app is not running it
// falls back to a headless Studio in this process, so an agent can still write, render and export music.
//
//   node src/mcp/stdio.ts            (from a source checkout)
//   node dist/mcp/stdio.cjs          (from the built app)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createStudio } from '../core/tools.ts';
import { buildMcpServer, SERVER_NAME, SERVER_VERSION } from './server.ts';
import { mcpInputShape, describeActions, z } from '../core/toolkit.ts';

const dataDir = process.env.MSAI_DATA ?? path.join(os.homedir(), 'Music studio');

async function connectToApp(): Promise<Client | null> {
  try {
    const ep = JSON.parse(fs.readFileSync(path.join(dataDir, '.endpoint.json'), 'utf8')) as { url: string; token: string };
    const health = await fetch(ep.url.replace(/\/mcp$/, '/health'), { signal: AbortSignal.timeout(1500) });
    if (!health.ok) return null;
    const client = new Client({ name: process.env.MSAI_CLIENT ?? 'stdio-bridge', version: SERVER_VERSION });
    await client.connect(new StreamableHTTPClientTransport(new URL(ep.url), { requestInit: { headers: { Authorization: `Bearer ${ep.token}` } } }));
    return client;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const client = await connectToApp();
  if (client) {
    // Proxy: tools and instructions come from the app, so both always match.
    const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} }, instructions: client.getInstructions() });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: (await client.listTools()).tools }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => (await client.callTool({ name: req.params.name, arguments: req.params.arguments ?? {} })) as never);
    await server.connect(new StdioServerTransport());
    process.stderr.write(`music-studio: connected to the running app\n`);
    return;
  }
  const studio = createStudio({ dataDir });
  const server = buildMcpServer(studio, () => process.env.MSAI_CLIENT ?? 'stdio');
  studio.markSeen('stdio');
  await server.connect(new StdioServerTransport());
  process.stderr.write(`music-studio: the app is not running, working headless (renders and exports still work; open the app to see and hear the session)\n`);
}

main().catch((e) => {
  process.stderr.write(`music-studio failed to start: ${(e as Error).message}\n`);
  process.exit(1);
});

export { mcpInputShape, describeActions, z };
