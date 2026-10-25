import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const endpoint = 'https://api.brevo.com/v3/smtp/email';

export class BrevoEmailError extends Error {
    constructor(message, status = 503, details = null) {
        super(message);
        this.status = status;
        this.details = details;
    }
}

export function readBrevoConfig() {
    let apiKey = process.env.BREVO_API_KEY?.trim() || '';
    let senderEmail = process.env.BREVO_SENDER_EMAIL?.trim() || '';
    if (apiKey && senderEmail) return { apiKey, senderEmail };

    const folder = path.join(os.homedir(), '.local', 'share', 'prapan');
    const file = path.join(folder, 'brevo.json');
    try {
        const folderStat = fs.lstatSync(folder);
        const fileStat = fs.lstatSync(file);
        if (!folderStat.isDirectory() || (folderStat.mode & 0o077) || !fileStat.isFile() || (fileStat.mode & 0o077) || fileStat.size > 4096) {
            return { apiKey, senderEmail };
        }
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!apiKey && typeof data?.apiKey === 'string') apiKey = data.apiKey.trim();
        if (!senderEmail && typeof data?.senderEmail === 'string') senderEmail = data.senderEmail.trim();
    } catch {
        // Ignora caso arquivo não exista ou contenha formato inválido
    }
    return { apiKey, senderEmail };
}

export function idempotencyKeyFromSignature(signature) {
    if (!/^[0-9a-f]{64}$/.test(signature)) throw new BrevoEmailError('Assinatura do orçamento inválida.', 400);
    const value = signature.slice(0, 32);
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}

export async function sendAdminNotice({ email, subject, message, key, apiKey, senderEmail, fetcher = fetch }) {
    if (!apiKey || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail || '')) throw new BrevoEmailError('Notificação administrativa sem configuração válida.');
    if (typeof subject !== 'string' || subject.length > 120 || typeof message !== 'string' || message.length > 500) throw new BrevoEmailError('Notificação administrativa inválida.', 400);
    const signature = crypto.createHash('sha256').update(`prapan-admin:${key}`).digest('hex');
    const response = await fetcher(endpoint, {
        method: 'POST', headers: { 'api-key': apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: { name: 'PraPan', email: senderEmail }, to: [{ email }], subject, textContent: message, headers: { idempotencyKey: idempotencyKeyFromSignature(signature) } }),
        signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 201) throw new BrevoEmailError('Brevo não aceitou a notificação administrativa.', response.status);
    const result = await response.json().catch(() => null);
    if (!result?.messageId) throw new BrevoEmailError('Aceite administrativo sem identificador confirmado.');
    return result.messageId;
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export async function sendQuoteEmail({ order, pdf, filename, signature, apiKey, senderEmail, intro = '', fetcher = fetch }) {
    if (!apiKey || !senderEmail) throw new BrevoEmailError('Configure a chave da Brevo e o remetente verificado no servidor.');
    if (!order?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) throw new BrevoEmailError('E-mail de destino ou remetente inválido.', 409);
    if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 4).toString() !== '%PDF' || !/^orcamento-prapan-[0-9a-f-]+\.pdf$/.test(filename)) throw new BrevoEmailError('Anexo do orçamento inválido.', 400);

    const safeClient = escapeHtml(order.cliente);
    const safeIntro = typeof intro === 'string' && intro.length <= 240 && !/[\r\n\p{Cc}\p{Cf}]/u.test(intro) ? intro.trim() : '';
    const idempotencyKey = idempotencyKeyFromSignature(signature);

    const body = {
        sender: { name: 'PraPan', email: senderEmail },
        to: [{ name: order.cliente, email: order.email }],
        subject: `Orçamento PraPan ${order.id.slice(0, 8).toUpperCase()}`,
        textContent: `Olá, ${order.cliente}!\n\n${safeIntro ? `${safeIntro}\n\n` : ''}Segue em anexo o orçamento da PraPan para sua solicitação, com produtos e entrega.\n\nSe desejar dar continuidade, responda a este e-mail ou à nossa mensagem no WhatsApp.\n\nPraPan`,
        htmlContent: `<p>Olá, <strong>${safeClient}</strong>!</p>${safeIntro ? `<p>${escapeHtml(safeIntro)}</p>` : ''}<p>Segue em anexo o orçamento da PraPan para sua solicitação, com produtos e entrega.</p><p>Se desejar dar continuidade, responda a este e-mail ou à nossa mensagem no WhatsApp.</p><p>Atenciosamente,<br><strong>PraPan</strong></p>`,
        attachment: [{ name: filename, content: pdf.toString('base64') }],
        headers: {
            idempotencyKey,
            IdempotencyKey: idempotencyKey,
        },
    };

    let response;
    try {
        response = await fetcher(endpoint, {
            method: 'POST',
            headers: { 'api-key': apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000),
        });
    } catch {
        throw new BrevoEmailError('A resposta da Brevo é incerta. Confira o histórico de envios antes de tentar novamente.');
    }

    if (response.status !== 201) {
        const errorData = await response.json().catch(() => null);
        const detailMessage = typeof errorData?.message === 'string' ? errorData.message.trim() : '';
        const errorCode = typeof errorData?.code === 'string' ? errorData.code.trim() : '';
        const detail = detailMessage || errorCode || '';

        if (response.status === 400 && errorCode === 'duplicate_parameter') {
            throw new BrevoEmailError('Este orçamento já foi enviado recentemente para a Brevo (idempotência ativa). Aguarde alguns minutos antes de tentar novamente.', 409, detail);
        }
        if (response.status === 400 || response.status === 401 || response.status === 403) {
            const extra = detail ? `: ${detail}` : '';
            throw new BrevoEmailError(`A Brevo recusou o envio${extra}. Confira a chave, o remetente verificado e os dados do pedido.`, response.status, detail);
        }
        if (response.status === 429) {
            throw new BrevoEmailError('Limite de envios da Brevo atingido. Aguarde antes de tentar novamente.', 429, detail);
        }
        const extra = detail ? `: ${detail}` : '';
        throw new BrevoEmailError(`A Brevo não aceitou o e-mail${extra}. Confira o painel antes de tentar novamente.`, response.status, detail);
    }

    const result = await response.json().catch(() => null);
    if (typeof result?.messageId !== 'string' || !result.messageId || result.messageId.length > 200) {
        throw new BrevoEmailError('A Brevo aceitou a requisição, mas não confirmou o identificador. Confira o painel antes de tentar novamente.');
    }
    return result.messageId;
}
