import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdfkit';

const logoFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'logo-prapan-hd.png');
const brown = '#754528';
const dark = '#3f281e';
const green = '#9fbc5c';
const muted = '#6d5b50';
const cream = '#f8f5ee';
const money = (cents) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const count = (quantity) => new Intl.NumberFormat('pt-BR').format(quantity);

export function renderQuotePdf(order, issuedAt = new Date()) {
    if (order?.quote?.totalCents === null || !Number.isSafeInteger(order?.quote?.totalCents)) throw new Error('Frete não confirmado para emissão do orçamento.');
    return new Promise((resolve, reject) => {
        const chunks = [];
        const document = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Orçamento PraPan ${order.id.slice(0, 8)}`, Author: 'PraPan', Subject: 'Orçamento de produtos e entrega' } });
        document.on('data', (chunk) => chunks.push(chunk));
        document.once('error', reject);
        document.once('end', () => resolve(Buffer.concat(chunks)));
        try {
            const right = 547;
            document.rect(0, 0, 595.28, 146).fill(brown);
            document.image(logoFile, 48, 31, { fit: [150, 57] });
            document.fillColor('#ffffff').font('Helvetica-Bold').fontSize(23).text('ORÇAMENTO', 306, 43, { width: 241, align: 'right' });
            document.font('Helvetica').fontSize(9).text(`Pedido ${order.id.slice(0, 8).toUpperCase()}`, 306, 77, { width: 241, align: 'right' });
            document.text(`Emitido em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(issuedAt)}`, 306, 93, { width: 241, align: 'right' });

            document.fillColor(dark).font('Helvetica-Bold').fontSize(12).text('DADOS DO CLIENTE', 48, 171);
            document.moveTo(48, 193).lineTo(right, 193).lineWidth(1).strokeColor('#ded5c6').stroke();
            document.font('Helvetica').fontSize(10).fillColor(muted).text('Empresa', 48, 205).text('Contato', 305, 205);
            document.font('Helvetica-Bold').fontSize(9).fillColor(dark).text(order.empresa, 48, 222, { width: 240, height: 46 }).text(order.cliente, 305, 222, { width: 242, height: 46 });
            document.font('Helvetica').fontSize(9).fillColor(muted).text(`WhatsApp: ${order.whatsapp}`, 48, 276, { width: 240 });
            if (order.email) document.text(`E-mail: ${order.email}`, 48, 290, { width: 240 });
            document.fontSize(8).text(`${order.endereco}, ${order.cidade}/${order.estado} - CEP ${order.cep}`, 305, 264, { width: 242, height: 52 });

            const tableY = 325;
            document.roundedRect(48, tableY, 499, 32, 6).fill(dark);
            document.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
                .text('PRODUTO', 61, tableY + 11, { width: 190 })
                .text('QTD.', 257, tableY + 11, { width: 55, align: 'right' })
                .text('UNITÁRIO', 328, tableY + 11, { width: 91, align: 'right' })
                .text('TOTAL', 436, tableY + 11, { width: 97, align: 'right' });
            order.quote.items.forEach((item, index) => {
                const y = tableY + 32 + index * 44;
                if (index % 2 === 0) document.rect(48, y, 499, 44).fill(cream);
                document.fillColor(dark).font('Helvetica').fontSize(9)
                    .text(item.name, 61, y + 14, { width: 190, height: 22 })
                    .text(count(item.quantity), 257, y + 14, { width: 55, align: 'right' })
                    .text(money(item.unitPriceCents), 328, y + 14, { width: 91, align: 'right' });
                document.font('Helvetica-Bold').text(money(item.totalCents), 436, y + 14, { width: 97, align: 'right' });
            });

            const totalsY = Math.max(480, tableY + 32 + order.quote.items.length * 44 + 19);
            document.roundedRect(48, totalsY, 499, 154, 12).fill(cream);
            document.fillColor(dark).font('Helvetica-Bold').fontSize(11).text('RESUMO DO ORÇAMENTO', 66, totalsY + 18);
            document.font('Helvetica').fontSize(10).text(`Produtos (${count(order.quote.quantityTotal)} unidades)`, 66, totalsY + 50, { width: 330 });
            document.text('Entrega - combustível da ida', 66, totalsY + 77, { width: 330 });
            document.font('Helvetica-Bold').text(money(order.quote.productsTotalCents), 409, totalsY + 50, { width: 117, align: 'right' });
            document.text(money(order.quote.shippingCents), 409, totalsY + 77, { width: 117, align: 'right' });
            document.moveTo(66, totalsY + 103).lineTo(526, totalsY + 103).lineWidth(1).strokeColor('#ded5c6').stroke();
            document.fontSize(13).text('TOTAL', 66, totalsY + 116);
            document.fillColor(brown).fontSize(16).text(money(order.quote.totalCents), 382, totalsY + 113, { width: 144, align: 'right' });

            document.fillColor('#52672e').font('Helvetica-Bold').fontSize(9).text(order.priceSnapshot ? 'Preços unitários aprovados pela PraPan.' : 'Valores unitários provisórios. Confirme-os antes de enviar ao cliente.', 48, 711, { width: 499 });
            const fuel = order.shippingCalculation;
            if (fuel?.vehicle && fuel?.fuelSource && fuel?.fuelReferenceDate) {
                document.fillColor(muted).font('Helvetica').fontSize(8).text(`${fuel.vehicle}: ${count(fuel.distanceKm)} km de ida; ${String(fuel.efficiencyKmL).replace('.', ',')} km/l; diesel S10 ${money(fuel.fuelPriceCents)}/l (${fuel.fuelSource}, ${fuel.fuelReferenceDate}).`, 48, 727, { width: 499 });
            }
            document.fillColor(muted).font('Helvetica').fontSize(8).text('Entrega calculada somente pelo combustível da ida. Pedágio, motorista, manutenção e margem não estão incluídos.', 48, 747, { width: 499 });
            document.moveTo(48, 779).lineTo(right, 779).lineWidth(2).strokeColor(green).stroke();
            document.fontSize(8).text('PraPan  |  Muito mais paladar e qualidade.', 48, 789, { width: 499 });
            document.end();
        } catch (error) {
            document.destroy(error);
            reject(error);
        }
    });
}
