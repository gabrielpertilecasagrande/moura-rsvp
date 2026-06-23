'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  CÓDIGO DE REFERÊNCIA DO EVENTO
//  Código curto, único e legível usado para referência rápida e logs.
//  Formato: PREFIXO-XXXXX  (ex.: MO-7K2P9, AV-3H8QD)
//    • MO = evento vindo do Moura One (vinculado)
//    • AV = evento avulso (criado direto no app de check-in)
//  O alfabeto omite caracteres ambíguos (0/O, 1/I/L) para facilitar ditar/buscar.
// ════════════════════════════════════════════════════════════════════════════

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomChars(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

// Gera um código único garantido contra events.ref_code do banco informado.
// prefix: 'MO' (Moura One) ou 'AV' (avulso).
function genRefCode(db, prefix) {
  const p = String(prefix || 'AV').toUpperCase();
  for (let i = 0; i < 50; i++) {
    const code = `${p}-${randomChars(5)}`;
    const exists = db.prepare('SELECT 1 FROM events WHERE ref_code = ?').get(code);
    if (!exists) return code;
  }
  // Fallback (praticamente impossível): mais entropia para evitar colisão.
  return `${p}-${randomChars(8)}`;
}

module.exports = { genRefCode, randomChars };
