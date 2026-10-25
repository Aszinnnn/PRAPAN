import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { products } from './orders.js';

export const sentinelRoot = path.join(os.homedir(), '.local', 'share', 'prapan');
export const sentinelConfigFile = path.join(sentinelRoot, 'sentinel.json');

function boundedEnvNumber(value, fallback, min, max) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback;
}

export function defaultSentinelConfig() {
    return {
        version: 1, confirmed: false, autoSalesEnabled: false,
        prices: Object.fromEntries(Object.entries(products).map(([id, product]) => [id, product.unitPriceCents])),
        fuelPriceCents: null, fuelSource: '', fuelReferenceDate: '',
        efficiencyKmL: null, maxFuelAgeDays: 14, maxFuelChangePercent: 10, dailyLimit: boundedEnvNumber(process.env.SENTINEL_DAILY_LIMIT, 25, 1, 100),
        pendingHours: boundedEnvNumber(process.env.SENTINEL_PENDING_HOURS, 24, 1, 168), adminEmail: process.env.SENTINEL_ADMIN_EMAIL || '', confirmedAt: '',
        publicFuelReference: null,
    };
}

function checkPrivateFile(file) {
    if (!fs.existsSync(file)) return false;
    const folder = fs.lstatSync(path.dirname(file));
    const stat = fs.lstatSync(file);
    if (!folder.isDirectory() || folder.mode & 0o077 || !stat.isFile() || stat.mode & 0o077 || stat.size > 16384) throw new Error('Configuração Sentinel insegura.');
    return true;
}

export function readSentinelConfig(file = sentinelConfigFile) {
    const base = defaultSentinelConfig();
    if (!checkPrivateFile(file)) return base;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data?.version !== 1 || typeof data.confirmed !== 'boolean' || typeof data.autoSalesEnabled !== 'boolean' || (data.autoSalesEnabled && !data.confirmed)) throw new Error('Configuração Sentinel inválida.');
    if (data.confirmed) validateCommercialRules({ ...base, ...data });
    return { ...base, ...data };
}

export function saveSentinelConfig(config, file = sentinelConfigFile) {
    const folder = path.dirname(file);
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(folder).mode & 0o077) throw new Error('Pasta privada deve ter permissão 700.');
    const temporary = path.join(folder, `.sentinel-${crypto.randomUUID()}.tmp`);
    try {
        fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return config;
}

export function validateCommercialRules(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Regras comerciais inválidas.');
    const prices = input.prices;
    if (!prices || typeof prices !== 'object' || Array.isArray(prices) || Object.keys(prices).length !== Object.keys(products).length || Object.keys(products).some((id) => !Number.isSafeInteger(prices[id]) || prices[id] < 1 || prices[id] > 1000000)) throw new Error('Confira os quatro preços unitários em centavos.');
    if (!Number.isSafeInteger(input.fuelPriceCents) || input.fuelPriceCents < 100 || input.fuelPriceCents > 2000) throw new Error('Preço do diesel S10 inválido.');
    if (typeof input.efficiencyKmL !== 'number' || input.efficiencyKmL < 5.5 || input.efficiencyKmL > 8.4 || Math.round(input.efficiencyKmL * 10) !== input.efficiencyKmL * 10) throw new Error('Consumo deve estar entre 5,5 e 8,4 km/l.');
    if (typeof input.fuelSource !== 'string' || !['ANP', 'Nota fiscal / posto'].includes(input.fuelSource)) throw new Error('Informe a fonte do diesel.');
    const reference = new Date(input.fuelReferenceDate);
    if (typeof input.fuelReferenceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.fuelReferenceDate) || !Number.isFinite(reference.getTime()) || reference.getTime() > Date.now() + 86400000) throw new Error('Data de referência do diesel inválida.');
    const maxFuelAgeDays = Number(input.maxFuelAgeDays);
    const maxFuelChangePercent = Number(input.maxFuelChangePercent);
    const dailyLimit = Number(input.dailyLimit);
    const pendingHours = Number(input.pendingHours);
    if (!Number.isSafeInteger(maxFuelAgeDays) || maxFuelAgeDays < 1 || maxFuelAgeDays > 30 || !Number.isSafeInteger(maxFuelChangePercent) || maxFuelChangePercent < 0 || maxFuelChangePercent > 20 || !Number.isSafeInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 100 || !Number.isSafeInteger(pendingHours) || pendingHours < 1 || pendingHours > 168) throw new Error('Limites operacionais inválidos.');
    const adminEmail = typeof input.adminEmail === 'string' ? input.adminEmail.trim().toLowerCase() : '';
    if (adminEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || adminEmail.length > 254)) throw new Error('E-mail administrativo inválido.');
    return { prices: Object.fromEntries(Object.keys(products).map((id) => [id, prices[id]])), fuelPriceCents: input.fuelPriceCents, efficiencyKmL: input.efficiencyKmL, fuelSource: input.fuelSource, fuelReferenceDate: input.fuelReferenceDate, maxFuelAgeDays, maxFuelChangePercent, dailyLimit, pendingHours, adminEmail };
}

export function confirmCommercialRules(input, file = sentinelConfigFile) {
    const rules = validateCommercialRules(input);
    const current = readSentinelConfig(file);
    if (!fuelIsFresh(rules)) throw new Error('A referência do diesel está vencida para a validade escolhida. Atualize a data com uma fonte comprovada.');
    if (rules.fuelSource === 'ANP' && (!current.publicFuelReference || current.publicFuelReference.date !== rules.fuelReferenceDate || current.publicFuelReference.priceCents !== rules.fuelPriceCents)) {
        throw new Error('Preço e data do diesel não coincidem com a referência ANP verificada. Use a referência exibida ou selecione uma fonte comprovada diferente.');
    }
    return saveSentinelConfig({ ...current, ...rules, confirmed: true, autoSalesEnabled: false, confirmedAt: new Date().toISOString() }, file);
}

export function setAutoSalesEnabled(enabled, file = sentinelConfigFile) {
    if (typeof enabled !== 'boolean') throw new Error('Estado inválido.');
    const config = readSentinelConfig(file);
    if (enabled && !config.confirmed) throw new Error('Confirme preços e entrega antes de ativar.');
    return saveSentinelConfig({ ...config, autoSalesEnabled: enabled }, file);
}

export function fuelIsFresh(config, now = Date.now()) {
    const date = Date.parse(`${config.fuelReferenceDate}T00:00:00-03:00`);
    return Number.isFinite(date) && date <= now && now - date <= config.maxFuelAgeDays * 86400000;
}
