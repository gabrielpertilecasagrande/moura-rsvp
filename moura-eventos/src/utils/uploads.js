// Caminho único e canônico do diretório de uploads, compartilhado entre as
// rotas de arquivos e a exclusão de eventos (para limpar arquivos físicos).
const path = require('path');
const fs   = require('fs');

const uploadsDir = process.env.DATA_DIR
  ? path.join(path.resolve(process.env.DATA_DIR), 'uploads')
  : path.join(__dirname, '..', '..', 'uploads');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Remove com segurança um arquivo armazenado (ignora se já não existir).
function removeStoredFile(storedName) {
  if (!storedName) return;
  try {
    const filePath = path.join(uploadsDir, storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* não bloqueia a operação principal */ }
}

module.exports = { uploadsDir, removeStoredFile };
