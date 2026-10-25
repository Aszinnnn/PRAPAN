import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class FreightError extends Error {
    constructor(message, status = 422) {
        super(message);
        this.status = status;
    }
}

// Apenas combustível da ida: não inclui pedágio, manutenção, mão de obra ou lucro.
export function calculateFuelCost({ distanceKm, fuelPriceCents, efficiencyKmL }) {
    if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 6000 || Math.round(distanceKm * 10) !== distanceKm * 10) {
        throw new FreightError('Informe a distância rodoviária de ida em km, com até uma casa decimal.');
    }
    if (!Number.isSafeInteger(fuelPriceCents) || fuelPriceCents < 100 || fuelPriceCents > 2000) {
        throw new FreightError('Informe o preço real do diesel S10 em centavos por litro.');
    }
    if (typeof efficiencyKmL !== 'number' || !Number.isFinite(efficiencyKmL) || efficiencyKmL < 5.5 || efficiencyKmL > 8.4 || Math.round(efficiencyKmL * 10) !== efficiencyKmL * 10) {
        throw new FreightError('Informe o consumo real entre 5,5 e 8,4 km/l.');
    }
    const liters = distanceKm / efficiencyKmL;
    return { distanceKm, fuelPriceCents, efficiencyKmL, liters: Math.round(liters * 1000) / 1000, amountCents: Math.round(liters * fuelPriceCents) };
}

const origin = Object.freeze({
    label: 'Av. das Américas, 779, São José dos Pinhais/PR',
    // Endereço com número confirmado na API de geocodificação em 24/10/2026.
    coordinates: [-49.208051, -25.529867],
});

function readRouteKey() {
    if (process.env.OPENROUTESERVICE_API_KEY) return process.env.OPENROUTESERVICE_API_KEY.trim();
    const folder = path.join(os.homedir(), '.local', 'share', 'prapan');
    const file = path.join(folder, 'ors.key');
    try {
        const folderStat = fs.lstatSync(folder);
        const fileStat = fs.lstatSync(file);
        if (!folderStat.isDirectory() || folderStat.mode & 0o077 || !fileStat.isFile() || fileStat.mode & 0o077 || fileStat.size > 4096) throw new Error('permissões inválidas');
        const key = fs.readFileSync(file, 'utf8').trim();
        if (!/^[A-Za-z0-9._=-]{20,4096}$/.test(key)) throw new Error('chave inválida');
        return key;
    } catch {
        return '';
    }
}

const stateNames = Object.freeze({
    AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
    GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba',
    PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
    RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
});

const normalized = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const streetKey = (value) => normalized(String(value || '').replace(/^\s*(?:rua|r\.?|avenida|av\.?|travessa|tv\.?|alameda|al\.?|rodovia|rod\.?|estrada|est\.?)\s+/i, ''));

function splitAddress(value) {
    const address = String(value || '').trim();
    const afterComma = address.match(/^(.+?),\s*(?:n[º°.]?\s*)?(\d+[a-z]?)(?=\s|,|$)/i);
    if (afterComma) return { street: afterComma[1].trim(), number: afterComma[2] };
    const explicit = address.match(/^(.+?)\s+n[º°.]?\s*(\d+[a-z]?)(?=\s|,|$)/i);
    if (explicit) return { street: explicit[1].trim(), number: explicit[2] };
    const beforeStreet = address.match(/^(\d+[a-z]?)\s+(.+)$/i);
    if (beforeStreet) return { street: beforeStreet[2].trim(), number: beforeStreet[1] };
    const atEnd = address.match(/^(.+?)\s+(\d+[a-z]?)$/i);
    return atEnd ? { street: atEnd[1].trim(), number: atEnd[2] } : { street: address, number: '' };
}

function validPoint(point) {
    return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
        && point[0] >= -75 && point[0] <= -32 && point[1] >= -34 && point[1] <= 6;
}

function kilometersBetween(a, b) {
    const radians = (degrees) => degrees * Math.PI / 180;
    const dLat = radians(b[1] - a[1]);
    const dLon = radians(b[0] - a[0]);
    const arc = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(dLon / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(arc));
}

function inspectCandidate(feature, destination, parsed) {
    const properties = feature?.properties;
    const coordinates = feature?.geometry?.coordinates;
    if (!properties || !validPoint(coordinates)) return null;
    const city = normalized(destination.cidade);
    const region = normalized(destination.estado);
    const regionName = normalized(stateNames[destination.estado]);
    const candidateCity = normalized(properties.locality || properties.localadmin);
    const candidateRegion = normalized(properties.region_a || properties.region);
    const label = String(properties.label || '').slice(0, 240);
    if (!label) return null;
    const labelKey = normalized(label);
    const cityMatches = candidateCity ? candidateCity === city : labelKey.includes(city);
    const regionMatches = candidateRegion ? candidateRegion === region || candidateRegion === regionName : labelKey.includes(regionName);
    const country = normalized(properties.country_a || properties.country);
    if (!cityMatches || !regionMatches || (country && !['br', 'bra', 'brasil', 'brazil'].includes(country))) return null;
    const street = streetKey(parsed.street);
    const candidateStreet = streetKey(properties.street);
    const streetMatches = street && (candidateStreet ? candidateStreet === street : labelKey.includes(street));
    if (!streetMatches) return null;
    const numberMatches = Boolean(parsed.number) && normalized(properties.housenumber) === normalized(parsed.number);
    const postcode = normalized(properties.postalcode);
    const postcodeMatches = !postcode || postcode === normalized(destination.cep);
    const confidence = Number(properties.confidence);
    const exact = properties.layer === 'address' && properties.match_type === 'exact' && properties.accuracy !== 'centroid'
        && candidateStreet === street && Boolean(candidateCity) && Boolean(candidateRegion) && numberMatches && postcodeMatches
        && Number.isFinite(confidence) && confidence >= 0.75;
    const score = (exact ? 100 : 0) + (numberMatches ? 15 : 0) + (candidateStreet === street ? 10 : 0)
        + (postcodeMatches && postcode ? 5 : 0) + (Number.isFinite(confidence) ? confidence : 0);
    return { coordinates, label, exact, score };
}

async function searchGeocoder(url, key, fetcher) {
    const response = await fetcher(url, { headers: { Authorization: key, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new FreightError('Serviço de mapas indisponível.', 503);
    const data = await response.json();
    return Array.isArray(data?.features) ? data.features.slice(0, 10) : [];
}

async function geocode(destination, key, fetcher, postalReference) {
    const parsed = splitAddress(destination.endereco);
    const structured = new URL('https://api.openrouteservice.org/geocode/search/structured');
    structured.searchParams.set('address', parsed.number ? `${parsed.street}, ${parsed.number}` : parsed.street);
    structured.searchParams.set('locality', destination.cidade);
    structured.searchParams.set('region', destination.estado);
    structured.searchParams.set('postalcode', destination.cep.replace(/\D/g, ''));
    structured.searchParams.set('country', 'BR');
    structured.searchParams.set('boundary.country', 'BR');
    structured.searchParams.set('size', '10');
    const text = new URL('https://api.openrouteservice.org/geocode/search');
    text.searchParams.set('text', [parsed.street, parsed.number, destination.cidade, destination.estado, destination.cep, 'Brasil'].filter(Boolean).join(', '));
    text.searchParams.set('boundary.country', 'BR');
    text.searchParams.set('size', '10');

    let best = null;
    let ambiguous = false;
    let successfulQueries = 0;
    for (const url of [structured, text]) {
        let features;
        try { features = await searchGeocoder(url, key, fetcher); }
        catch { continue; } // A busca estruturada é beta; a textual continua disponível como alternativa.
        successfulQueries++;
        const candidates = features.map((feature) => inspectCandidate(feature, destination, parsed)).filter(Boolean).sort((a, b) => b.score - a.score);
        if (!candidates.length) continue;
        const selected = candidates[0];
        const conflicting = selected.exact && candidates.some((candidate) => candidate.exact && kilometersBetween(selected.coordinates, candidate.coordinates) > 0.15);
        if (conflicting) ambiguous = true;
        if (selected.exact && !ambiguous) return { coordinates: selected.coordinates, label: selected.label, precision: 'address' };
        if (!best || selected.score > best.score) best = selected;
    }
    // O CEP pode oferecer um ponto na rua quando Pelias só conhece o centro da cidade.
    // Nunca é apresentado como localização do número, nem libera venda automática.
    const postalStreet = streetKey(postalReference?.street);
    if (postalStreet && postalStreet === streetKey(parsed.street)
        && normalized(postalReference?.cep) === normalized(destination.cep)
        && normalized(postalReference?.cidade) === normalized(destination.cidade)
        && normalized(postalReference?.estado) === normalized(destination.estado)
        && validPoint(postalReference?.coordinates)) {
        return { coordinates: postalReference.coordinates, label: `${postalReference.street}, CEP ${destination.cep} (ponto aproximado)`, precision: 'approximate', provider: 'BrasilAPI CEP v2' };
    }
    if (best) return { coordinates: best.coordinates, label: best.label, precision: 'approximate' };
    throw new FreightError(successfulQueries ? 'Endereço não localizado com segurança. Confira rua, número, cidade e CEP.' : 'Serviço de mapas indisponível.', successfulQueries ? 422 : 503);
}

export async function getRoadDistance(destination, { key = readRouteKey(), fetcher = fetch, postalReference = null } = {}) {
    if (!key) throw new FreightError('Configure OPENROUTESERVICE_API_KEY para consulta automática. Informe a distância conferida manualmente enquanto isso.', 503);
    if (!destination || typeof destination !== 'object' || typeof destination.endereco !== 'string' || typeof destination.cidade !== 'string'
        || typeof destination.estado !== 'string' || !Object.hasOwn(stateNames, destination.estado) || typeof destination.cep !== 'string'
        || !/^\d{5}-?\d{3}$/.test(destination.cep) || !destination.endereco.trim() || !destination.cidade.trim()) throw new FreightError('Destino inválido.');
    const address = `${destination.endereco}, ${destination.cidade}, ${destination.estado}, CEP ${destination.cep}, Brasil`;
    if (address.length > 350) throw new FreightError('Destino inválido.');
    try {
        const end = await geocode(destination, key, fetcher, postalReference);
        const response = await fetcher('https://api.openrouteservice.org/v2/directions/driving-hgv/json', {
            method: 'POST', headers: { Authorization: key, Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ coordinates: [origin.coordinates, end.coordinates], options: { vehicle_type: 'delivery' }, instructions: false }),
            redirect: 'error', signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new FreightError('Não foi possível calcular a rota do caminhão. Confira a distância manualmente.', 503);
        const data = await response.json();
        const meters = data?.routes?.[0]?.summary?.distance;
        if (typeof meters !== 'number' || !Number.isFinite(meters) || meters <= 0 || meters > 6000000) throw new FreightError('Rota inválida. Confira a distância manualmente.', 422);
        return { distanceKm: Math.round(meters / 100) / 10, origin: origin.label, destination: end.label, precision: end.precision,
            provider: end.provider ? `${end.provider} + openrouteservice` : 'openrouteservice / OpenStreetMap' };
    } catch (error) {
        if (error instanceof FreightError) throw error;
        throw new FreightError('Serviço de mapas indisponível. Confira a distância manualmente.', 503);
    }
}
