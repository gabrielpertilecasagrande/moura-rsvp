require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { ensureAdmin } = require('./utils/ensureAdmin');

const r = ensureAdmin();
console.log(r.created ? `Admin criado: ${r.email}` : `Admin já existe: ${r.email} (garantido como admin/ativo)`);
process.exit(0);
