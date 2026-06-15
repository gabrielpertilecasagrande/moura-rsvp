// Limitador de taxa simples, em memória (sem dependências externas).
// Adequado para um único servidor (caso do Railway). Conta requisições por
// chave (geralmente o IP) dentro de uma janela de tempo e bloqueia excessos.

function rateLimit({ windowMs, max, message, keyGenerator } = {}) {
  windowMs = windowMs || 15 * 60 * 1000;
  max = max || 100;
  message = message || 'Muitas requisições. Tente novamente em alguns minutos.';
  const hits = new Map(); // key -> { count, reset }

  // Limpeza periódica para não crescer indefinidamente.
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref?.();

  return function (req, res, next) {
    const key = (keyGenerator ? keyGenerator(req) : req.ip) || 'sem-ip';
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      const retry = Math.ceil((entry.reset - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { rateLimit };
