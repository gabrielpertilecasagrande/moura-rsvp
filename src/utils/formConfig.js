// Configuração dos campos do formulário público.
// Formato canônico (armazenado em events.form_config como JSON):
//   { fields: [ { key, label, type, enabled, required, builtin } ] }
//
// Campos "builtin" (Empresa/Cargo/E-mail/Telefone) mapeiam diretamente para
// colunas da tabela participants. Campos personalizados ("outro") têm chave
// começando com "c_" e suas respostas são guardadas em participants.extra (JSON).
//
// parseFormConfig() aceita tanto o formato novo (array fields) quanto o legado
// (objeto { company:{...}, role:{...}, ... }) e sempre devolve o formato canônico.

const BUILTIN = [
  { key: 'company', label: 'Empresa', type: 'text' },
  { key: 'role', label: 'Cargo', type: 'text' },
  { key: 'email', label: 'E-mail', type: 'email' },
  { key: 'phone', label: 'Telefone/WhatsApp', type: 'tel' },
];
const BUILTIN_KEYS = BUILTIN.map((b) => b.key);
const ALLOWED_TYPES = ['text', 'email', 'tel'];

function sanitizeField(f) {
  if (!f || !f.key) return null;
  const key = String(f.key).slice(0, 40);
  const def = BUILTIN.find((b) => b.key === key);
  const builtin = !!def;
  const type = builtin ? def.type : (ALLOWED_TYPES.includes(f.type) ? f.type : 'text');
  const labelRaw = f.label != null ? String(f.label).trim() : '';
  const label = labelRaw ? labelRaw.slice(0, 60) : (def ? def.label : 'Campo');
  const enabled = !!f.enabled;
  return { key, label, type, enabled, required: enabled && !!f.required, builtin };
}

function parseFormConfig(raw) {
  let parsed = {};
  try { parsed = typeof raw === 'string' ? (JSON.parse(raw || '{}') || {}) : (raw || {}); } catch { parsed = {}; }

  const fields = [];
  const seen = new Set();

  if (Array.isArray(parsed.fields)) {
    for (const f of parsed.fields) {
      const sf = sanitizeField(f);
      if (sf && !seen.has(sf.key)) { seen.add(sf.key); fields.push(sf); }
    }
    // Garante que todos os campos builtin existam (mesmo desabilitados), preservando ordem.
    for (const b of BUILTIN) {
      if (!seen.has(b.key)) fields.push(sanitizeField({ ...b, enabled: false, required: false }));
    }
  } else {
    // Formato legado: objeto com chaves builtin.
    for (const b of BUILTIN) {
      const cfg = parsed[b.key] || {};
      fields.push(sanitizeField({ key: b.key, label: cfg.label || b.label, type: b.type, enabled: cfg.enabled, required: cfg.required }));
    }
  }
  return { fields };
}

// Lista apenas os campos personalizados habilitados (para coleta/exportação).
function customFields(cfg) {
  return (cfg.fields || []).filter((f) => !f.builtin && f.enabled);
}
function enabledFields(cfg) {
  return (cfg.fields || []).filter((f) => f.enabled);
}

module.exports = { BUILTIN, BUILTIN_KEYS, parseFormConfig, customFields, enabledFields };
