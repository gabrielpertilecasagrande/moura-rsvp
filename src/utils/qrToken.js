'use strict';
const crypto = require('crypto');

// Token de credenciamento do convidado (conteúdo do QR Code de entrada).
// 16 bytes em hexadecimal — mesmo padrão usado no setup de check-in.
function genQrToken() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { genQrToken };
