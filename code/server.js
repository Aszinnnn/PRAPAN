import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createServer as createViteServer } from 'vite';
import { createOrder, listOrders, updateShipping, updateRoute, updateOrderEmail, quoteEmailSignature, markQuoteEmailSent, OrderError } from '../api/orders.js';
import { getRoadDistance, FreightError } from '../api/freight.js';
import { validateDestination, AddressError } from '../api/address.js';
import { claimDashboardEntry } from '../api/dashboard-access.js';
import { renderQuotePdf } from '../api/quote-pdf.js';
import { saveQuotePdf } from '../api/quote-storage.js';
import { sendQuoteEmail, BrevoEmailError, readBrevoConfig } from '../api/brevo-email.js';
import { confirmCommercialRules, readSentinelConfig, saveSentinelConfig, setAutoSalesEnabled } from '../api/sentinel-config.js';
import { createSentinelAgent, sentinelReadiness } from '../api/sentinel-agent.js';
import { fetchAnpDiesel } from '../api/fuel-anp.js';
import { recordSentinel, sentinelSummary } from '../api/sentinel-store.js';

const codeRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(codeRoot);
const privateRoot = path.join(os.homedir(), '.local', 'share', 'prapan');
const csvFile = path.join(privateRoot, 'admin.csv');
const emailPermitido = process.env.ADMIN_LOGIN_EMAIL?.trim().toLowerCase();
if (!emailPermitido || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(emailPermitido)) {
    throw new Error('ADMIN_LOGIN_EMAIL deve conter o e-mail administrativo válido.');
}
const port = 4173;
const origin = `http://127.0.0.1:${port}`;
const sessionCookie = 'prapan.sid';
const csrfCookie = 'prapan.csrf';
const idleMs = 20 * 60 * 1000;
const absoluteMs = 8 * 60 * 60 * 1000;
const sessions = new Map();
const fakeSalt = crypto.randomBytes(16);
const fakeHash = crypto.randomBytes(64);

function derive(password, salt) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, hash) => {
            if (error) reject(error);
            else resolve(hash);
        });
    });
}

async function readHiddenPassword() {
    if (!process.stdin.isTTY) throw new Error('Execute a preparação em um terminal interativo.');
    process.stdout.write('Senha da conta administrativa: ');
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    let password = '';
    try {
        return await new Promise((resolve, reject) => {
            function receive(chunk) {
                for (const character of chunk) {
                    if (character === '\u0003') {
                        process.stdin.off('data', receive);
                        reject(new Error('Operação interrompida.'));
                        return;
                    }
                    if (character === '\r' || character === '\n') {
                        process.stdin.off('data', receive);
                        resolve(password);
                        return;
                    }
                    if (character === '\u007f' || character === '\b') password = password.slice(0, -1);
                    else if (password.length < 128) password += character;
                }
            }
            process.stdin.on('data', receive);
            process.stdin.resume();
        });
    } finally {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
    }
}

async function seed() {
    if (fs.existsSync(csvFile)) throw new Error('admin.csv já existe. Nenhuma credencial foi alterada.');
    let password = await readHiddenPassword();
    if (password.length < 12 || Buffer.byteLength(password) > 128) throw new Error('Senha deve ter entre 12 e 128 bytes.');
    const salt = crypto.randomBytes(16);
    const hash = await derive(password, salt);
    password = '';
    fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
    if (fs.statSync(privateRoot).mode & 0o077) throw new Error('Pasta privada deve ter permissão 700.');
    fs.writeFileSync(csvFile, `email,salt,hash,algorithm\n${emailPermitido},${salt.toString('hex')},${hash.toString('hex')},scrypt-131072-8-1\n`, { flag: 'wx', mode: 0o600 });
    fs.chmodSync(csvFile, 0o600);
    console.log('Conta preparada. CSV contém apenas salt e hash.');
}

function loadOwner() {
    if (!fs.existsSync(csvFile)) throw new Error('Falta admin.csv. Execute pnpm seed:admin.');
    if (fs.statSync(privateRoot).mode & 0o077) throw new Error('Pasta privada deve ter permissão 700.');
    if (fs.statSync(csvFile).mode & 0o077) throw new Error('admin.csv deve ter permissão 600.');
    const lines = fs.readFileSync(csvFile, 'utf8').trimEnd().split(/\r?\n/);
    if (lines.length !== 2 || lines[0] !== 'email,salt,hash,algorithm') throw new Error('CSV inválido.');
    const fields = lines[1].split(',');
    if (fields.length !== 4 || fields[0] !== emailPermitido || !/^[a-f0-9]{32}$/.test(fields[1]) || !/^[a-f0-9]{128}$/.test(fields[2]) || fields[3] !== 'scrypt-131072-8-1') {
        throw new Error('CSV inválido ou conta não autorizada.');
    }
    return { email: fields[0], salt: Buffer.from(fields[1], 'hex'), hash: Buffer.from(fields[2], 'hex') };
}

function readCookie(request, name) {
    const pair = (request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    const value = pair?.slice(name.length + 1);
    return value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : '';
}

function safeEqual(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function currentSession(request) {
    const id = readCookie(request, sessionCookie);
    const session = sessions.get(id);
    const now = Date.now();
    if (!session) return null;
    if (now - session.lastSeen > idleMs || now - session.createdAt > absoluteMs) {
        sessions.delete(id);
        return null;
    }
    session.lastSeen = now;
    return session;
}

function checkOrigin(request, response, next) {
    if (request.get('Origin') !== origin || request.get('Sec-Fetch-Site') === 'cross-site') return response.status(403).json({ error: 'Solicitação recusada.' });
    next();
}

function checkCsrf(request, response, next) {
    if (!safeEqual(request.get('X-CSRF-Token'), readCookie(request, csrfCookie))) return response.status(403).json({ error: 'Solicitação recusada.' });
    next();
}

if (process.argv.includes('--seed')) {
    try { await seed(); } catch (error) { console.error(error.message); process.exitCode = 1; }
} else {
    if (process.env.NODE_ENV === 'production') throw new Error('Publicação bloqueada: configure HTTPS e sessões persistentes antes de expor o painel.');
    const owner = loadOwner();
    const app = express();
    const sentinel = createSentinelAgent({ pdfDirectory: path.join(projectRoot, 'PDF') });
    app.disable('x-powered-by');
    app.disable('etag');

    const securityHeaders = helmet({
        hsts: false,
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'"],
                imgSrc: ["'self'", 'data:'],
                connectSrc: ["'self'"],
                objectSrc: ["'none'"],
                frameAncestors: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
            },
        },
    });
    const noCache = (_request, response, next) => {
        response.setHeader('Cache-Control', 'no-store, max-age=0');
        next();
    };

    app.use('/api', securityHeaders, noCache, express.json({ limit: '4kb', strict: true, inflate: false }));
    app.get('/api/csrf', (_request, response) => {
        const token = crypto.randomBytes(32).toString('base64url');
        response.cookie(csrfCookie, token, { httpOnly: true, sameSite: 'strict', secure: false, path: '/', maxAge: 15 * 60 * 1000 });
        response.json({ token });
    });

    const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde.' } });
    app.post('/api/login', checkOrigin, loginLimit, checkCsrf, async (request, response) => {
        const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
        const password = typeof request.body?.password === 'string' ? request.body.password : '';
        if (!password || Buffer.byteLength(email) > 254 || Buffer.byteLength(password) > 128) return response.status(401).json({ error: 'E-mail ou senha inválidos.' });
        try {
            const known = safeEqual(email, owner.email);
            const candidate = await derive(password, known ? owner.salt : fakeSalt);
            if (!known || !crypto.timingSafeEqual(candidate, known ? owner.hash : fakeHash)) return response.status(401).json({ error: 'E-mail ou senha inválidos.' });
            sessions.clear();
            const id = crypto.randomBytes(32).toString('base64url');
            const now = Date.now();
            sessions.set(id, { createdAt: now, lastSeen: now, dashboardEntryPending: true });
            response.cookie(sessionCookie, id, { httpOnly: true, sameSite: 'strict', secure: false, path: '/', maxAge: absoluteMs });
            response.clearCookie(csrfCookie, { path: '/', sameSite: 'strict' });
            response.json({ authenticated: true });
        } catch {
            response.status(503).json({ error: 'Acesso temporariamente indisponível.' });
        }
    });

    app.get('/api/session', (request, response) => {
        if (!currentSession(request)) return response.status(401).json({ authenticated: false });
        response.json({ authenticated: true });
    });

    const orderLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Muitas solicitações. Aguarde 15 minutos.' } });
    app.post('/api/orders', checkOrigin, orderLimit, checkCsrf, async (request, response) => {
        try {
            const order = await createOrder(request.body);
            response.status(201).json({ order });
            try {
                recordSentinel({ orderId: order.id, operation: 'received', status: 'ok', message: 'Solicitação recebida.', notification: true, job: { status: 'received' } });
                setImmediate(() => { void sentinel.processOrder(order.id).then(() => sentinel.flushNotifications()).catch(() => console.error('[Sentinel] Processamento indisponível.')); });
            } catch (error) {
                console.error('[Sentinel] Não foi possível registrar o evento:', error instanceof Error ? error.name : 'Erro');
            }
        } catch (error) {
            if (error instanceof OrderError) return response.status(error.status).json({ error: error.message });
            console.error('Falha ao gravar pedido:', error);
            response.status(503).json({ error: 'Não foi possível registrar o pedido. Tente novamente.' });
        }
    });

    app.get('/api/orders', (request, response) => {
        if (!currentSession(request)) return response.status(401).json({ error: 'Acesso não autorizado.' });
        try {
            response.json({ orders: listOrders() });
        } catch (error) {
            console.error('Falha ao ler pedidos:', error);
            response.status(503).json({ error: 'Pedidos temporariamente indisponíveis.' });
        }
    });

    const sentinelAdmin = (request, response, next) => {
        if (!currentSession(request)) return response.status(401).json({ error: 'Acesso não autorizado.' });
        next();
    };
    const sentinelLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
    app.get('/api/sentinel', sentinelAdmin, (_request, response) => {
        try { const config = readSentinelConfig(); response.json({ config, readiness: sentinelReadiness(config), ...sentinelSummary(listOrders()) }); }
        catch { response.status(503).json({ error: 'Sentinel indisponível.' }); }
    });
    app.post('/api/sentinel/activation', checkOrigin, checkCsrf, sentinelAdmin, sentinelLimit, async (request, response) => {
        try {
            if (typeof request.body?.enabled !== 'boolean') return response.status(422).json({ error: 'Estado inválido.' });
            if (request.body.enabled) {
                let rules = request.body.rules;
                if (rules?.fuelSource === 'ANP') {
                    // Preço e data vêm da ANP, nunca do navegador ou do Gemini.
                    const reference = await fetchAnpDiesel();
                    const current = readSentinelConfig();
                    saveSentinelConfig({ ...current, publicFuelReference: { ...reference, fetchedAt: new Date().toISOString() } });
                    rules = { ...rules, fuelPriceCents: reference.priceCents, fuelReferenceDate: reference.date };
                }
                confirmCommercialRules(rules);
                recordSentinel({ operation: 'rules', status: 'confirmed', message: 'Preços e parâmetros comerciais autorizados pela proprietária.' });
            }
            const config = setAutoSalesEnabled(request.body?.enabled);
            recordSentinel({ operation: 'activation', status: config.autoSalesEnabled ? 'enabled' : 'disabled', message: config.autoSalesEnabled ? 'Vendas automáticas ativadas.' : 'Vendas automáticas suspensas.' });
            if (config.autoSalesEnabled) setImmediate(() => { void sentinel.scan(); });
            response.json({ config });
        } catch (error) { response.status(error?.message === 'ANP indisponível.' ? 503 : 422).json({ error: error?.message || 'Configuração inválida.' }); }
    });
    app.post('/api/sentinel/reprocess/:id', checkOrigin, checkCsrf, sentinelAdmin, sentinelLimit, (request, response) => {
        try {
            const id = request.params.id;
            if (!/^[0-9a-f-]{36}$/.test(id) || !listOrders().some((order) => order.id === id)) return response.status(404).json({ error: 'Pedido não encontrado.' });
            const job = sentinelSummary(listOrders()).jobs[id];
            if (['sending', 'sent', 'uncertain'].includes(job?.status)) return response.status(409).json({ error: 'Confira o estado do envio na Brevo antes de reprocessar.' });
            setImmediate(() => { void sentinel.processOrder(id); });
            response.status(202).json({ queued: true });
        } catch { response.status(503).json({ error: 'Não foi possível reprocessar.' }); }
    });

    const contactLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Muitas alterações de contato. Aguarde.' } });
    app.patch('/api/orders/:id/email', checkOrigin, checkCsrf, (request, response, next) => {
        if (!currentSession(request)) return response.status(401).json({ error: 'Acesso não autorizado.' });
        next();
    }, contactLimit, (request, response) => {
        try {
            response.json({ order: updateOrderEmail(request.params.id, request.body?.email) });
        } catch (error) {
            if (error instanceof OrderError) return response.status(error.status).json({ error: error.message });
            console.error('Falha ao atualizar e-mail do pedido:', error);
            response.status(503).json({ error: 'Não foi possível salvar o e-mail.' });
        }
    });

    const pdfLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Muitas gerações de PDF. Aguarde.' } });
    const emailSending = new Set();
    const emailLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Muitos envios de e-mail. Aguarde.' } });
    app.post('/api/orders/:id/quote/email', checkOrigin, checkCsrf, (request, response, next) => {
        if (!currentSession(request)) return response.status(401).json({ error: 'Acesso não autorizado.' });
        next();
    }, emailLimit, async (request, response) => {
        const id = request.params.id;
        if (!/^[0-9a-f-]{36}$/.test(id)) return response.status(400).json({ error: 'Pedido inválido.' });
        if (emailSending.has(id)) return response.status(409).json({ error: 'Este orçamento já está sendo enviado.' });
        emailSending.add(id);
        try {
            const order = listOrders().find((entry) => entry.id === id);
            if (!order) return response.status(404).json({ error: 'Pedido não encontrado.' });
            if (!order.email) return response.status(409).json({ error: 'Este pedido antigo não possui e-mail. Não é possível enviá-lo automaticamente.' });
            if (order.quote.totalCents === null) return response.status(409).json({ error: 'Confirme o frete antes de enviar o orçamento.' });
            const signature = quoteEmailSignature(order);
            if (order.quoteEmailSignature === signature && order.quoteEmailSentAt) return response.json({ accepted: true, alreadySent: true, email: order.email, order });
            const brevoConfig = readBrevoConfig();
            if (!brevoConfig.apiKey || !brevoConfig.senderEmail) {
                return response.status(503).json({
                    error: 'Configuração da Brevo ausente. Defina BREVO_API_KEY e BREVO_SENDER_EMAIL no arquivo .env ou em ~/.local/share/prapan/brevo.json.'
                });
            }
            const pdf = await renderQuotePdf(order);
            const { filename } = saveQuotePdf(id, pdf, path.join(projectRoot, 'PDF'));
            const messageId = await sendQuoteEmail({ order, pdf, filename, signature, apiKey: brevoConfig.apiKey, senderEmail: brevoConfig.senderEmail });
            let updated;
            try {
                updated = markQuoteEmailSent(id, signature, messageId);
            } catch {
                console.error('E-mail aceito pela Brevo, mas não foi possível registrar o envio no CSV.');
                return response.status(503).json({ error: 'A Brevo aceitou o e-mail, mas o registro local falhou. Confira o painel da Brevo antes de repetir.' });
            }
            response.json({ accepted: true, alreadySent: false, email: order.email, order: updated });
        } catch (error) {
            if (error instanceof BrevoEmailError) {
                console.error(`[Brevo] Erro no envio (${error.status}):`, error.message, error.details || '');
                return response.status(error.status).json({ error: error.message });
            }
            console.error('Falha ao preparar envio do orçamento por e-mail:', error);
            response.status(503).json({ error: 'Não foi possível preparar o envio do orçamento.' });
        } finally {
            emailSending.delete(id);
        }
    });
    app.post('/api/orders/:id/quote/prepare', checkOrigin, checkCsrf, (request, response, next) => {
        if (!currentSession(request)) return response.status(401).json({ error: 'Acesso não autorizado.' });
        next();
    }, pdfLimit, async (request, response) => {
        if (!/^[0-9a-f-]{36}$/.test(request.params.id)) return response.status(400).json({ error: 'Pedido inválido.' });
        try {
            const order = listOrders().find((entry) => entry.id === request.params.id);
            if (!order) return response.status(404).json({ error: 'Pedido não encontrado.' });
            if (order.quote.totalCents === null) return response.status(409).json({ error: 'Confirme o frete antes de gerar o orçamento.' });
            const pdf = await renderQuotePdf(order);
            const { filename } = saveQuotePdf(order.id, pdf, path.join(projectRoot, 'PDF'));
            response.setHeader('X-Quote-Filename', filename);
            response.attachment(filename);
            response.send(pdf);
        } catch (error) {
            console.error('Falha ao preparar orçamento em PDF:', error);
            response.status(503).json({ error: 'Não foi possível preparar o PDF.' });
        }
    });
    app.get('/api/orders/:id/quote.pdf', (request, response, next) => {
        if (!currentSession(request)) return response.status(401).json({ error: 'Acesso não autorizado.' });
        next();
    }, pdfLimit, async (request, response) => {
        if (!/^[0-9a-f-]{36}$/.test(request.params.id)) return response.status(400).json({ error: 'Pedido inválido.' });
        try {
            const order = listOrders().find((entry) => entry.id === request.params.id);
            if (!order) return response.status(404).json({ error: 'Pedido não encontrado.' });
            if (order.quote.totalCents === null) return response.status(409).json({ error: 'Confirme o frete antes de gerar o orçamento.' });
            const pdf = await renderQuotePdf(order);
            response.attachment(`orcamento-prapan-${order.id.slice(0, 8)}.pdf`);
            response.send(pdf);
        } catch (error) {
            console.error('Falha ao gerar orçamento em PDF:', error);
            response.status(503).json({ error: 'Não foi possível gerar o PDF.' });
        }
    });

    const routeLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Muitas consultas de rota. Aguarde.' } });
    app.post('/api/orders/:id/route', checkOrigin, checkCsrf, (request, response, next) => {
        if (!currentSession(request)) return response.status(401).json({ error: 'Acesso não autorizado.' });
        next();
    }, routeLimit, async (request, response) => {
        try {
            const order = listOrders().find((entry) => entry.id === request.params.id);
            if (!order) return response.status(404).json({ error: 'Pedido não encontrado.' });
            const postalReference = await validateDestination(order);
            const route = await getRoadDistance(order, { postalReference });
            response.json({ route, order: updateRoute(order.id, route) });
        } catch (error) {
            if (error instanceof FreightError) return response.status(error.status).json({ error: error.message });
            if (error instanceof AddressError) return response.status(error.status).json({ error: error.message });
            if (error instanceof OrderError) return response.status(error.status).json({ error: error.message });
            console.error('Falha ao consultar rota:', error);
            response.status(503).json({ error: 'Rota indisponível. Confira a distância manualmente.' });
        }
    });

    const shippingLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Muitas alterações. Aguarde.' } });
    app.patch('/api/orders/:id/shipping', checkOrigin, shippingLimit, checkCsrf, (request, response) => {
        if (!currentSession(request)) return response.status(401).json({ error: 'Acesso não autorizado.' });
        try {
            response.json({ order: updateShipping(request.params.id, request.body) });
        } catch (error) {
            if (error instanceof OrderError) return response.status(error.status).json({ error: error.message });
            console.error('Falha ao atualizar frete:', error);
            response.status(503).json({ error: 'Não foi possível atualizar o frete.' });
        }
    });

    app.post('/api/logout', checkOrigin, checkCsrf, (request, response) => {
        if (!currentSession(request)) return response.status(401).json({ authenticated: false });
        sessions.delete(readCookie(request, sessionCookie));
        response.clearCookie(sessionCookie, { path: '/', sameSite: 'strict' });
        response.clearCookie(csrfCookie, { path: '/', sameSite: 'strict' });
        response.status(204).end();
    });

    app.get('/code/login.html', securityHeaders, noCache, (_request, response) => response.sendFile(path.join(codeRoot, 'login.html')));
    app.head('/dashboard', securityHeaders, noCache, (_request, response) => response.sendStatus(405));
    app.get('/dashboard', securityHeaders, noCache, (request, response) => {
        const session = currentSession(request);
        if (!claimDashboardEntry(session)) {
            if (session) sessions.delete(readCookie(request, sessionCookie));
            response.clearCookie(sessionCookie, { path: '/', sameSite: 'strict' });
            return response.redirect(303, '/code/login.html');
        }
        response.sendFile(path.join(codeRoot, 'dashboard.html'));
    });

    const vite = await createViteServer({ root: projectRoot, appType: 'custom', server: { middlewareMode: true, hmr: false } });
    app.use((request, response, next) => {
        const pathname = request.path;
        if (pathname === '/code/dashboard.jsx' && !currentSession(request)) return response.sendStatus(401);
        if (pathname === '/code/login.jsx' || pathname === '/code/dashboard.jsx' || pathname.startsWith('/node_modules/.vite/deps/') || pathname === '/@vite/client') {
            return vite.middlewares(request, response, next);
        }
        next();
    });

    const publicCodeFiles = new Set([
        '/app.js', '/dashboard.css', '/home.css', '/index.html', '/login.css', '/login.html',
        '/login-loader.js', '/orcamentos.css', '/orcamentos.html', '/orcamentos.js',
        '/sobre.css', '/sobre.html', '/style.css',
    ]);
    app.use('/code', (request, response, next) => {
        if (!publicCodeFiles.has(request.path)) return response.sendStatus(404);
        next();
    }, express.static(codeRoot, { index: false, dotfiles: 'deny' }));
    app.use('/public', express.static(path.join(projectRoot, 'public'), { index: false, dotfiles: 'deny' }));
    app.get('/', (_request, response) => response.redirect('/code/index.html'));
    app.use((error, _request, response, _next) => {
        if (response.headersSent) return;
        const status = error.status === 413 ? 413 : error.status === 400 ? 400 : 500;
        response.status(status).json({ error: status === 413 ? 'Solicitação muito grande.' : status === 400 ? 'Solicitação inválida.' : 'Falha interna.' });
    });

    const server = app.listen(port, '127.0.0.1', () => console.log(`PraPan disponível em ${origin}/code/index.html`));
    const minuteMatch = /^\*\/(\d{1,2}) \* \* \* \*$/.exec(process.env.SENTINEL_CRON || '*/15 * * * *');
    const minutes = minuteMatch ? Math.max(1, Math.min(60, Number(minuteMatch[1]))) : 15;
    const scanTimer = setInterval(() => { void sentinel.scan().then(() => sentinel.flushNotifications()).catch(() => console.error('[Sentinel] Varredura indisponível.')); }, minutes * 60 * 1000);
    scanTimer.unref();
    setImmediate(() => { void sentinel.scan().then(() => sentinel.flushNotifications()).catch(() => console.error('[Sentinel] Recuperação indisponível.')); });
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`Porta ${port} já está em uso por outro processo.`);
        } else {
            console.error('Erro ao iniciar servidor:', err);
        }
        process.exit(1);
    });
}
