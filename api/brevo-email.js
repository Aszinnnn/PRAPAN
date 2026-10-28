import crypto from 'node:crypto';
import fs from 'node:fs';
import { privateRoot } from './private-storage.js';
import path from 'node:path';

const endpoint = 'https://api.brevo.com/v3/smtp/email';

export function externalEmailAllowed() {
    return process.env.NODE_ENV === 'production' || process.env.PRAPAN_ALLOW_DEV_EMAILS === 'true';
}

export class BrevoEmailError extends Error {
    constructor(message, status = 503, details = null, reason = '') {
        super(message);
        this.status = status;
        this.details = details;
        this.reason = reason;
    }
}

export function readBrevoConfig() {
    let apiKey = process.env.BREVO_API_KEY?.trim() || '';
    let senderEmail = process.env.BREVO_SENDER_EMAIL?.trim() || '';
    if (apiKey && senderEmail) return { apiKey, senderEmail };

    const folder = privateRoot;
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

export function buildWhatsAppUrl(order, businessWhatsapp) {
    if (!/^55\d{10,11}$/.test(businessWhatsapp || '')) return '';
    const items = Array.isArray(order?.quote?.items) ? order.quote.items : Array.isArray(order?.items) ? order.items : [];
    const summary = items.slice(0, 20).map((item) => `${item.name || item.id}: ${item.quantity} un.`).join('\n');
    const message = `Olá, PraPan! Sou ${order.cliente}. Quero dar continuidade ao orçamento ${order.id.slice(0, 8).toUpperCase()}.${summary ? `\n\nMeu pedido:\n${summary}` : ''}`;
    return `https://wa.me/${businessWhatsapp}?text=${encodeURIComponent(message)}`;
}

export async function sendQuoteEmail({ order, pdf, filename, signature, apiKey, senderEmail, intro = '', businessWhatsapp = '', fetcher = fetch }) {
    if (!apiKey || !senderEmail) throw new BrevoEmailError('Configure a chave da Brevo e o remetente verificado no servidor.', 503, null, 'configuration');
    if (!order?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) throw new BrevoEmailError('E-mail de destino ou remetente inválido.', 409);
    if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 4).toString() !== '%PDF' || !/^orcamento-prapan-[0-9a-f-]+\.pdf$/.test(filename)) throw new BrevoEmailError('Anexo do orçamento inválido.', 400);

    const safeClient = escapeHtml(order.cliente);
    const safeIntro = typeof intro === 'string' && intro.length <= 240 && !/[\r\n\p{Cc}\p{Cf}]/u.test(intro) ? intro.trim() : '';
    const idempotencyKey = idempotencyKeyFromSignature(signature);
    const orderCode = order.id.slice(0, 8).toUpperCase();
    const whatsappUrl = buildWhatsAppUrl(order, businessWhatsapp);
    const safeWhatsappUrl = escapeHtml(whatsappUrl);
    const textContact = whatsappUrl ? `\n\nFale com a PraPan pelo WhatsApp e leve os dados deste pedido:\n${whatsappUrl}` : '\n\nSe desejar dar continuidade, responda a este e-mail.';
    const contactBlock = whatsappUrl ? `<tr><td style="padding:0 34px 34px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eaf2d1;border:1px solid #c9dc91;border-radius:18px"><tr><td style="padding:24px 26px"><p style="margin:0 0 8px;color:#55722f;font-size:12px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase">Próximo passo</p><p style="margin:0 0 18px;color:#342015;font-size:20px;font-weight:800;line-height:1.3">Seu pedido já vai pronto para a conversa.</p><a href="${safeWhatsappUrl}" target="_blank" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#3f6628;color:#ffffff;font-size:15px;font-weight:800;text-decoration:none">Continuar pelo WhatsApp&nbsp;&nbsp;→</a><p style="margin:16px 0 0;color:#59634b;font-size:12px;line-height:1.5">Ao abrir, confira a mensagem e toque em enviar. O WhatsApp não recebe o PDF automaticamente.</p></td></tr></table></td></tr>` : '';

    const body = {
        sender: { name: 'PraPan', email: senderEmail },
        to: [{ name: order.cliente, email: order.email }],
        subject: `Orçamento PraPan ${orderCode}`,
        textContent: `Olá, ${order.cliente}!\n\n${safeIntro ? `${safeIntro}\n\n` : ''}Seu orçamento PraPan está pronto e segue em anexo, com produtos e entrega.\nCódigo do pedido: ${orderCode}.${textContact}\n\nPraPan — Muito mais paladar e qualidade.`,
        htmlContent: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Orçamento PraPan</title></head><body style="margin:0;padding:0;background:#eee9df;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;color:transparent">Seu orçamento PraPan está pronto.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eee9df"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;overflow:hidden;background:#fffdf8;border-radius:24px;box-shadow:0 18px 45px rgba(67,39,23,.12)"><tr><td style="padding:32px 34px 28px;background:#60371f"><table role="presentation" width="100%"><tr><td style="color:#d6e997;font-size:13px;font-weight:800;letter-spacing:2px;text-transform:uppercase">PraPan</td><td align="right"><span style="display:inline-block;padding:7px 11px;border:1px solid rgba(255,255,255,.35);border-radius:999px;color:#fff;font-size:11px">Pedido ${orderCode}</span></td></tr></table><h1 style="margin:42px 0 8px;color:#fff;font-size:38px;line-height:1.04;letter-spacing:-1.5px">Seu próximo lote<br><span style="color:#c7df79">começa aqui.</span></h1></td></tr><tr><td style="padding:32px 34px 24px"><p style="margin:0 0 16px;color:#382217;font-size:20px;line-height:1.45">Olá, <strong>${safeClient}</strong>.</p>${safeIntro ? `<p style="margin:0 0 16px;color:#5e5148;font-size:15px;line-height:1.65">${escapeHtml(safeIntro)}</p>` : ''}<p style="margin:0;color:#5e5148;font-size:15px;line-height:1.65">Preparamos seu orçamento com os produtos solicitados e o custo de entrega. O documento completo está anexado a este e-mail.</p></td></tr><tr><td style="padding:0 34px 28px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="width:9px;background:#a9c958;border-radius:8px"></td><td style="padding:15px 18px;background:#f5f1e9;color:#6b5a4d;font-size:13px;line-height:1.5"><strong style="display:block;color:#382217;font-size:15px">Orçamento ${orderCode}</strong>Abra o PDF anexo para conferir quantidades, valores e entrega.</td></tr></table></td></tr>${contactBlock}<tr><td style="padding:22px 34px;background:#2e211a;color:#d9d0c8;font-size:12px;line-height:1.6">PraPan · Muito mais paladar e qualidade.<br><span style="color:#9fbd58">Este e-mail foi gerado para a sua solicitação de orçamento.</span></td></tr></table></td></tr></table></body></html>`,
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
        throw new BrevoEmailError('A resposta da Brevo é incerta. Confira o histórico de envios antes de tentar novamente.', 503, null, 'network');
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
        throw new BrevoEmailError('A Brevo aceitou a requisição, mas não confirmou o identificador. Confira o painel antes de tentar novamente.', 503, null, 'missing_message_id');
    }
    return result.messageId;
}
