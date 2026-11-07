// "Connect your AI": detects installed AI clients, writes their MCP configuration and installs the Music studio skill.
// Paths follow each client's documented layout. Where a client changed layouts between versions, every existing location is written.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ClientInfo {
  id: string;
  name: string;
  detected: boolean;
  skillInstalled: boolean;
  mcpConfigured: boolean;
  skillPaths: string[];
  note: string;
  transport: 'stdio' | 'http';
}

export interface ConnectEnv {
  url: string;
  token: string;
  /** Absolute path of the stdio bridge script and the node binary command to run it. */
  stdioCommand: string;
  stdioArgs: string[];
  skillSource: string;
  dataDir: string;
}

const home = os.homedir();
const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
const SKILL = 'music-studio';

interface ClientDef {
  id: string;
  name: string;
  detect: string[];
  skillRoots: string[];
  /** Config file for MCP servers, with its format. */
  mcp?: { file: string; kind: 'claude-json' | 'json-mcpServers' | 'codex-toml' | 'claude-desktop' };
  note: string;
  transport: 'stdio' | 'http';
}

function defs(): ClientDef[] {
  const claudeDesktop = process.platform === 'win32' ? path.join(appData, 'Claude') : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Claude') : path.join(home, '.config', 'Claude');
  return [
    { id: 'claude-code', name: 'Claude Code', detect: [path.join(home, '.claude'), path.join(home, '.claude.json')], skillRoots: [path.join(home, '.claude', 'skills')], mcp: { file: path.join(home, '.claude.json'), kind: 'claude-json' }, note: 'Skill goes to ~/.claude/skills. The MCP server is added for your user account.', transport: 'http' },
    { id: 'claude-desktop', name: 'Claude Desktop', detect: [claudeDesktop], skillRoots: [], mcp: { file: path.join(claudeDesktop, 'claude_desktop_config.json'), kind: 'claude-desktop' }, note: 'Adds the MCP server to claude_desktop_config.json. Restart Claude Desktop afterwards. Upload the skill from the folder shown if you want it in a chat project.', transport: 'stdio' },
    { id: 'codex', name: 'Codex (ChatGPT)', detect: [path.join(home, '.codex')], skillRoots: [path.join(home, '.codex', 'skills')], mcp: { file: path.join(home, '.codex', 'config.toml'), kind: 'codex-toml' }, note: 'Skill goes to ~/.codex/skills, MCP server to ~/.codex/config.toml.', transport: 'stdio' },
    { id: 'antigravity', name: 'Antigravity', detect: [path.join(home, '.gemini')], skillRoots: [path.join(home, '.gemini', 'antigravity', 'skills'), path.join(home, '.gemini', 'config', 'skills')], mcp: { file: path.join(home, '.gemini', 'antigravity', 'mcp_config.json'), kind: 'json-mcpServers' }, note: 'Antigravity moved its folders between versions, so both known locations are written.', transport: 'stdio' },
    { id: 'cursor', name: 'Cursor', detect: [path.join(home, '.cursor')], skillRoots: [], mcp: { file: path.join(home, '.cursor', 'mcp.json'), kind: 'json-mcpServers' }, note: 'Adds the MCP server to ~/.cursor/mcp.json.', transport: 'stdio' },
  ];
}

function readJson(file: string): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return {};
  }
}

function hasMcp(c: ClientDef): boolean {
  if (!c.mcp) return false;
  if (!fs.existsSync(c.mcp.file)) return false;
  if (c.mcp.kind === 'codex-toml') return /\[mcp_servers\.music-studio\]/.test(fs.readFileSync(c.mcp.file, 'utf8'));
  const j = readJson(c.mcp.file);
  return !!(j.mcpServers && j.mcpServers['music-studio']);
}

export function detectClients(): ClientInfo[] {
  return defs().map((c) => ({
    id: c.id, name: c.name, detected: c.detect.some((p) => fs.existsSync(p)), mcpConfigured: hasMcp(c),
    skillInstalled: c.skillRoots.some((r) => fs.existsSync(path.join(r, SKILL, 'SKILL.md'))), skillPaths: c.skillRoots.map((r) => path.join(r, SKILL)),
    note: c.note, transport: c.transport,
  }));
}

export function installSkill(id: string, env: ConnectEnv): string[] {
  const c = defs().find((x) => x.id === id);
  if (!c) throw new Error('Unknown client');
  const written: string[] = [];
  for (const root of c.skillRoots) {
    // for Antigravity write both roots even if one folder does not exist yet; for others only when the client is present
    const dest = path.join(root, SKILL);
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(env.skillSource, dest, { recursive: true });
    written.push(dest);
  }
  return written;
}

function tomlEscape(s: string): string {
  return JSON.stringify(s);
}

export function installMcp(id: string, env: ConnectEnv): string {
  const c = defs().find((x) => x.id === id);
  if (!c?.mcp) throw new Error('This client has no automatic MCP setup. Use "Copy config".');
  const file = c.mcp.file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const stdio = { command: env.stdioCommand, args: env.stdioArgs, env: { MSAI_CLIENT: c.name, ELECTRON_RUN_AS_NODE: '1' } };
  if (c.mcp.kind === 'codex-toml') {
    let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    text = text.replace(/\n?\[mcp_servers\.music-studio(?:\.env)?\][\s\S]*?(?=\n\[|$)/g, '');
    text += `\n[mcp_servers.music-studio]\ncommand = ${tomlEscape(env.stdioCommand)}\nargs = [${env.stdioArgs.map(tomlEscape).join(', ')}]\n\n[mcp_servers.music-studio.env]\nMSAI_CLIENT = "Codex"\nELECTRON_RUN_AS_NODE = "1"\n`;
    fs.writeFileSync(file, text);
    return file;
  }
  const j = readJson(file);
  j.mcpServers ??= {};
  if (c.mcp.kind === 'claude-json') {
    // Claude Code speaks Streamable HTTP directly; the bearer token goes in a header.
    j.mcpServers['music-studio'] = { type: 'http', url: env.url, headers: { Authorization: `Bearer ${env.token}` } };
  } else {
    j.mcpServers['music-studio'] = stdio;
  }
  if (c.id === 'antigravity') {
    const alt = path.join(home, '.gemini', 'config', 'mcp_config.json');
    if (fs.existsSync(path.dirname(alt))) {
      const a = readJson(alt);
      a.mcpServers ??= {};
      a.mcpServers['music-studio'] = stdio;
      fs.writeFileSync(alt, JSON.stringify(a, null, 2));
    }
  }
  fs.writeFileSync(file, JSON.stringify(j, null, 2));
  return file;
}

/** Ready-to-paste snippets for clients we cannot configure ourselves. */
export function configSnippets(env: ConnectEnv): Record<string, string> {
  const stdioJson = JSON.stringify({ mcpServers: { 'music-studio': { command: env.stdioCommand, args: env.stdioArgs } } }, null, 2);
  return {
    'Generic MCP client (stdio)': stdioJson,
    'Streamable HTTP (clients with header support)': JSON.stringify({ 'music-studio': { type: 'http', url: env.url, headers: { Authorization: `Bearer ${env.token}` } } }, null, 2),
    'Claude Code (command)': `claude mcp add --transport http music-studio ${env.url} --header "Authorization: Bearer ${env.token}"`,
    'Codex (command)': `codex mcp add music-studio -- ${env.stdioCommand} ${env.stdioArgs.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`,
  };
}
