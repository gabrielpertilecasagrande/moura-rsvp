// Configuração dos campos do formulário público.
// Formato canônico (armazenado em events.form_config como JSON):
//   { fields: [ { key, label, type, enabled, required, builtin, options? } ] }
//
// Campos "builtin" (Empresa/Cargo/E-mail/Telefone) mapeiam diretamente para
// colunas da tabela participants. Campos personalizados ("outro") têm chave
// começando com "c_" e suas respostas são guardadas em participants.extra (JSON).
//
// Tipos de campos personalizados (revisão 2.2):
//   text     — texto curto
//   textarea — texto longo
//   number   — número
//   date     — data
//   select   — lista suspensa (uma opção)            [usa options]
//   radio    — botões de opção (uma opção)           [usa options]
//   checkbox — caixas de seleção (várias opções)     [usa options]
//   boolean  — Sim/Não
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

// Tipos válidos para campos personalizados.
const CUSTOM_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'radio', 'checkbox', 'boolean'];
// Tipos que exigem uma lista de opções.
const OPTION_TYPES = ['select', 'radio', 'checkbox'];

function sanitizeOptions(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const o of arr) {
    const v = String(o == null ? '' : o).trim().slice(0, 80);
    if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    if (out.length >= 40) break;
  }
  return out;
}

function sanitizeField(f) {
  if (!f || !f.key) return null;
  const key = String(f.key).slice(0, 40);
  const def = BUILTIN.find((b) => b.key === key);
  const builtin = !!def;
  const type = builtin ? def.type : (CUSTOM_TYPES.includes(f.type) ? f.type : 'text');
  const labelRaw = f.label != null ? String(f.label).trim() : '';
  const label = labelRaw ? labelRaw.slice(0, 60) : (def ? def.label : 'Campo');
  const enabled = !!f.enabled;
  const field = { key, label, type, enabled, required: enabled && !!f.required, builtin };
  if (!builtin && OPTION_TYPES.includes(type)) field.options = sanitizeOptions(f.options);
  return field;
}

function defaultFields() {
  return BUILTIN.map((b) => sanitizeField({ ...b, enabled: false, required: false }));
}

function parseFormConfig(raw) {
  let parsed = {};
  try { parsed = typeof raw === 'string' ? (JSON.parse(raw || '{}') || {}) : (raw || {}); } catch { parsed = {}; }

  // Formato novo: array de campos. Respeita a configuração tal como está
  // (inclusive remoções de campos padrão feitas pelo administrador).
  if (Array.isArray(parsed.fields)) {
    const fields = [];
    const seen = new Set();
    for (const f of parsed.fields) {
      const sf = sanitizeField(f);
      if (sf && !seen.has(sf.key)) { seen.add(sf.key); fields.push(sf); }
    }
    return { fields };
  }

  // Formato legado: objeto com chaves builtin.
  if (parsed && typeof parsed === 'object' && BUILTIN_KEYS.some((k) => parsed[k])) {
    const fields = [];
    for (const b of BUILTIN) {
      const cfg = parsed[b.key] || {};
      fields.push(sanitizeField({ key: b.key, label: cfg.label || b.label, type: b.type, enabled: cfg.enabled, required: cfg.required }));
    }
    return { fields };
  }

  // Sem configuração: oferece os campos padrão (desabilitados).
  return { fields: defaultFields() };
}

// Lista apenas os campos personalizados habilitados (para coleta/exportação).
function customFields(cfg) {
  return (cfg.fields || []).filter((f) => !f.builtin && f.enabled);
}
function enabledFields(cfg) {
  return (cfg.fields || []).filter((f) => f.enabled);
}

// Sanitiza a resposta de um campo personalizado conforme o tipo. Retorna o valor
// já tratado (string ou array para checkbox) ou null quando vazio/ inválido.
function sanitizeAnswer(field, v) {
  if (!field) return null;
  if (field.type === 'checkbox') {
    const arr = Array.isArray(v) ? v : (v != null && String(v).trim() ? [v] : []);
    const opts = field.options || [];
    const picked = arr.map((x) => String(x).trim()).filter((x) => opts.includes(x));
    return picked.length ? picked : null;
  }
  if (field.type === 'select' || field.type === 'radio') {
    const s = v != null ? String(v).trim() : '';
    return (field.options || []).includes(s) ? s : null;
  }
  if (field.type === 'boolean') {
    if (v === true || v === 'true' || v === 'Sim' || v === 'sim') return 'Sim';
    if (v === false || v === 'false' || v === 'Não' || v === 'nao' || v === 'não') return 'Não';
    return null;
  }
  const s = v != null ? String(v).trim().slice(0, 1000) : '';
  return s || null;
}

// Indica se um valor (string/array) está preenchido — útil para campos obrigatórios.
function isFilled(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v != null && String(v).trim() !== '';
}

// Converte o valor de um campo personalizado em texto (para exportações/listas).
function extraValueToText(field, value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (field && field.type === 'boolean') {
    if (value === true || value === 'true' || value === 'sim' || value === 'Sim') return 'Sim';
    if (value === false || value === 'false' || value === 'nao' || value === 'não' || value === 'Não') return 'Não';
  }
  return String(value);
}

module.exports = {
  BUILTIN, BUILTIN_KEYS, CUSTOM_TYPES, OPTION_TYPES,
  parseFormConfig, customFields, enabledFields, sanitizeField, defaultFields,
  extraValueToText, sanitizeAnswer, isFilled,
};
