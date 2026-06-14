const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-secret';

function sign(admin) {
  return jwt.sign(
    { id: admin.id, email: admin.email, name: admin.name, role: admin.role || 'editor' },
    SECRET,
    { expiresIn: '12h' }
  );
}

// Protege rotas administrativas. Espera header Authorization: Bearer <token>.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  try {
    req.admin = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  }
}

// Exige papel de administrador (acesso total). Use após requireAuth.
function requireAdmin(req, res, next) {
  if (!req.admin || req.admin.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem acessar esta área.' });
  }
  next();
}

module.exports = { sign, requireAuth, requireAdmin, SECRET };
