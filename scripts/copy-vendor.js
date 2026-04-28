'use strict';
/**
 * Copia os bundles UMD de React, ReactDOM e Babel-standalone do node_modules
 * para renderer/vendor/. Chamado em postinstall e antes de start/build.
 *
 * Mantém o app totalmente offline: nenhum CDN é necessário em runtime.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'renderer', 'vendor');

const files = [
  { src: ['node_modules', 'react', 'umd', 'react.production.min.js'],          dest: 'react.production.min.js' },
  { src: ['node_modules', 'react-dom', 'umd', 'react-dom.production.min.js'],  dest: 'react-dom.production.min.js' },
  { src: ['node_modules', '@babel', 'standalone', 'babel.min.js'],             dest: 'babel.min.js' },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyOne({ src, dest }) {
  const srcPath = path.join(ROOT, ...src);
  const destPath = path.join(VENDOR, dest);
  if (!fs.existsSync(srcPath)) {
    console.warn(`[vendor] ⚠ ausente: ${srcPath}`);
    return false;
  }
  fs.copyFileSync(srcPath, destPath);
  return true;
}

ensureDir(VENDOR);
let ok = 0, total = files.length;
for (const f of files) if (copyOne(f)) ok++;
console.log(`[vendor] ${ok}/${total} bundles copiados para ${VENDOR}`);
if (ok < total) process.exit(0); // não falha o install se os pacotes ainda não existem
