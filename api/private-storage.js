import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const configured = process.env.PRAPAN_DATA_DIR;
if (configured && !path.isAbsolute(configured)) throw new Error('PRAPAN_DATA_DIR deve ser um caminho absoluto.');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resolved = path.resolve(configured || path.join(os.homedir(), '.local', 'share', 'prapan'));
let existing = resolved;
while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
const real = path.resolve(fs.realpathSync(existing), path.relative(existing, resolved));
if (configured && (real === projectRoot || real.startsWith(`${projectRoot}${path.sep}`))) {
    throw new Error('PRAPAN_DATA_DIR não pode ficar dentro do projeto ou de pastas públicas.');
}

export const privateRoot = real;
