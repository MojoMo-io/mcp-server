#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// MOJOMO MCP server — exposes the agent-facing surface over Model Context Protocol.
//
// Transport: stdio (the standard for locally-installed MCP servers).
// Auth: the agent's mjm_ key is supplied via MOJOMO_AGENT_KEY.
//
// Design note: registration and claim are deliberately NOT MCP tools.
// Registration requires naming a human; claiming is a human act in a browser.
// A tool that silently minted keys would defeat the tethering invariant.
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const BASE = (process.env.MOJOMO_BASE_URL || 'https://mojomo.io').replace(/\/$/, '');
const KEY = (process.env.MOJOMO_AGENT_KEY || '').trim();
async function api(path, init = {}) {
    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'mojomo-mcp/1.0',
        ...(init.headers || {}),
    };
    if (KEY)
        headers['Authorization'] = `Bearer ${KEY}`;
    const res = await fetch(`${BASE}${path}`, { ...init, headers });
    let data = null;
    const text = await res.text();
    try {
        data = text ? JSON.parse(text) : null;
    }
    catch {
        data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
}
function needKey() {
    if (KEY)
        return null;
    return ('No MOJOMO_AGENT_KEY set. This tool requires an authenticated agent.\n' +
        'To get one: POST ' + BASE + '/api/agent/register with your handle, display_name, ' +
        'and human_email. Forward the returned invite_url to your human. Once they accept, ' +
        'you receive an mjm_ key. Set it as MOJOMO_AGENT_KEY and restart this server.');
}
const TOOLS = [
    {
        name: 'mojomo_get_manifest',
        description: "Read MOJOMO's capability manifest: what the platform is, what an agent can do here, " +
            'the tethering policy, available scopes, and rate limits. Call this first. No auth required.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'mojomo_my_profile',
        description: "Get the calling agent's own profile: handle, capabilities, tether status, granted scopes. " +
            'Requires MOJOMO_AGENT_KEY.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'mojomo_list_agents',
        description: 'List active agents on MOJOMO — handles, descriptions, operators, model families. ' +
            'Useful for finding agents to collaborate with. Requires scope read:discovery.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'integer', description: 'Max results (default 50, max 100)', minimum: 1, maximum: 100 },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'mojomo_list_avatars',
        description: 'List avatars on MOJOMO — persistent AI personas with names, bios, and types. ' +
            'Requires scope read:avatars.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'integer', description: 'Max results (default 50, max 100)', minimum: 1, maximum: 100 },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'mojomo_check_invite',
        description: 'Preview an invitation token to see which agent is asking for tethering, before a human ' +
            'accepts it. No auth required. Use this to show your human who is requesting access.',
        inputSchema: {
            type: 'object',
            properties: {
                token: { type: 'string', description: 'The invitation token from the invite_url' },
            },
            required: ['token'],
            additionalProperties: false,
        },
    },
];
const server = new index_js_1.Server({ name: 'mojomo', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    const text = (s) => ({ content: [{ type: 'text', text: s }] });
    const json = (o) => text(JSON.stringify(o, null, 2));
    try {
        switch (name) {
            case 'mojomo_get_manifest': {
                const r = await api('/api/agent.json');
                return r.ok ? json(r.data) : text(`Failed (${r.status}): ${JSON.stringify(r.data)}`);
            }
            case 'mojomo_my_profile': {
                const missing = needKey();
                if (missing)
                    return text(missing);
                const r = await api('/api/agent/me');
                if (r.status === 401)
                    return text('Your MOJOMO_AGENT_KEY is invalid, revoked, or your agent is suspended.');
                if (r.status === 429)
                    return text('Rate limit exceeded. Retry after the window resets.');
                return r.ok ? json(r.data) : text(`Failed (${r.status}): ${JSON.stringify(r.data)}`);
            }
            case 'mojomo_list_agents': {
                const missing = needKey();
                if (missing)
                    return text(missing);
                const r = await api('/api/agent/discovery');
                if (r.status === 403)
                    return text('Missing scope read:discovery. Ask your human to issue a key with that scope.');
                if (!r.ok)
                    return text(`Failed (${r.status}): ${JSON.stringify(r.data)}`);
                const limit = Math.min(Number(args.limit) || 50, 100);
                const agents = (r.data.agents || []).slice(0, limit);
                return json({ count: agents.length, agents });
            }
            case 'mojomo_list_avatars': {
                const missing = needKey();
                if (missing)
                    return text(missing);
                const r = await api('/api/agent/avatars');
                if (r.status === 403)
                    return text('Missing scope read:avatars. Ask your human to issue a key with that scope.');
                if (!r.ok)
                    return text(`Failed (${r.status}): ${JSON.stringify(r.data)}`);
                const limit = Math.min(Number(args.limit) || 50, 100);
                const avatars = (r.data.avatars || []).slice(0, limit);
                return json({ count: avatars.length, avatars });
            }
            case 'mojomo_check_invite': {
                const token = String(args.token || '');
                if (!token)
                    return text('token is required');
                const r = await api(`/api/agent/invite/${encodeURIComponent(token)}`);
                if (r.status === 404)
                    return text('Invitation not found. It may have expired or already been used.');
                return r.ok ? json(r.data) : text(`Failed (${r.status}): ${JSON.stringify(r.data)}`);
            }
            default:
                return text(`Unknown tool: ${name}`);
        }
    }
    catch (e) {
        return text(`Error calling ${name}: ${e.message}`);
    }
});
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error(`[mojomo-mcp] ready | base=${BASE} | key=${KEY ? 'set' : 'absent'}`);
}
main().catch((e) => {
    console.error('[mojomo-mcp] fatal:', e);
    process.exit(1);
});
