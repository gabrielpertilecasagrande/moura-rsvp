'use strict';
// Verificação em duas etapas (2FA) por TOTP — padrão de apps autenticadores
// (Google Authenticator, Authy, etc.). Envolve a lib `otplib` e gera/valida os
// códigos de recuperação (uso único). O SEGREDO TOTP é guardado cifrado pela
// camada de chamada (crypto.js); aqui só lidamos com a lógica de códigos.
const crypto = require('crypto');
const { authenticator } = require('otplib');

// Tolera ±30s de deriva de relógio entre o servidor e o celular do usuário
// (aceita o passo anterior e o seguinte). Janela maior enfraqueceria o fator.
authenticator.options = { window: 1 };

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// Remove formatação para comparar códigos de recuperação de forma tolerante
// (ignora hífens, espaços e maiúsculas/minúsculas).
function normRecovery(code) {
  return String(code || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function generateSecret() {
  return authenticator.generateSecret(); // base32
}

// URL otpauth:// que vira o QR Code lido pelo app autenticador.
function keyuri(accountName, issuer, secret) {
  return authenticator.keyuri(accountName, issuer, secret);
}

// Confere um código de 6 dígitos contra o segredo.
function verifyToken(secret, token) {
  const t = String(token || '').replace(/\s/g, '');
  if (!secret || !/^[0-9]{6}$/.test(t)) return false;
  try { return authenticator.verify({ token: t, secret }); }
  catch { return false; }
}

// Gera N códigos de recuperação. Retorna { plain: [...exibir 1x...], stored: JSON
// de hashes para guardar no banco }. Formato XXXXX-XXXXX (10 hex, maiúsculo).
function generateRecoveryCodes(n = 10) {
  const plain = [];
  const hashes = [];
  for (let i = 0; i < n; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 chars
    plain.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
    hashes.push(sha256(normRecovery(raw)));
  }
  return { plain, stored: JSON.stringify(hashes) };
}

// Consome um código de recuperação. Retorna { ok, stored } — se ok, `stored` é o
// novo JSON sem o código usado (uso único). Se inválido, ok=false.
function consumeRecoveryCode(storedJson, code) {
  let list;
  try { list = JSON.parse(storedJson || '[]'); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  const h = sha256(normRecovery(code));
  const idx = list.indexOf(h);
  if (idx === -1) return { ok: false, stored: storedJson };
  list.splice(idx, 1);
  return { ok: true, stored: JSON.stringify(list) };
}

// Quantos códigos de recuperação ainda restam (para exibir na tela de conta).
function remainingRecoveryCodes(storedJson) {
  try { const l = JSON.parse(storedJson || '[]'); return Array.isArray(l) ? l.length : 0; }
  catch { return 0; }
}

module.exports = {
  generateSecret, keyuri, verifyToken,
  generateRecoveryCodes, consumeRecoveryCode, remainingRecoveryCodes,
};
