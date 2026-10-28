import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { quoteEmailSignature } from './orders.js';
import { sentinelRoot } from './sentinel-config.js';

export const sentinelStateFile = path.join(sentinelRoot, 'sentinel-state.json');
const empty = () => ({ version: 1, jobs: {}, events: [], notifications: [], counters: { processed: 0, geminiCalls: 0, tokens: 0, analysisCount: 0, analysisDurationMs: 0 } });

export function readSentinelState(file = sentinelStateFile) {
    if (!fs.existsSync(file)) return empty();
    const folder = fs.lstatSync(path.dirname(file));
    const stat = fs.lstatSync(file);
    if (!folder.isDirectory() || folder.mode & 0o077 || !stat.isFile() || stat.mode & 0o077 || stat.size > 2 * 1024 * 1024) throw new Error('Estado Sentinel inseguro.');
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (state?.version !== 1 || !state.jobs || !Array.isArray(state.events) || !Array.isArray(state.notifications)) throw new Error('Estado Sentinel inválido.');
    state.counters ||= empty().counters;
    return state;
}

export function saveSentinelState(state, file = sentinelStateFile) {
    const folder = path.dirname(file);
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(folder).mode & 0o077) throw new Error('Pasta privada deve ter permissão 700.');
    const temporary = path.join(folder, `.sentinel-state-${crypto.randomUUID()}.tmp`);
    try {
        fs.writeFileSync(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return state;
}

export function recordSentinel({ orderId = '', operation, status, provider = 'PraPan', durationMs = 0, tokens = 0, message = '', notification = false, job = null }, file = sentinelStateFile) {
    const state = readSentinelState(file);
    const at = new Date().toISOString();
    const safe = String(message).replace(/[\r\n\p{Cc}\p{Cf}]/gu, ' ').slice(0, 180);
    const event = { id: crypto.randomUUID(), at, orderId, operation, status, provider, durationMs: Math.max(0, Math.round(durationMs)), tokens: Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : 0, message: safe };
    if (operation === 'start' && orderId && !state.jobs[orderId]?.startedAt) {
        state.counters.processed++;
        job = { ...job, startedAt: at };
    }
    if (operation === 'gemini-call') state.counters.geminiCalls++;
    if (operation === 'analysis' && status === 'ok') { state.counters.tokens += event.tokens; state.counters.analysisCount++; state.counters.analysisDurationMs += event.durationMs; }
    state.events.push(event);
    state.events = state.events.slice(-1500);
    if (notification) {
        const key = `${orderId}:${operation}:${status}`;
        if (!state.notifications.some((item) => item.key === key)) state.notifications.push({ key, at, orderId, operation, status, message: safe, read: false });
        state.notifications = state.notifications.slice(-500);
    }
    if (job && orderId) state.jobs[orderId] = { ...(state.jobs[orderId] || {}), ...job, updatedAt: at };
    saveSentinelState(state, file);
    return event;
}

export function sentinelSummary(orders, file = sentinelStateFile) {
    const state = readSentinelState(file);
    const jobs = Object.values(state.jobs);
    const avg = state.counters.analysisCount ? Math.round(state.counters.analysisDurationMs / state.counters.analysisCount) : 0;
    const recentCutoff = Date.now() - 30 * 86400000;
    const productVolume = new Map();
    let unitsRequested = 0;
    let acceptedProposalCents = 0;
    let acceptedProposals = 0;
    let received30Days = 0;
    for (const order of orders) {
        if (Number.isFinite(Date.parse(order.createdAt)) && Date.parse(order.createdAt) >= recentCutoff) received30Days++;
        for (const item of order.items || []) {
            if (!Number.isSafeInteger(item.quantity) || item.quantity < 0) continue;
            unitsRequested += item.quantity;
            const current = productVolume.get(item.id) || { id: item.id, name: item.name || item.id, units: 0, orders: 0 };
            current.units += item.quantity;
            current.orders++;
            productVolume.set(item.id, current);
        }
        if (order.quoteEmailSentAt && order.quoteEmailSignature === quoteEmailSignature(order)
            && Number.isSafeInteger(order.quote?.totalCents) && order.quote.totalCents >= 0) {
            acceptedProposals++;
            acceptedProposalCents += order.quote.totalCents;
        }
    }
    return {
        metrics: {
            received: orders.length, processed: state.counters.processed,
            sent: jobs.filter((job) => job.status === 'sent').length,
            review: jobs.filter((job) => job.status === 'review' || job.status === 'uncertain').length,
            failed: jobs.filter((job) => ['uncertain', 'retry', 'failed'].includes(job.status)).length,
            alerts: state.notifications.filter((item) => !item.read).length,
            geminiCalls: state.counters.geminiCalls,
            tokens: state.counters.tokens,
            averageAnalysisMs: avg,
            successRate: state.counters.processed ? Math.round(jobs.filter((job) => job.status === 'sent').length / state.counters.processed * 100) : 0,
        },
        commercial: {
            received30Days, unitsRequested, acceptedProposals, acceptedProposalCents,
            averageAcceptedProposalCents: acceptedProposals ? Math.round(acceptedProposalCents / acceptedProposals) : 0,
            topProducts: [...productVolume.values()].sort((a, b) => b.units - a.units || a.name.localeCompare(b.name, 'pt-BR')).slice(0, 3),
        },
        jobs: state.jobs, events: state.events.slice(-100).reverse(), notifications: state.notifications.slice(-100).reverse(),
    };
}
