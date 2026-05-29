// services/cripto.js
// Criptografa/decripta dados sensíveis (senha do certificado A1) usando AES-256-GCM
// Usa CERT_ENCRYPTION_KEY como variável de ambiente (32 bytes em hex = 64 caracteres)

const crypto = require('crypto');

const ALGORITMO = 'aes-256-gcm';
const KEY_HEX = process.env.CERT_ENCRYPTION_KEY || '';

function getKey() {
  if (!KEY_HEX || KEY_HEX.length !== 64) {
    throw new Error('CERT_ENCRYPTION_KEY não configurada ou inválida (precisa de 64 caracteres hex).');
  }
  return Buffer.from(KEY_HEX, 'hex');
}

// Gera uma chave nova (use no setup inicial)
function gerarChaveNova() {
  return crypto.randomBytes(32).toString('hex');
}

// Criptografa um texto, retorna string no formato: iv:tag:ciphertext (todos em hex)
function criptografar(texto) {
  if (!texto) return null;
  const key = getKey();
  const iv = crypto.randomBytes(12); // GCM usa IV de 12 bytes
  const cipher = crypto.createCipheriv(ALGORITMO, key, iv);
  let encrypted = cipher.update(texto, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}

// Decripta uma string no formato gerado por criptografar()
function decriptar(textoCripto) {
  if (!textoCripto) return null;
  const key = getKey();
  const partes = textoCripto.split(':');
  if (partes.length !== 3) throw new Error('Formato de texto criptografado inválido.');
  const [ivHex, tagHex, encrypted] = partes;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITMO, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Valida se a chave de criptografia está configurada (chama no boot do servidor)
function validarChaveConfigurada() {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

module.exports = { criptografar, decriptar, gerarChaveNova, validarChaveConfigurada };
