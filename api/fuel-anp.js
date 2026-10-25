import { parse } from 'csv-parse/sync';

export const anpDieselUrl = 'https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/shpc/qus/ultimas-4-semanas-diesel-gnv.csv';

export function parseAnpDiesel(csv) {
    if (typeof csv !== 'string' || csv.length > 15 * 1024 * 1024) throw new Error('Dados ANP inválidos ou grandes demais.');
    const rows = parse(csv, { columns: true, delimiter: ';', bom: true, skip_empty_lines: true, relax_quotes: false });
    const candidates = rows.filter((row) => row['Estado - Sigla'] === 'PR' && row.Municipio === 'SAO JOSE DOS PINHAIS' && row.Produto === 'DIESEL S10');
    const parsed = candidates.map((row) => {
        const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(row['Data da Coleta'] || '');
        const value = Number(String(row['Valor de Venda'] || '').replace(',', '.'));
        return match && value >= 1 && value <= 20 ? { date: `${match[3]}-${match[2]}-${match[1]}`, cents: Math.round(value * 100) } : null;
    }).filter(Boolean);
    if (!parsed.length) throw new Error('ANP sem dados locais válidos de diesel S10.');
    const date = parsed.map((item) => item.date).sort().at(-1);
    const latest = parsed.filter((item) => item.date === date);
    return { priceCents: Math.round(latest.reduce((sum, item) => sum + item.cents, 0) / latest.length), date, sampleSize: latest.length, source: 'ANP', url: anpDieselUrl };
}

export async function fetchAnpDiesel(fetcher = fetch) {
    const response = await fetcher(anpDieselUrl, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { Accept: 'text/csv' } });
    if (!response.ok) throw new Error('ANP indisponível.');
    if (Number(response.headers.get('content-length') || 0) > 15 * 1024 * 1024) throw new Error('Arquivo ANP excede limite.');
    const csv = await response.text();
    return parseAnpDiesel(csv);
}
