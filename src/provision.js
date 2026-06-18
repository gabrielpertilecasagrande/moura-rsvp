'use strict';
// Provisionamento de novos organizadores (tenants).
//
// Centraliza a criação de um tenant para que CLI e rota HTTP usem a mesma lógica:
//   1. valida e normaliza o slug da organização
//   2. registra a organização no router.db
//   3. cria o banco do tenant (schema aplicado por openTenantDb)
//   4. cria o primeiro admin (papel 'admin', ativo)
//   5. registra o e-mail do admin no índice global (admin_emails)
//
// Não há self-service: esta função é chamada apenas por um operador da plataforma
// (via script de linha de comando ou rota protegida por PLATFORM_TOKEN).

const bcrypt = require('bcryptjs');
const { openTenantDb } = require('./db');
const router           = require('./router');
const { slugify }      = require('./utils/slug');

class ProvisionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Cria um tenant completo. Retorna { slug, name, admin: { email } }.
function provisionTenant({ orgSlug, orgName, adminName, adminEmail, adminPassword } = {}) {
  // ── Validação ───────────────────────────────────────────────────────────────
  const name = String(orgName || '').trim();
  if (!name) throw new ProvisionError('Informe o nome da organização.');

  // Slug: usa o informado ou deriva do nome. Sempre normalizado.
  const slug = slugify(orgSlug || orgName);
  if (!slug) throw new ProvisionError('Não foi possível gerar um slug válido para a organização.');
  if (slug.length < 2) throw new ProvisionError('O slug da organização é muito curto.');

  const mail = String(adminEmail || '').toLowerCase().trim();
  if (!mail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
    throw new ProvisionError('Informe um e-mail de admin válido.');
  }
  const pass = String(adminPassword || '');
  if (pass.length < 8) throw new ProvisionError('A senha do admin deve ter ao menos 8 caracteres.');

  const adminDisplayName = String(adminName || '').trim() || 'Administrador';

  // ── Unicidade ───────────────────────────────────────────────────────────────
  if (router.organizationExists(slug)) {
    throw new ProvisionError(`Já existe uma organização com o slug "${slug}".`, 409);
  }
  const emailOwner = router.findTenantByEmail(mail);
  if (emailOwner) {
    throw new ProvisionError('Este e-mail já está associado a outra organização.', 409);
  }

  // ── Criação ─────────────────────────────────────────────────────────────────
  router.createOrganization(slug, name);

  let tenantDb;
  try {
    tenantDb = openTenantDb(slug); // cria o arquivo + aplica schema/migrações
    const hash = bcrypt.hashSync(pass, 10);
    tenantDb.prepare(
      "INSERT INTO admins (name, email, password_hash, role, status) VALUES (?, ?, ?, 'admin', 'ativo')"
    ).run(adminDisplayName, mail, hash);
    router.registerAdminEmail(mail, slug);
  } catch (e) {
    // Rollback do registro da organização para não deixar tenant órfão no router.
    try { router.routerDb.prepare('DELETE FROM organizations WHERE slug = ?').run(slug); } catch { /* ignore */ }
    throw e;
  }

  return { slug, name, admin: { name: adminDisplayName, email: mail } };
}

module.exports = { provisionTenant, ProvisionError };
