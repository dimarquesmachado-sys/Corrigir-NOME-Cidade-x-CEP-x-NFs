'use strict';

const http  = require('http');
const cron  = require('node-cron');
const { garantirToken, renovarToken, gerarTokenInicial } = require('./tokenManager');
const {
  sleep,
  getNFsPendentes, getNFDetalhe, enviarNF,
  getContato, atualizarCidadeContato,
  getCidadePorCEP
} = require('./blingApi');

const TZ = process.env.TZ || 'America/Sao_Paulo';

console.log('╔══════════════════════════════════════════╗');
console.log('║  Girassol - Corrigir NFs v1.0             ║');
console.log('╚══════════════════════════════════════════╝');
console.log('Timezone:', TZ);
console.log('Iniciado:', new Date().toLocaleString('pt-BR', { timeZone: TZ }));

function ts() {
  return new Date().toLocaleString('pt-BR', { timeZone: TZ });
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      try { resolve(b ? JSON.parse(b) : {}); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ════════════════════════════════════════════════════════════════
//  LÓGICA PRINCIPAL
// ════════════════════════════════════════════════════════════════

const ERRO_MUNICIPIO = 'cMun';

let _rodando = false;

async function corrigirNFsPendentes() {
  if (_rodando) { console.log('[corrigir] Já em execução — pulando'); return; }
  _rodando = true;

  try {
    let token;
    try {
      token = await garantirToken();
    } catch (e) {
      if (e.code === 401 || e.message === 'TOKEN_EXPIRADO') token = await renovarToken();
      else throw e;
    }

    const nfs = await getNFsPendentes(token);
    console.log(`[corrigir] ${nfs.length} NFs pendentes encontradas`);

    let corrigidas = 0, erros = 0, ignoradas = 0;

    for (const nf of nfs) {
      try {
        const detalhe = await getNFDetalhe(token, nf.id);
        if (!detalhe) { ignoradas++; continue; }

        const msgErro = detalhe.situacao?.valor || '';
        console.log(`[corrigir] NF ${nf.id} | erro: "${String(msgErro).slice(0, 100)}"`);

        // ── Erro de município ──────────────────────────────────
        if (String(msgErro).includes(ERRO_MUNICIPIO)) {
          const idContato = detalhe.contato?.id;
          if (!idContato) {
            console.log(`[corrigir] NF ${nf.id} sem contato — ignorando`);
            ignoradas++;
            continue;
          }

          const contato = await getContato(token, idContato);
          if (!contato) {
            console.log(`[corrigir] Contato ${idContato} não encontrado — ignorando`);
            ignoradas++;
            continue;
          }

          const cep = contato.endereco?.cep;
          if (!cep) {
            console.log(`[corrigir] NF ${nf.id} sem CEP no contato — ignorando`);
            ignoradas++;
            continue;
          }

          const novaCidade = await getCidadePorCEP(cep);
          if (!novaCidade) {
            console.log(`[corrigir] CEP ${cep} não encontrado no ViaCEP — ignorando`);
            ignoradas++;
            continue;
          }

          const cidadeAtual = contato.endereco?.municipio || '';
          console.log(`[corrigir] NF ${nf.id} | CEP ${cep} | "${cidadeAtual}" → "${novaCidade}"`);

          await atualizarCidadeContato(token, idContato, contato, novaCidade);
          await sleep(500);
          await enviarNF(token, nf.id);
          corrigidas++;

        } else {
          console.log(`[corrigir] NF ${nf.id} erro não tratado — ignorando`);
          ignoradas++;
        }

      } catch (e) {
        if (e.code === 401 || e.message === 'TOKEN_EXPIRADO') {
          token = await renovarToken();
        }
        console.error(`[corrigir] Erro na NF ${nf.id}:`, e.message);
        erros++;
      }

      await sleep(300);
    }

    console.log(`[corrigir] corrigidas=${corrigidas} | ignoradas=${ignoradas} | erros=${erros}`);

  } finally {
    _rodando = false;
  }
}

// ── Cron: a cada 30 min das 06h às 23h ──────────────────────────
cron.schedule('*/30 6-23 * * *', () => {
  console.log(`\n[CRON] Corrigir NFs ${ts()}`);
  corrigirNFsPendentes().catch(e => console.error('[CRON] erro:', e.message));
}, { timezone: TZ });

// ════════════════════════════════════════════════════════════════
//  HTTP SERVER
// ════════════════════════════════════════════════════════════════

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  if (url === '/health' || url === '/') {
    return json(res, 200, { status: 'ok', service: 'girassol-corrigir-nfs', time: ts() });
  }

  if (url === '/setup' && method === 'POST') {
    const body = await readBody(req);
    try {
      await gerarTokenInicial(body.auth_code);
      return json(res, 200, { ok: true, message: 'Tokens gerados e salvos ✓' });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  if (url === '/run' && method === 'POST') {
    corrigirNFsPendentes().catch(console.error);
    return json(res, 202, { queued: 'corrigirNFsPendentes' });
  }
if (url === '/setup-token' && method === 'POST') {
    const body = await readBody(req);
    try {
      const fs = require('fs');
      const path = require('path');
      const tokenFile = process.env.TOKEN_FILE || '/data/tokens.json';
      const dir = path.dirname(tokenFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tokenFile, JSON.stringify({ access_token: body.access_token, refresh_token: body.refresh_token || '' }, null, 2));
      return json(res, 200, { ok: true, message: 'Token salvo ✓' });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }
  json(res, 404, { error: 'not found' });
});

if (method === 'GET' && url.startsWith('/debug/nf/')) {
    const partes = url.split('/');
    const idNF = partes[partes.length - 1];
    try {
      const { getNFDetalhe } = require('./blingApi');
      const { garantirToken } = require('./tokenManager');
      const token = await garantirToken();
      const detalhe = await getNFDetalhe(token, idNF);
      return json(res, 200, detalhe);
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n🌐 HTTP ouvindo na porta ${PORT}`));

process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT',  () => { server.close(); process.exit(0); });
