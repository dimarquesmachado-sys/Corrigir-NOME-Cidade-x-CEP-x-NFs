'use strict';

const fetch = require('node-fetch');

const BLING_API = 'https://www.bling.com.br/Api/v3';
const PAUSA_MS = parseInt(process.env.PAUSA_MS || '700');

let _ultimaReq = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function esperarSlot(minMs) {
  const agora = Date.now();
  const espera = Math.max(0, _ultimaReq + minMs - agora);
  if (espera > 0) await sleep(espera);
  _ultimaReq = Date.now();
}

async function fetchComRetry(url, options, ctx, tentativas = 4) {
  for (let t = 1; t <= tentativas; t++) {
    await esperarSlot(options.method === 'GET' || !options.method ? 300 : PAUSA_MS);
    const resp = await fetch(url, options);
    if (resp.status >= 200 && resp.status < 300) return resp;
    if (resp.status === 429) { await sleep(2000 * t); continue; }
    if (resp.status === 401) throw Object.assign(new Error('TOKEN_EXPIRADO'), { code: 401 });
    const txt = await resp.text();
    console.error(`[blingApi] HTTP ${resp.status} em ${ctx}:`, txt.slice(0, 300));
    if (t === tentativas) throw new Error(`API Bling (${ctx}) HTTP ${resp.status}`);
    await sleep(1000 * t);
  }
}

// ── NFs ──────────────────────────────────────────────────────────

async function getNFsPendentes(token) {
  // situacao 0 = pendente
  const url = `${BLING_API}/nfe?situacao=0&limite=100&pagina=1`;
  const resp = await fetchComRetry(
    url,
    { headers: { Authorization: `Bearer ${token}` } },
    'listar NFs pendentes'
  );
  const data = await resp.json();
  return data.data || [];
}

async function getNFDetalhe(token, idNF) {
  const url = `${BLING_API}/nfe/${idNF}`;
  const resp = await fetchComRetry(
    url,
    { headers: { Authorization: `Bearer ${token}` } },
    `detalhe NF=${idNF}`
  );
  const data = await resp.json();
  return data.data || null;
}

async function enviarNF(token, idNF) {
  const url = `${BLING_API}/nfe/${idNF}/enviar`;
  await fetchComRetry(
    url,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}'
    },
    `enviar NF=${idNF}`
  );
  console.log(`[blingApi] NF ${idNF} enviada para SEFAZ ✓`);
}

// ── Contatos ──────────────────────────────────────────────────────

async function getContato(token, idContato) {
  const url = `${BLING_API}/contatos/${idContato}`;
  const resp = await fetchComRetry(
    url,
    { headers: { Authorization: `Bearer ${token}` } },
    `buscar contato=${idContato}`
  );
  const data = await resp.json();
  return data.data || null;
}

async function atualizarCidadeContato(token, idContato, contatoCompleto, novaCidade) {
  const url = `${BLING_API}/contatos/${idContato}`;
  const payload = {
    ...contatoCompleto,
    endereco: {
      ...contatoCompleto.endereco,
      municipio: novaCidade
    }
  };
  await fetchComRetry(
    url,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    },
    `atualizar cidade contato=${idContato}`
  );
  console.log(`[blingApi] Contato ${idContato} cidade atualizada para "${novaCidade}" ✓`);
}

// ── ViaCEP ────────────────────────────────────────────────────────

async function getCidadePorCEP(cep) {
  const cepLimpo = String(cep).replace(/\D/g, '');
  if (cepLimpo.length !== 8) return null;
  try {
    const resp = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.erro) return null;
    return data.localidade || null;
  } catch (e) {
    console.error('[blingApi] Erro ao buscar CEP:', e.message);
    return null;
  }
}

module.exports = {
  sleep,
  getNFsPendentes, getNFDetalhe, enviarNF,
  getContato, atualizarCidadeContato,
  getCidadePorCEP
};
