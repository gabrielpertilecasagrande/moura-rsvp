'use strict';
// Cria um novo organizador (tenant) pela linha de comando.
//
// Provisiona: organização no router.db + banco do tenant + primeiro admin.
// É o caminho recomendado para provisionamento manual (sem self-service).
//
// Uso:
//   node scripts/create-tenant.js \
//     --slug=acme \
//     --name="ACME Eventos" \
//     --admin-email=contato@acme.com \
//     --admin-password=senhaForte123 \
//     [--admin-name="Maria Silva"]
//
// Se --slug for omitido, é derivado de --name.

require('dotenv').config();
const { provisionTenant, ProvisionError } = require('../src/provision');

const args = process.argv.slice(2);
const getArg = (key) => {
  const match = args.find((a) => a.startsWith(`--${key}=`));
  return match ? match.split('=').slice(1).join('=') : undefined;
};

const params = {
  orgSlug:       getArg('slug'),
  orgName:       getArg('name'),
  adminName:     getArg('admin-name'),
  adminEmail:    getArg('admin-email'),
  adminPassword: getArg('admin-password'),
};

if (!params.orgName || !params.adminEmail || !params.adminPassword) {
  console.error('Uso: node scripts/create-tenant.js --name="Org" --admin-email=a@b.com --admin-password=... [--slug=org] [--admin-name="Nome"]');
  process.exit(1);
}

try {
  const result = provisionTenant(params);
  console.log('✓ Organização provisionada com sucesso:');
  console.log(`  slug:        ${result.slug}`);
  console.log(`  nome:        ${result.name}`);
  console.log(`  admin:       ${result.admin.name} <${result.admin.email}>`);
  console.log(`  banco:       data/tenants/${result.slug}/rsvp.db`);
  console.log('');
  console.log('  O admin já pode entrar em /admin/login.html com o e-mail e senha informados.');
  process.exit(0);
} catch (e) {
  if (e instanceof ProvisionError) {
    console.error(`✗ ${e.message}`);
  } else {
    console.error('✗ Erro inesperado:', e.message);
  }
  process.exit(1);
}
