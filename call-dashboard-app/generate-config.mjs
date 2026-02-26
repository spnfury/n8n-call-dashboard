#!/usr/bin/env node
// ── Generate config.js at build time from environment variables ──
// Used by Vercel during deployment. Locally, config.js is used directly.
import { writeFileSync, existsSync, mkdirSync } from 'fs';

const distDir = 'dist';
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

const config = {
    API_BASE: process.env.API_BASE || 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables',
    CALL_LOGS_TABLE: process.env.CALL_LOGS_TABLE || 'm013en5u2cyu30j',
    CONFIRMED_TABLE: process.env.CONFIRMED_TABLE || 'mtoilizta888pej',
    XC_TOKEN: process.env.XC_TOKEN || '',
    VAPI_API_KEY: process.env.VAPI_API_KEY || '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
};

const content = `// Auto-generated at build time — do NOT edit
window.APP_CONFIG = ${JSON.stringify(config, null, 4)};
`;

writeFileSync(`${distDir}/config.js`, content, 'utf-8');
console.log('✅ config.js generated in dist/');
