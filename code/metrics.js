const dayFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'America/Sao_Paulo' });

export function buildMetricsReport(orders, jobs = {}, days = 30, now = Date.now()) {
    if (![7, 30, 90].includes(days)) throw new RangeError('Período inválido.');
    const cutoff = now - days * 86400000;
    const scoped = orders.filter((order) => {
        const time = Date.parse(order.createdAt);
        return Number.isFinite(time) && time >= cutoff && time <= now;
    });
    const buckets = Array.from({ length: Math.min(7, days) }, (_, index) => {
        const start = cutoff + index * (now - cutoff) / Math.min(7, days);
        const end = cutoff + (index + 1) * (now - cutoff) / Math.min(7, days);
        return { label: days === 7 ? dayFormatter.format(start) : `${dayFormatter.format(start)} a ${dayFormatter.format(end)}`, received: 0, sent: 0 };
    });
    const status = { sent: 0, ready: 0, pending: 0, unavailable: 0 };
    const products = new Map();
    let quotedCents = 0;
    let quotedCount = 0;
    let urgent = 0;
    let review = 0;
    let units = 0;
    for (const order of scoped) {
        const time = Date.parse(order.createdAt);
        const index = Math.min(buckets.length - 1, Math.floor((time - cutoff) / (now - cutoff) * buckets.length));
        buckets[index].received++;
        if (order.quoteEmailSentAt) { status.sent++; buckets[index].sent++; }
        else if (order.shippingStatus === 'unavailable') status.unavailable++;
        else if (!order.quote?.pricesProvisional && Number.isSafeInteger(order.quote?.totalCents)) status.ready++;
        else status.pending++;
        if (order.urgencia === 'urgente') urgent++;
        if (['review', 'uncertain', 'failed'].includes(jobs[order.id]?.status)) review++;
        if (!order.quote?.pricesProvisional && Number.isSafeInteger(order.quote?.totalCents) && order.quote.totalCents >= 0) {
            quotedCents += order.quote.totalCents;
            quotedCount++;
        }
        for (const item of order.items || []) {
            if (!Number.isSafeInteger(item.quantity) || item.quantity < 0) continue;
            units += item.quantity;
            const product = products.get(item.id) || { id: item.id, name: item.name || item.id, units: 0, orders: 0 };
            product.units += item.quantity;
            product.orders++;
            products.set(item.id, product);
        }
    }
    const topProducts = [...products.values()].sort((a, b) => b.units - a.units || a.name.localeCompare(b.name, 'pt-BR')).slice(0, 5);
    const insights = [];
    if (review) insights.push(`${review} ${review === 1 ? 'pedido exige' : 'pedidos exigem'} revisão do Sentinel.`);
    if (status.ready) insights.push(`${status.ready} ${status.ready === 1 ? 'orçamento está' : 'orçamentos estão'} calculado${status.ready === 1 ? '' : 's'} e ainda não consta${status.ready === 1 ? '' : 'm'} como enviado${status.ready === 1 ? '' : 's'}.`);
    if (status.pending) insights.push(`${status.pending} ${status.pending === 1 ? 'pedido ainda depende' : 'pedidos ainda dependem'} de preço ou entrega para ter valor final.`);
    if (urgent) insights.push(`${urgent} ${urgent === 1 ? 'solicitação foi marcada' : 'solicitações foram marcadas'} como urgente${urgent === 1 ? '' : 's'}.`);
    if (!insights.length) insights.push(scoped.length ? 'Nenhum ponto de atenção identificado neste período.' : 'Sem pedidos neste período. Amplie o intervalo para consultar o histórico.');
    const aiSummaries = scoped.filter((order) => typeof jobs[order.id]?.aiSummary === 'string' && jobs[order.id].aiSummary.trim())
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, 4).map((order) => ({ id: order.id, summary: jobs[order.id].aiSummary }));
    return {
        periodDays: days, received: scoped.length, sent: status.sent, review, urgent, units,
        quotedCount, quotedCents, averageQuoteCents: quotedCount ? Math.round(quotedCents / quotedCount) : 0,
        sendRate: scoped.length ? Math.round(status.sent / scoped.length * 100) : 0,
        status, buckets, topProducts, insights, aiSummaries,
    };
}
