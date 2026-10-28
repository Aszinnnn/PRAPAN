import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { validateDestination, AddressError } from './address.js';
import { calculateFuelCost, FreightError, getRoadDistance } from './freight.js';
import { privateRoot } from './private-storage.js';
import { catalogProducts } from '../code/catalog-data.js';

const legacyUnitPrices = { coco: 390, desmoldante: 650, geleia: 520, paoDeLo: 480 };
export const products = Object.freeze(Object.fromEntries(catalogProducts.map(({ id, name }) => [id, { name, unitPriceCents: legacyUnitPrices[id] ?? null }])));

export function calculateQuote(order) {
    if (!order || !Array.isArray(order.items) || order.items.length < 1 || order.items.length > Object.keys(products).length) throw new OrderError('Itens do pedido inválidos.');
    let quantityTotal = 0;
    let productsTotalCents = 0;
    const items = order.items.map((item) => {
        const product = Object.hasOwn(products, item?.id) ? products[item.id] : null;
        if (!product || !Number.isSafeInteger(item.quantity) || item.quantity < 100 || item.quantity > 1000000) throw new OrderError('Itens do pedido inválidos.');
        const approvedPrice = order.priceSnapshot && Object.hasOwn(order.priceSnapshot, item.id) ? order.priceSnapshot[item.id] : null;
        const unitPriceCents = Number.isSafeInteger(approvedPrice) && approvedPrice > 0 ? approvedPrice : product.unitPriceCents;
        const totalCents = Number.isSafeInteger(unitPriceCents) && unitPriceCents > 0 ? unitPriceCents * item.quantity : null;
        quantityTotal += item.quantity;
        productsTotalCents = productsTotalCents === null || totalCents === null ? null : productsTotalCents + totalCents;
        return { id: item.id, name: product.name, quantity: item.quantity, unitPriceCents, totalCents };
    });
    const shippingCents = order.shippingStatus === 'quoted' && Number.isSafeInteger(order.shippingCents) && order.shippingCents >= 0 && order.shippingCents <= 10000 ? order.shippingCents : null;
    const totalCents = shippingCents === null || productsTotalCents === null ? null : productsTotalCents + shippingCents;
    return { items, quantityTotal, productsTotalCents, shippingCents, totalCents, pricesProvisional: !order.priceSnapshot };
}

export const ordersFile = path.join(privateRoot, 'orders.csv');
const legacyColumns = ['id', 'createdAt', 'empresa', 'cliente', 'whatsapp', 'endereco', 'cidade', 'estado', 'cep', 'itemsJson', 'addressStatus', 'shippingStatus', 'shippingProvider', 'shippingCents', 'shippingUpdatedAt', 'shippingMessage'];
const previousColumns = [...legacyColumns, 'shippingCalculationJson'];
const routeColumns = [...previousColumns, 'routeJson'];
const emailColumns = [...routeColumns, 'email', 'quoteEmailSentAt', 'quoteEmailMessageId', 'quoteEmailSignature'];
const snapshotColumns = [...emailColumns, 'priceSnapshotJson'];
const columns = [...snapshotColumns, 'observacoes', 'urgencia'];
const maxCsvBytes = 5 * 1024 * 1024;

export class OrderError extends Error {
    constructor(message, status = 422) {
        super(message);
        this.status = status;
    }
}

function requiredText(value, label, maxLength) {
    if (typeof value !== 'string') throw new OrderError(`Informe ${label}.`);
    const cleaned = value.trim().replace(/\s+/g, ' ');
    if (!cleaned || cleaned.length > maxLength || /[\p{Cc}\p{Cf}]/u.test(cleaned)) throw new OrderError(`${label} inválido.`);
    return cleaned;
}

function normalizeEmail(value) {
    const email = requiredText(value, 'o e-mail', 254).toLowerCase();
    if (!/^[a-z0-9][^\s@]*@[^\s@]+\.[^\s@]+$/.test(email) || /[<>"',;\\]/.test(email)) throw new OrderError('E-mail inválido.');
    return email;
}

export function validateOrder(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OrderError('Pedido inválido.');
    const empresa = requiredText(input.empresa, 'o nome da empresa', 120);
    const cliente = requiredText(input.cliente, 'o nome do cliente', 120);
    const whatsappInput = requiredText(input.whatsapp, 'o WhatsApp', 20);
    const whatsapp = whatsappInput.replace(/\D/g, '');
    if (!/^[+()\d\s-]+$/.test(whatsappInput) || ![10, 11, 12, 13].includes(whatsapp.length)) throw new OrderError('WhatsApp inválido.');
    const email = normalizeEmail(input.email);
    const endereco = requiredText(input.endereco, 'o endereço e número', 180);
    const cidade = requiredText(input.cidade, 'a cidade', 100);
    const estado = requiredText(input.estado, 'a UF', 2).toUpperCase();
    if (!/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(estado)) throw new OrderError('UF inválida.');
    const cep = requiredText(input.cep, 'o CEP', 9).replace(/\D/g, '');
    if (!/^\d{8}$/.test(cep)) throw new OrderError('CEP inválido.');
    const observacoes = input.observacoes === undefined || input.observacoes === '' ? '' : requiredText(input.observacoes, 'as observações', 300);
    const urgencia = input.urgencia === undefined ? 'normal' : input.urgencia;
    if (!['normal', 'urgente'].includes(urgencia)) throw new OrderError('Urgência inválida.');

    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > Object.keys(products).length) throw new OrderError('Selecione pelo menos um produto válido.');
    const seen = new Set();
    const items = input.items.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || !Object.hasOwn(products, item.id) || seen.has(item.id)) throw new OrderError('Produto inválido ou duplicado.');
        if (!Number.isSafeInteger(item.quantity) || item.quantity < 100 || item.quantity > 1000000) throw new OrderError('Cada produto exige entre 100 e 1.000.000 de unidades.');
        seen.add(item.id);
        const product = products[item.id];
        return { id: item.id, name: product.name, quantity: item.quantity };
    });
    return { empresa, cliente, whatsapp, email, endereco, cidade, estado, cep, observacoes, urgencia, items };
}

function readRecords(file) {
    if (!fs.existsSync(file)) return [];
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.mode & 0o077 || stat.size > maxCsvBytes) throw new Error('Arquivo de pedidos inseguro ou grande demais.');
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) return [];
    return parse(text, { columns: (header) => {
        if (![columns, snapshotColumns, emailColumns, routeColumns, previousColumns, legacyColumns, [...previousColumns, 'priceSnapshotJson'], [...previousColumns, 'priceSnapshotJson', 'observacoes', 'urgencia']].some((format) => header.join(',') === format.join(','))) throw new Error('Cabeçalho de pedidos inválido.');
        return header;
    }, skip_empty_lines: true, bom: true, relax_quotes: false });
}

export function listOrders(file = ordersFile) {
    const records = readRecords(file);
    return records.map((record) => {
        const order = {
        id: record.id,
        createdAt: record.createdAt,
        empresa: record.empresa,
        cliente: record.cliente,
        whatsapp: record.whatsapp,
        email: record.email || '',
        quoteEmailSentAt: record.quoteEmailSentAt || '',
        quoteEmailMessageId: record.quoteEmailMessageId || '',
        quoteEmailSignature: record.quoteEmailSignature || '',
        endereco: record.endereco,
        cidade: record.cidade,
        estado: record.estado,
        cep: record.cep,
        observacoes: record.observacoes || '',
        urgencia: record.urgencia || 'normal',
        items: JSON.parse(record.itemsJson),
        priceSnapshot: record.priceSnapshotJson ? JSON.parse(record.priceSnapshotJson) : null,
        addressStatus: record.addressStatus,
        shippingStatus: record.shippingStatus,
        shippingProvider: record.shippingProvider,
        shippingCents: record.shippingCents === '' ? null : Number(record.shippingCents),
        shippingUpdatedAt: record.shippingUpdatedAt,
        shippingMessage: record.shippingMessage,
        shippingCalculation: record.shippingCalculationJson ? JSON.parse(record.shippingCalculationJson) : null,
        route: record.routeJson ? JSON.parse(record.routeJson) : null,
        };
        return { ...order, quote: calculateQuote(order) };
    }).reverse();
}

function writeRecords(records, file) {
    const folder = path.dirname(file);
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(folder).mode & 0o077) throw new Error('Pasta privada deve ter permissão 700.');
    const csv = stringify(records, { header: true, columns, escape_formulas: true });
    if (Buffer.byteLength(csv) > maxCsvBytes) throw new Error('Limite do CSV de pedidos atingido.');
    const temporary = path.join(folder, `.orders-${crypto.randomUUID()}.tmp`);
    try {
        fs.writeFileSync(temporary, csv, { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

function saveOrder(order, file) {
    const records = readRecords(file);
    records.push({ ...order, itemsJson: JSON.stringify(order.items) });
    writeRecords(records, file);
}

export function updateShipping(id, input, file = ordersFile, verifiedFuel = null) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new OrderError('Pedido inválido.', 400);
    if (!input || typeof input !== 'object' || Array.isArray(input) || !['quoted', 'unavailable'].includes(input.status)) throw new OrderError('Decisão de frete inválida.');
    const message = typeof input.message === 'string' ? input.message.trim().replace(/\s+/g, ' ') : '';
    if (message.length > 300 || /[\p{Cc}\p{Cf}]/u.test(message)) throw new OrderError('Observação de frete inválida.');
    let calculation = null;
    if (input.status === 'quoted') {
        try { calculation = calculateFuelCost(input); }
        catch (error) { if (error instanceof FreightError) throw new OrderError(error.message); throw error; }
        if (calculation.amountCents > 10000) throw new OrderError('O combustível da ida ultrapassa R$ 100,00. Revise o limite comercial antes de confirmar.');
    }
    if (input.status === 'unavailable' && !message) throw new OrderError('Explique por que a entrega não está disponível.');
    const records = readRecords(file);
    const record = records.find((entry) => entry.id === id);
    if (!record) throw new OrderError('Pedido não encontrado.', 404);
    record.shippingStatus = input.status;
    record.shippingProvider = 'PraPan';
    record.shippingCents = input.status === 'quoted' ? calculation.amountCents : null;
    record.shippingUpdatedAt = new Date().toISOString();
    record.shippingMessage = message || (input.status === 'quoted' ? 'Custo estimado do diesel S10 da ida, confirmado pela PraPan.' : 'Entrega indisponível.');
    record.shippingCalculationJson = calculation ? JSON.stringify(verifiedFuel ? { ...calculation,
        vehicle: 'VW Delivery', fuelSource: verifiedFuel.source, fuelReferenceDate: verifiedFuel.date } : calculation) : '';
    writeRecords(records, file);
    return listOrders(file).find((entry) => entry.id === id);
}

export function approveOrderPrices(id, approvedPrices, file = ordersFile) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new OrderError('Pedido inválido.', 400);
    const records = readRecords(file);
    const record = records.find((entry) => entry.id === id);
    if (!record) throw new OrderError('Pedido não encontrado.', 404);
    const selectedIds = JSON.parse(record.itemsJson).map((item) => item.id);
    if (!approvedPrices || selectedIds.some((key) => !Number.isSafeInteger(approvedPrices[key]) || approvedPrices[key] < 1 || approvedPrices[key] > 1000000)) throw new OrderError('Preço não autorizado para um dos produtos deste pedido.');
    if (record.quoteEmailSentAt) throw new OrderError('Pedido já enviado; não é seguro alterar os preços.', 409);
    if (!record.priceSnapshotJson) {
        record.priceSnapshotJson = JSON.stringify(Object.fromEntries(selectedIds.map((key) => [key, approvedPrices[key]])));
        writeRecords(records, file);
    }
    return listOrders(file).find((entry) => entry.id === id);
}

export function quoteEmailSignature(order) {
    return crypto.createHash('sha256').update(JSON.stringify({
        id: order.id, email: order.email, cliente: order.cliente, empresa: order.empresa,
        endereco: order.endereco, cidade: order.cidade, estado: order.estado, cep: order.cep,
        items: order.quote.items, shippingCents: order.quote.shippingCents,
    })).digest('hex');
}

export function markQuoteEmailSent(id, signature, messageId, file = ordersFile) {
    if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f]{64}$/.test(signature) || typeof messageId !== 'string' || messageId.length > 200 || !messageId) throw new OrderError('Registro de envio inválido.', 400);
    const records = readRecords(file);
    const record = records.find((entry) => entry.id === id);
    if (!record) throw new OrderError('Pedido não encontrado.', 404);
    record.quoteEmailSentAt = new Date().toISOString();
    record.quoteEmailMessageId = messageId;
    record.quoteEmailSignature = signature;
    writeRecords(records, file);
    return listOrders(file).find((entry) => entry.id === id);
}

export function updateOrderEmail(id, value, file = ordersFile) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new OrderError('Pedido inválido.', 400);
    const email = normalizeEmail(value);
    const records = readRecords(file);
    const record = records.find((entry) => entry.id === id);
    if (!record) throw new OrderError('Pedido não encontrado.', 404);
    if (record.email !== email) {
        record.email = email;
        record.quoteEmailSentAt = '';
        record.quoteEmailMessageId = '';
        record.quoteEmailSignature = '';
        writeRecords(records, file);
    }
    return listOrders(file).find((entry) => entry.id === id);
}

function routeRecord(route) {
    const distanceKm = route.distanceKm;
    return {
        status: route.precision === 'address' ? 'ready' : 'approximate',
        distanceKm, origin: route.origin, destination: route.destination,
        provider: route.provider,
        checkedAt: new Date().toISOString(),
    };
}

export function updateRoute(id, route, file = ordersFile) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new OrderError('Pedido inválido.', 400);
    const records = readRecords(file);
    const record = records.find((entry) => entry.id === id);
    if (!record) throw new OrderError('Pedido não encontrado.', 404);
    record.routeJson = JSON.stringify(routeRecord(route));
    writeRecords(records, file);
    return listOrders(file).find((entry) => entry.id === id);
}

export async function createOrder(input, { file = ordersFile, fetcher = fetch, routeFinder = getRoadDistance } = {}) {
    const data = validateOrder(input);
    let addressStatus = 'validated';
    let postalReference = null;
    try {
        postalReference = await validateDestination(data, fetcher);
    } catch (error) {
        if (!(error instanceof AddressError)) throw error;
        if (error.code === 'unavailable') addressStatus = 'pending';
        else throw new OrderError(error.message, error.status);
    }
    let route = null;
    if (addressStatus === 'validated') {
        try { route = routeRecord(await routeFinder(data, { postalReference })); }
        catch (error) {
            if (!(error instanceof FreightError)) throw error;
            route = { status: 'unavailable', message: error.message, checkedAt: new Date().toISOString() };
        }
    }
    const order = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...data,
        addressStatus,
        shippingStatus: 'pending',
        shippingProvider: '',
        shippingCents: null,
        shippingUpdatedAt: '',
        shippingMessage: 'Aguardando análise do frete pela PraPan.',
        shippingCalculationJson: '',
        routeJson: route ? JSON.stringify(route) : '',
        quoteEmailSentAt: '',
        quoteEmailMessageId: '',
        quoteEmailSignature: '',
    };
    saveOrder(order, file);
    return listOrders(file).find((entry) => entry.id === order.id);
}
