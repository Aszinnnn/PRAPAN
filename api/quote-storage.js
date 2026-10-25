import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function saveQuotePdf(orderId, pdf, directory) {
    if (!/^[0-9a-f-]{36}$/.test(orderId) || !Buffer.isBuffer(pdf) || pdf.subarray(0, 4).toString() !== '%PDF') {
        throw new Error('Orçamento inválido.');
    }
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stats = fs.lstatSync(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Pasta de orçamentos inválida.');
    if (stats.mode & 0o077) fs.chmodSync(directory, 0o700);
    const filename = `orcamento-prapan-${orderId.slice(0, 8)}-${crypto.randomUUID()}.pdf`;
    const file = path.join(directory, filename);
    fs.writeFileSync(file, pdf, { flag: 'wx', mode: 0o600 });
    return { filename, file };
}
