const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-secret';

function sign(admin) {
  return jwt.sign({ id: admin.id, email: admin.email, name: admin.name }, SECRET, {
    expiresIn: '12h',
  });
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

module.exports = { sign, requireAuth, SECRET };
