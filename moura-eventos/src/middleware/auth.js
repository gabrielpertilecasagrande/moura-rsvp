const jwt = require('jsonwebtoken');
const db = require('../db');

// Em produção exigimos um JWT_SECRET forte. Sem ele, tokens poderiam ser
// forjados — falha imediata e explícita em vez de cair num segredo padrão.
const isProd = process.env.NODE_ENV === 'production';
if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16)) {
  throw new Error('JWT_SECRET ausente ou fraco. Defina um valor com pelo menos 16 caracteres em produção.');
}
const SECRET = process.env.JWT_SECRET || 'dev-secret-apenas-para-desenvolvimento';

function sign(admin) {
  return jwt.sign(
    { id: admin.id, email: admin.email, name: admin.name, role: admin.role || 'operador' },
    SECRET,
    { expiresIn: '12h' }
  );
}

// Protege rotas administrativas. Espera header Authorization: Bearer <token>.
// Recarrega o usuário do banco a cada requisição: assim, mudanças de papel,
// bloqueio ou inativação têm efeito imediato (sem esperar o token expirar).
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  }
  const u = db.prepare('SELECT id, name, email, role, status FROM admins WHERE id = ?').get(payload.id);
  if (!u) return res.status(401).json({ error: 'Conta não encontrada. Entre novamente.' });
  if (u.status !== 'ativo') {
    const msg = u.status === 'bloqueado' ? 'Sua conta foi bloqueada. Procure um administrador.'
      : u.status === 'inativo' ? 'Sua conta está inativa. Procure um administrador.'
      : 'Sua conta não está ativa. Procure um administrador.';
    // 401 para que o frontend encerre a sessão e leve à tela de login.
    return res.status(401).json({ error: msg });
  }
  req.admin = u;
  next();
}

// Exige papel de administrador (acesso total). Use após requireAuth.
function requireAdmin(req, res, next) {
  if (!req.admin || req.admin.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem acessar esta área.' });
  }
  next();
}

module.exports = { sign, requireAuth, requireAdmin, SECRET };
