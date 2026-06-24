'use strict';
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const KEY_ENV = 'DATA_ENCRYPTION_KEY';

function getKey() {
  const h = process.env[KEY_ENV];
  if (!h) return null;
  const k = Buffer.from(h, 'hex');
  if (k.length !== 32) throw new Error(`${KEY_ENV} deve ter exatamente 64 caracteres hexadecimais (256 bits)`);
  return k;
}

// Cifra um valor de texto. Se a chave não estiver configurada, devolve o valor
// em claro (operação nula — permite deploy gradual antes de definir a chave).
function encrypt(v) {
  if (v == null) return v;
  const key = getKey();
  if (!key) return v;
  const iv  = crypto.randomBytes(12);
  const c   = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([c.update(String(v), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

// Decifra um valor. Se não começar com "enc:" é texto em claro (passagem direta).
// Permite leitura de dados ainda não migrados e período de transição.
function decrypt(v) {
  if (v == null) return v;
  const s = String(v);
  if (!s.startsWith('enc:')) return v;
  const key = getKey();
  if (!key) {
    console.error('[crypto] dados cifrados encontrados mas DATA_ENCRYPTION_KEY não está definido');
    return null;
  }
  try {
    const [, ivH, tagH, encH] = s.split(':');
    const d = crypto.createDecipheriv(ALGO, key, Buffer.from(ivH, 'hex'));
    d.setAuthTag(Buffer.from(tagH, 'hex'));
    return Buffer.concat([d.update(Buffer.from(encH, 'hex')), d.final()]).toString('utf8');
  } catch {
    console.error('[crypto] falha ao decifrar campo — dados corrompidos ou chave incorreta');
    return null;
  }
}

// Decifra campos específicos de um objeto retornado pelo banco.
function decryptFields(obj, fields) {
  if (!obj) return obj;
  const r = { ...obj };
  for (const f of fields) if (r[f] != null) r[f] = decrypt(r[f]);
  return r;
}

module.exports = { encrypt, decrypt, decryptFields };
