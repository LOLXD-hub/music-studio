// Starts the HTTP MCP server on a throwaway data dir and talks to it with the official MCP client.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createStudio } from '../src/core/tools.ts';
import { startHttpMcp } from '../src/mcp/server.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msai-mcp-'));
const studio = createStudio({ dataDir: dir });
const mcp = await startHttpMcp(studio, { port: 39990, dataDir: dir });
console.log('listening', mcp.url);

// wrong token must be rejected
const bad = await fetch(mcp.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer nope' }, body: '{}' });
console.log('bad token ->', bad.status);
const evil = await fetch(mcp.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Authorization: `Bearer ${mcp.token}` }, body: '{}' });
console.log('foreign origin ->', evil.status);

const client = new Client({ name: 'test-client', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(mcp.url), { requestInit: { headers: { Authorization: `Bearer ${mcp.token}` } } }));
const tools = await client.listTools();
console.log('tools:', tools.tools.map((t) => t.name).join(', '));
const t = tools.tools.find((x) => x.name === 'notes')!;
console.log('notes description length', t.description?.length, 'schema props', Object.keys((t.inputSchema as { properties: object }).properties).length);
const r1 = await client.callTool({ name: 'studio', arguments: { action: 'new', name: 'MCP test', tempo: 100, key: 'C major' } });
console.log((r1.content as { text: string }[])[0].text.slice(0, 80));
await client.callTool({ name: 'tracks', arguments: { action: 'add', name: 'Keys', instrument: 'piano' } });
const r2 = await client.callTool({ name: 'notes', arguments: { action: 'add', track: 'Keys', text: 'C4:1 E4:1 G4:1 [C4 E4 G4]:1', at: '1:1' } });
console.log((r2.content as { text: string }[])[0].text.slice(0, 160).replace(/\n/g, ' '));
const r3 = await client.callTool({ name: 'notes', arguments: { action: 'add', track: 'Keys', text: 'C4:zzz' } });
console.log('error case isError =', r3.isError, '|', (r3.content as { text: string }[])[0].text.slice(0, 120));
const r4 = await client.callTool({ name: 'listen', arguments: { action: 'analyze' } });
console.log('listen content types:', (r4.content as { type: string }[]).map((c) => c.type).join(','));
console.log('agent state:', studio.agent.state, 'client:', studio.agent.client, 'activity entries:', studio.activity.length);
await client.close();
await mcp.close();
studio.dispose();
process.exit(0);
