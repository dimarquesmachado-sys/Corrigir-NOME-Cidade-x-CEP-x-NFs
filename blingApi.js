'use strict';

const fetch = require('node-fetch');

const BLING_API = 'https://www.bling.com.br/Api/v3';
const PAUSA_MS = parseInt(process.env.PAUSA_MS || '700');
const SINTEGRA_TOKEN = process.env.SINTEGRA_TOKEN || '';
const INTERMEDIADOR_CNPJ = process.env.INTERMEDIADOR_CNPJ || '03007331000141';
const INTERMEDIADOR_NOME = process.env.INTERMEDIADOR_NOME || 'MAGAZINEGIRASSOL';

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

async function getNFsParaCorrigir(token) {
  const situacoes = [1, 4, 5];
  const ontem = new Date(Date.now() - 72*60*60*1000);
  let todas = [];

  for (const sit of situacoes) {
    const url = `${BLING_API}/nfe?situacao=${sit}&limite=100&pagina=1`;
    const resp = await fetchComRetry(
      url,
      { headers: { Authorization: `Bearer ${token}` } },
      `listar NFs situacao=${sit}`
    );
    const data = await resp.json();
    const recentes = (data.data || []).filter(nf => {
      const dataEmissao = new Date(nf.dataEmissao || nf.data);
      return dataEmissao >= ontem;
    });
    todas = todas.concat(recentes);
  }

  return todas;
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

async function salvarNF(token, idNF, detalhe) {
  const payload = {
    ...detalhe,
    intermediador: {
      cnpj: INTERMEDIADOR_CNPJ,
      nomeUsuario: INTERMEDIADOR_NOME
    },
    parcelas: [] // Remove parcelas para evitar erro de divergência
  };

  const url = `${BLING_API}/nfe/${idNF}`;
  const body = JSON.stringify(payload);
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    },
    body
  });

  if (resp.status >= 200 && resp.status < 300) {
    console.log(`[blingApi] NF ${idNF} salva`);
    return;
  }

  if (resp.status === 401) throw Object.assign(new Error('TOKEN_EXPIRADO'), { code: 401 });
  const txt = await resp.text();
  console.error(`[blingApi] HTTP ${resp.status} em salvar NF=${idNF}:`, txt.slice(0, 300));
  throw new Error(`API Bling (salvar NF=${idNF}) HTTP ${resp.status}`);
}

async function enviarNF(token, idNF) {
  const url = `${BLING_API}/nfe/${idNF}/enviar`;
  const body = '{}';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    },
    body
  });

  if (resp.status >= 200 && resp.status < 300) {
    console.log(`[blingApi] NF ${idNF} enviada para SEFAZ`);
    return;
  }

  if (resp.status === 401) throw Object.assign(new Error('TOKEN_EXPIRADO'), { code: 401 });
  const txt = await resp.text();
  console.error(`[blingApi] HTTP ${resp.status} em enviar NF=${idNF}:`, txt.slice(0, 300));
  throw new Error(`API Bling (enviar NF=${idNF}) HTTP ${resp.status}`);
}

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

async function atualizarIEContato(token, idContato, contatoCompleto, ie, contribuinte) {
  const url = `${BLING_API}/contatos/${idContato}`;
  const payload = { ...contatoCompleto, ie, contribuinte };
  await fetchComRetry(
    url,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    },
    `atualizar IE contato=${idContato}`
  );
  console.log(`[blingApi] Contato ${idContato} IE="${ie}" contribuinte=${contribuinte}`);
}

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

async function getIEPorCNPJ(cnpj, uf) {
  if (!SINTEGRA_TOKEN) {
    console.log('[blingApi] SINTEGRA_TOKEN não configurado');
    return null;
  }
  const cnpjLimpo = String(cnpj).replace(/\D/g, '');
  try {
    const url = `https://www.sintegraws.com.br/api/v1/execute-api.php?token=${SINTEGRA_TOKEN}&cnpj=${cnpjLimpo}&plugin=ST`;
    const resp = await fetch(url);
    if (!resp.ok) { console.log(`[blingApi] SintegraWS HTTP ${resp.status}`); return null; }
    const data = await resp.json();
    console.log(`[blingApi] SintegraWS CNPJ=${cnpjLimpo} UF=${uf}:`, JSON.stringify(data).slice(0, 200));

    if (data && data.inscricoes_estaduais) {
      const ieEstado = data.inscricoes_estaduais.find(i => i.uf === uf);
      if (ieEstado && ieEstado.inscricao_estadual && ieEstado.inscricao_estadual !== 'ISENTO') {
        return { ie: ieEstado.inscricao_estadual, contribuinte: 1 };
      }
      if (ieEstado && ieEstado.inscricao_estadual === 'ISENTO') {
        return { ie: 'ISENTO', contribuinte: 2 };
      }
    }
    if (data && data.inscricao_estadual) {
      if (data.inscricao_estadual === 'ISENTO') return { ie: 'ISENTO', contribuinte: 2 };
      return { ie: data.inscricao_estadual, contribuinte: 1 };
    }
    return null;
  } catch (e) {
    console.error('[blingApi] Erro SintegraWS:', e.message);
    return null;
  }
}

module.exports = {
  sleep,
  getNFsParaCorrigir, getNFDetalhe, salvarNF, enviarNF,
  getContato, atualizarIEContato,
  getCidadePorCEP, getIEPorCNPJ
};
