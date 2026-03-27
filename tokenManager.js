'use strict';

const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');

const TOKEN_FILE = process.env.TOKEN_FILE || path.join(__dirname, 'data', 'tokens.json');

// ── I/O ───────────────────────────────────────────────────────────────

function lerTokens() {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return {};
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch (e) {
    console.error('[tokenManager] Erro ao ler tokens:', e.message);
    return {};
  }
}

function salvarTokens(access_token, refresh_token) {
  const dir = path.dirname(TOKEN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ access_token, refresh_token }, null, 2));
  console.log('[tokenManager] Tokens salvos em disco ✓');
}

// ── OAuth helpers ────────────────────────────────────────────────────

function basicAuth() {
  const id  = process.env.BLING_CLIENT_ID;
  const sec = process.env.BLING_CLIENT_SECRET;
  if (!id || !sec) throw new Error('BLING_CLIENT_ID / BLING_CLIENT_SECRET não definidos nas env vars');
  return 'Basic ' + Buffer.from(`${id}:${sec}`).toString('base64');
}

async function postOAuth(body) {
  const resp = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: new URLSearchParams(body)
  });
  const data = await resp.json();
  if (data.error) throw new Error(`OAuth error: ${JSON.stringify(data)}`);
  return data;
}

// ── Gerar token inicial (uma vez) ─────────────────────────────────────

async function gerarTokenInicial(auth_code) {
  if (!auth_code) throw new Error('auth_code obrigatório');
  const redirect_uri = process.env.BLING_REDIRECT_URI || '';
  const data = await postOAuth({ grant_type: 'authorization_code', code: auth_code, redirect_uri });
  salvarTokens(data.access_token, data.refresh_token);
  return { ok: true };
}

// ── Renovar token ─────────────────────────────────────────────────────

let _renovando = false; // evita refresh duplo simultâneo

async function renovarToken() {
  if (_renovando) {
    // Aguarda o refresh em andamento
    await new Promise(r => setTimeout(r, 2000));
    return lerTokens().access_token;
  }
  _renovando = true;
  try {
    console.log('[tokenManager] Renovando token...');
    const { refresh_token } = lerTokens();
    if (!refresh_token) throw new Error('refresh_token ausente — rode /setup primeiro');
    const redirect_uri = process.env.BLING_REDIRECT_URI || '';
    const data = await postOAuth({ grant_type: 'refresh_token', refresh_token, redirect_uri });
    salvarTokens(data.access_token, data.refresh_token);
    console.log('[tokenManager] Token renovado ✓');
    return data.access_token;
  } finally {
    _renovando = false;
  }
}

// ── Garantir token válido ────────────────────────────────────────────

async function garantirToken() {
  const { access_token } = lerTokens();

  if (!access_token || access_token.length < 10) {
    console.log('[tokenManager] Token ausente — renovando');
    return renovarToken();
  }

  const resp = await fetch('https://www.bling.com.br/Api/v3/produtos?limite=1', {
    headers: { Authorization: `Bearer ${access_token}` }
  });

  if (resp.status === 401) {
    console.log('[tokenManager] Token expirado (401) — renovando');
    return renovarToken();
  }

  return access_token;
}

module.exports = { garantirToken, renovarToken, gerarTokenInicial };
Extension
Extension Embed



Actions

Your Business

Settings

Help
Search Amazon

United States
Search Amazon
