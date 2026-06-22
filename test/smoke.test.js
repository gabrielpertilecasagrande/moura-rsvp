'use strict';
// Testes de fumaça (smoke tests) dos fluxos críticos do Moura RSVP.
// Sobem o servidor real (server.js) num banco temporário e exercitam a API por
// HTTP — sem dependências externas, usando o runner nativo `node --test`.
//
// Cobertura: login, RSVP público (confirmar/recusar + QR), imagem do QR,
// check-in (lookup + registro idempotente) e provisionamento via serviço.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SECRET = 'test-secret-rsvp-smoke-0123456789';
const PORT = 4100 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;
const SUFFIX = Math.random().toString(36).slice(2, 8);

let proc;
let dataDir;

async function api(pathname, { method = 'GET', token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(BASE + pathname, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function json(pathname, opts) {
  const res = await api(pathname, opts);
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo JSON */ }
  return { status: res.status, data };
}

async function adminToken() {
  const { data } = await json('/api/auth/login', {
    method: 'POST', body: { email: 'admin@moura.com.br', password: 'moura2026' },
  });
  return data.token;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsvp-smoke-'));
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      JWT_SECRET: SECRET,
      DATA_DIR: dataDir,
      PORT: String(PORT),
      ADMIN_EMAIL: 'admin@moura.com.br',
      ADMIN_PASSWORD: 'moura2026',
    },
    stdio: 'ignore',
  });

  // Aguarda o servidor responder (até ~15s).
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/public/legal-config`);
      if (res.ok) break;
    } catch { /* ainda subindo */ }
    if (Date.now() > deadline) throw new Error('servidor não subiu a tempo');
    await new Promise((r) => setTimeout(r, 300));
  }
});

after(() => {
  if (proc) proc.kill('SIGKILL');
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('login: credenciais válidas retornam token; inválidas são rejeitadas', async () => {
  const ok = await json('/api/auth/login', {
    method: 'POST', body: { email: 'admin@moura.com.br', password: 'moura2026' },
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token, 'deveria retornar um token');

  const bad = await json('/api/auth/login', {
    method: 'POST', body: { email: 'admin@moura.com.br', password: 'senha-errada' },
  });
  assert.equal(bad.status, 401);
});

test('RSVP público: confirmar gera qr_token; recusar não gera', async () => {
  const token = await adminToken();
  const slug = `smoke-evento-${SUFFIX}`;
  const ev = await json('/api/events', {
    method: 'POST', token,
    body: { name: 'Evento Smoke', slug, event_date: '2026-12-01', location: 'Auditório' },
  });
  assert.ok([200, 201].includes(ev.status), `criar evento: ${JSON.stringify(ev.data)}`);

  const confirmado = await json(`/api/public/events/${slug}/rsvp`, {
    method: 'POST',
    body: {
      name: 'Maria Smoke', email: `maria-${SUFFIX}@teste.com`, response: 'confirmado',
      accepted_terms: true, accepted_privacy_policy: true, accepted_data_processing: true,
    },
  });
  assert.equal(confirmado.status, 201);
  assert.equal(confirmado.data.response, 'confirmado');
  assert.match(confirmado.data.qr_token || '', /^[a-f0-9]{32}$/, 'confirmado deve ter qr_token hex');

  const recusado = await json(`/api/public/events/${slug}/rsvp`, {
    method: 'POST',
    body: {
      name: 'João Smoke', email: `joao-${SUFFIX}@teste.com`, response: 'recusado',
      accepted_terms: true, accepted_privacy_policy: true, accepted_data_processing: true,
    },
  });
  assert.equal(recusado.status, 201);
  assert.equal(recusado.data.qr_token, null, 'recusado não deve ter qr_token');
});

test('reenvio preserva o mesmo qr_token (não invalida o QR já entregue)', async () => {
  const token = await adminToken();
  const slug = `smoke-reenvio-${SUFFIX}`;
  await json('/api/events', {
    method: 'POST', token,
    body: { name: 'Evento Reenvio', slug, event_date: '2026-12-01', location: 'Sala' },
  });
  const body = {
    name: 'Ana Reenvio', email: `ana-${SUFFIX}@teste.com`, response: 'confirmado',
    accepted_terms: true, accepted_privacy_policy: true, accepted_data_processing: true,
  };
  const first = await json(`/api/public/events/${slug}/rsvp`, { method: 'POST', body });
  const second = await json(`/api/public/events/${slug}/rsvp`, { method: 'POST', body });
  assert.equal(second.data.updated, true);
  assert.equal(second.data.qr_token, first.data.qr_token, 'token deve ser preservado no reenvio');
});

test('imagem do QR retorna PNG válido', async () => {
  const res = await api('/api/public/qr/abcdef0123456789abcdef0123456789.png');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await res.arrayBuffer());
  // Assinatura PNG: 89 50 4E 47.
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('check-in: lookup pelo QR encontra o convidado e o registro é idempotente', async () => {
  const token = await adminToken();
  const slug = `smoke-checkin-${SUFFIX}`;
  await json('/api/events', {
    method: 'POST', token,
    body: { name: 'Evento Checkin', slug, event_date: '2026-12-01', location: 'Hall' },
  });
  const rsvp = await json(`/api/public/events/${slug}/rsvp`, {
    method: 'POST',
    body: {
      name: 'Carlos Checkin', email: `carlos-${SUFFIX}@teste.com`, response: 'confirmado',
      accepted_terms: true, accepted_privacy_policy: true, accepted_data_processing: true,
    },
  });
  const qr = rsvp.data.qr_token;
  assert.ok(qr);

  const lookup = await json(`/api/checkin/lookup?qr=${qr}`, { token });
  assert.equal(lookup.status, 200);
  assert.equal(lookup.data.name, 'Carlos Checkin');
  const pid = lookup.data.id;

  const first = await json('/api/checkin/register', { method: 'POST', token, body: { participant_id: pid } });
  assert.equal(first.status, 200);
  assert.equal(first.data.already_checked_in, false);

  const second = await json('/api/checkin/register', { method: 'POST', token, body: { participant_id: pid } });
  assert.equal(second.status, 200);
  assert.equal(second.data.already_checked_in, true, 'segundo registro deve ser idempotente');
  assert.equal(second.data.checked_in_at, first.data.checked_in_at);
});

test('provisionamento via serviço (Moura One) cria evento com o segredo compartilhado', async () => {
  const slug = `smoke-prov-${SUFFIX}`;
  const ok = await json('/api/auth/provision-event', {
    method: 'POST', token: SECRET,
    body: { name: 'Evento Provisionado', slug, event_date: '2026-12-10', location: 'Centro' },
  });
  assert.equal(ok.status, 201, `provision: ${JSON.stringify(ok.data)}`);
  assert.ok(ok.data.public_url, 'deve retornar a URL pública');

  const unauth = await json('/api/auth/provision-event', {
    method: 'POST', token: 'segredo-errado',
    body: { name: 'X', slug: `x-${SUFFIX}` },
  });
  assert.equal(unauth.status, 401, 'segredo errado deve ser rejeitado');
});
