import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

const money = (cents) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const dateTime = (value) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const decimal = (value) => String(value).replace('.', ',');
const parseDecimal = (value, places) => new RegExp(`^\\d{1,4}(?:,\\d{1,${places}})?$`).test(value.trim()) ? Number(value.trim().replace(',', '.')) : NaN;

async function sentinelPost(path, body) {
    const csrfResponse = await fetch('/api/csrf', { credentials: 'same-origin', cache: 'no-store' });
    if (!csrfResponse.ok) throw new Error('Sessão indisponível.');
    const { token } = await csrfResponse.json();
    const response = await fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(body) });
    if (response.status === 401) { window.location.replace('/code/login.html'); throw new Error('Sessão encerrada.'); }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível salvar.');
    return data;
}

function SentinelPanel() {
    const [data, setData] = useState(null);
    const [form, setForm] = useState(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [logFilter, setLogFilter] = useState('all');
    const load = useCallback(async () => {
        const response = await fetch('/api/sentinel', { credentials: 'same-origin', cache: 'no-store' });
        if (response.status === 401) { window.location.replace('/code/login.html'); return; }
        if (!response.ok) throw new Error('Sentinel indisponível.');
        const next = await response.json();
        setData(next);
        setForm((current) => current || next.config);
    }, []);
    useEffect(() => {
        load().catch(() => setMessage('Não foi possível carregar o Sentinel.'));
        const timer = window.setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 30000);
        return () => window.clearInterval(timer);
    }, [load]);
    async function execute(action) {
        setBusy(true); setMessage('');
        try {
            await action();
            await load();
            setMessage('Alteração registrada com segurança.');
        } catch (error) { setMessage(error.message || 'Operação indisponível.'); }
        finally { setBusy(false); }
    }
    if (!data || !form) return <section className="sentinel-panel"><h1 id="sentinel-title" tabIndex="-1">Sentinel AI — Agente de Vendas</h1><p>{message || 'Carregando controles…'}</p></section>;
    const productNames = { coco: 'Coco em Flocos Úmidos', desmoldante: 'Desmoldante para Formas', geleia: 'Geleia de Brilho Neutra', paoDeLo: 'Mistura de Pão de Ló' };
    const metrics = [
        ['Recebidos', data.metrics.received], ['Processados', data.metrics.processed], ['Enviados', data.metrics.sent], ['Revisão', data.metrics.review],
        ['Falhas', data.metrics.failed], ['Alertas', data.metrics.alerts], ['Chamadas Gemini', data.metrics.geminiCalls], ['Tokens', data.metrics.tokens], ['Análise média', `${data.metrics.averageAnalysisMs} ms`], ['Taxa automática', `${data.metrics.successRate}%`],
    ];
    const logs = data.events.filter((event) => logFilter === 'all' || event.status === logFilter);
    const blockers = data.config.autoSalesEnabled ? data.readiness?.issues || [] : [];
    return <section className="sentinel-panel" aria-labelledby="sentinel-title">
        <div className="sentinel-panel__intro"><div><p className="dashboard-kicker">Operação assistida por IA</p><h1 id="sentinel-title" tabIndex="-1">Sentinel AI — Agente de Vendas</h1><p>Autonomia apenas dentro dos preços e parâmetros aprovados. Pedidos fora das regras aguardam revisão.</p></div><span className={`sentinel-pill ${data.config.autoSalesEnabled && !blockers.length ? 'sentinel-pill--on' : ''}`}>{data.config.autoSalesEnabled ? blockers.length ? 'Automático bloqueado' : 'Automático ativo' : 'Automático suspenso'}</span></div>
        {blockers.length > 0 && <div className="sentinel-alert" role="alert"><strong>Envios automáticos impedidos</strong><p>O agente pode analisar pedidos, mas só enviará orçamentos depois que estas condições forem resolvidas:</p><ul>{blockers.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
        <div className="sentinel-metrics">{metrics.map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
        <div className="sentinel-grid"><form className="sentinel-settings" onSubmit={(event) => { event.preventDefault(); if (window.confirm('Ativar vendas automáticas com estes preços e parâmetros reais de entrega?')) execute(async () => { const result = await sentinelPost('/api/sentinel/activation', { enabled: true, rules: form }); setForm(result.config); }); }}>
            <h3>Regras comerciais</h3><p>Os preços abaixo vieram da tabela provisória. Revise e informe valores reais antes de confirmar.</p>
            <div className="sentinel-fields">{Object.entries(productNames).map(([id, name]) => <label key={id}>{name} · R$/un.<input required type="number" min="0.01" max="10000" step="0.01" value={form.priceDraft?.[id] ?? (form.prices[id] / 100).toFixed(2)} onChange={(event) => setForm({ ...form, priceDraft: { ...form.priceDraft, [id]: event.target.value }, prices: { ...form.prices, [id]: Math.round(Number(event.target.value) * 100) } })} /></label>)}
                <label>Diesel S10 · R$/litro<input required={form.fuelSource !== 'ANP'} readOnly={form.fuelSource === 'ANP'} type="number" min="1" max="20" step="0.01" value={form.fuelSource === 'ANP' ? (data.config.publicFuelReference?.priceCents ? (data.config.publicFuelReference.priceCents / 100).toFixed(2) : '') : form.fuelPriceDraft ?? (form.fuelPriceCents === null ? '' : (form.fuelPriceCents / 100).toFixed(2))} onChange={(event) => setForm({ ...form, fuelPriceDraft: event.target.value, fuelPriceCents: Math.round(Number(event.target.value) * 100) })} /></label>
                <label>Consumo real · km/l<input required type="number" min="5.5" max="8.4" step="0.1" value={form.efficiencyKmL ?? ''} onChange={(event) => setForm({ ...form, efficiencyKmL: Number(event.target.value) })} /></label>
                <label>Fonte do diesel<select required value={form.fuelSource} onChange={(event) => setForm({ ...form, fuelSource: event.target.value })}><option value="">Selecione</option><option value="ANP">ANP automática · São José dos Pinhais</option><option value="Nota fiscal / posto">Nota fiscal / posto</option></select></label>
                <label>Data da referência<input required={form.fuelSource !== 'ANP'} readOnly={form.fuelSource === 'ANP'} type="date" value={form.fuelSource === 'ANP' ? (data.config.publicFuelReference?.date || '') : form.fuelReferenceDate} onChange={(event) => setForm({ ...form, fuelReferenceDate: event.target.value })} /></label>
                <label>Validade do diesel · dias<input required type="number" min="1" max="30" value={form.maxFuelAgeDays} onChange={(event) => setForm({ ...form, maxFuelAgeDays: Number(event.target.value) })} /></label>
                <label>Variação automática máxima · %<input required type="number" min="0" max="20" value={form.maxFuelChangePercent} onChange={(event) => setForm({ ...form, maxFuelChangePercent: Number(event.target.value) })} /></label>
                <label>Limite diário de envios<input required type="number" min="1" max="100" value={form.dailyLimit} onChange={(event) => setForm({ ...form, dailyLimit: Number(event.target.value) })} /></label>
                <label>Alerta de pendência · horas<input required type="number" min="1" max="168" value={form.pendingHours} onChange={(event) => setForm({ ...form, pendingHours: Number(event.target.value) })} /></label>
                <label>E-mail administrativo<input type="email" maxLength="254" value={form.adminEmail} onChange={(event) => setForm({ ...form, adminEmail: event.target.value })} /></label>
            </div><div className="sentinel-actions"><button type="submit" disabled={busy}>{data.config.autoSalesEnabled ? 'Atualizar regras comerciais' : 'Ativar vendas automáticas'}</button>{data.config.autoSalesEnabled && <button type="button" disabled={busy} onClick={() => execute(() => sentinelPost('/api/sentinel/activation', { enabled: false }))}>Suspender envios</button>}</div>
            <small>{data.config.confirmed ? `Valores autorizados em ${dateTime(data.config.confirmedAt)}.` : 'Ainda não autorizado. Nenhum e-mail será enviado automaticamente.'}</small>{form.fuelSource === 'ANP' && <p className="sentinel-reference">Preço e data serão consultados no CSV oficial da ANP ao ativar; depois, o servidor tentará atualizar automaticamente. A data exibida é da coleta, não de hoje.</p>}{data.config.publicFuelReference && <p className="sentinel-reference">ANP: {money(data.config.publicFuelReference.priceCents)}/l, coleta de {data.config.publicFuelReference.date}, {data.config.publicFuelReference.sampleSize} postos. <a href={data.config.publicFuelReference.url} target="_blank" rel="noopener noreferrer">Consultar fonte</a>. Se a amostra ultrapassar a validade autorizada, o envio automático ficará bloqueado.</p>}<p role="status">{message}</p>
        </form><div className="sentinel-feed"><h3>Alertas e acompanhamento</h3><ul>{data.notifications.slice(0, 12).map((notice) => <li key={notice.key}><time>{dateTime(notice.at)}</time><strong>{notice.operation}</strong><span>{notice.message}</span>{notice.orderId && ['review', 'failed'].includes(notice.status) && <button type="button" disabled={busy} onClick={() => execute(() => sentinelPost(`/api/sentinel/reprocess/${notice.orderId}`, {}))}>Reprocessar</button>}</li>)}</ul>{!data.notifications.length && <p>Sem alertas.</p>}</div></div>
        <div className="sentinel-logs"><div><h3>Registro de operações</h3><label>Filtrar status <select value={logFilter} onChange={(event) => setLogFilter(event.target.value)}><option value="all">Todos</option><option value="ok">Concluídos</option><option value="review">Revisão</option><option value="sent">Enviados</option><option value="uncertain">Incerto</option></select></label></div><div className="sentinel-logs__table"><table><thead><tr><th>Data</th><th>Pedido</th><th>Operação</th><th>Status</th><th>Duração</th><th>Provedor</th><th>Detalhe</th></tr></thead><tbody>{logs.slice(0, 50).map((event) => <tr key={event.id}><td>{dateTime(event.at)}</td><td>{event.orderId ? event.orderId.slice(0, 8) : '—'}</td><td>{event.operation}</td><td>{event.status}</td><td>{event.durationMs} ms</td><td>{event.provider}</td><td>{event.message}</td></tr>)}</tbody></table></div></div>
    </section>;
}

function OrderCard({ order, onSaved }) {
    const [distance, setDistance] = useState(order.shippingCalculation ? decimal(order.shippingCalculation.distanceKm) : order.route?.distanceKm ? decimal(order.route.distanceKm) : '');
    const [fuelPrice, setFuelPrice] = useState(order.shippingCalculation ? decimal((order.shippingCalculation.fuelPriceCents / 100).toFixed(2)) : '');
    const [efficiency, setEfficiency] = useState(order.shippingCalculation ? decimal(order.shippingCalculation.efficiencyKmL) : '');
    const [note, setNote] = useState(order.shippingStatus === 'pending' ? '' : order.shippingMessage);
    const [saving, setSaving] = useState(false);
    const [routeBusy, setRouteBusy] = useState(false);
    const [routeInfo, setRouteInfo] = useState('');
    const [error, setError] = useState('');
    const [pdfBusy, setPdfBusy] = useState(false);
    const [pdfError, setPdfError] = useState('');
    const [pdfInfo, setPdfInfo] = useState('');
    const [whatsappUrl, setWhatsappUrl] = useState('');
    const [emailDraft, setEmailDraft] = useState(order.email || '');
    const [emailSaving, setEmailSaving] = useState(false);
    const [emailError, setEmailError] = useState('');

    useEffect(() => {
        setDistance(order.shippingCalculation ? decimal(order.shippingCalculation.distanceKm) : order.route?.distanceKm ? decimal(order.route.distanceKm) : '');
        setFuelPrice(order.shippingCalculation ? decimal((order.shippingCalculation.fuelPriceCents / 100).toFixed(2)) : '');
        setEfficiency(order.shippingCalculation ? decimal(order.shippingCalculation.efficiencyKmL) : '');
        setNote(order.shippingStatus === 'pending' ? '' : order.shippingMessage);
    }, [order.shippingUpdatedAt]);

    useEffect(() => { setEmailDraft(order.email || ''); }, [order.email]);

    useEffect(() => {
        if (!order.route && order.addressStatus === 'validated' && order.shippingStatus === 'pending') findRoute();
    }, [order.id]);

    const distanceKm = parseDecimal(distance, 1);
    const priceReais = parseDecimal(fuelPrice, 2);
    const efficiencyKmL = parseDecimal(efficiency, 1);
    const fuelPriceCents = Math.round(priceReais * 100);
    const validFuel = distanceKm > 0 && distanceKm <= 6000 && fuelPriceCents >= 100 && fuelPriceCents <= 2000 && efficiencyKmL >= 5.5 && efficiencyKmL <= 8.4;
    const estimatedLiters = validFuel ? distanceKm / efficiencyKmL : null;
    const estimatedCents = validFuel ? Math.round(estimatedLiters * fuelPriceCents) : null;
    const fuelRange = distanceKm > 0 && distanceKm <= 6000 && fuelPriceCents >= 100 && fuelPriceCents <= 2000
        ? [Math.round(distanceKm / 8.4 * fuelPriceCents), Math.round(distanceKm / 5.5 * fuelPriceCents)] : null;

    async function findRoute() {
        setRouteBusy(true);
        setError('');
        try {
            const csrfResponse = await fetch('/api/csrf', { credentials: 'same-origin', cache: 'no-store' });
            if (!csrfResponse.ok) throw new Error('Sessão indisponível.');
            const { token } = await csrfResponse.json();
            const response = await fetch(`/api/orders/${order.id}/route`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-CSRF-Token': token } });
            if (response.status === 401) { window.location.replace('/code/login.html'); return; }
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Rota indisponível.');
            setDistance(decimal(result.route.distanceKm));
            setRouteInfo(`Rota de caminhão: ${result.route.origin} → ${result.route.destination}. ${result.route.precision === 'address' ? 'Endereço localizado com número.' : 'Localização aproximada; confira antes de confirmar.'}`);
            onSaved(result.order);
        } catch (failure) { setError(failure.message || 'Rota indisponível.'); }
        finally { setRouteBusy(false); }
    }

    async function saveShipping(status) {
        if (status === 'quoted' && !validFuel) { setError('Informe distância da ida, preço atual do diesel S10 e consumo do caminhão entre 5,5 e 8,4 km/l.'); return; }
        if (status === 'quoted' && estimatedCents > 10000) { setError('O custo de combustível supera R$ 100,00. Revise o limite antes de confirmar.'); return; }
        if (status === 'unavailable' && !note.trim()) { setError('Explique por que a entrega não está disponível.'); return; }
        setSaving(true);
        setError('');
        try {
            const csrfResponse = await fetch('/api/csrf', { credentials: 'same-origin', cache: 'no-store' });
            if (!csrfResponse.ok) throw new Error('Sessão indisponível.');
            const { token } = await csrfResponse.json();
            const response = await fetch(`/api/orders/${order.id}/shipping`, {
                method: 'PATCH', credentials: 'same-origin', cache: 'no-store',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
                body: JSON.stringify({ status, distanceKm, fuelPriceCents, efficiencyKmL, message: note.trim() }),
            });
            if (response.status === 401) { window.location.replace('/code/login.html'); return; }
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Não foi possível atualizar o frete.');
            onSaved(result.order);
        } catch (failure) {
            setError(failure.message || 'Não foi possível atualizar o frete.');
        } finally {
            setSaving(false);
        }
    }

    async function saveEmail(event) {
        event.preventDefault();
        setEmailSaving(true);
        setEmailError('');
        try {
            if (order.quoteEmailSentAt && emailDraft.trim().toLowerCase() !== order.email && !window.confirm('Este pedido já teve um orçamento aceito para o e-mail anterior. Confirmar a troca do destinatário?')) return;
            const csrfResponse = await fetch('/api/csrf', { credentials: 'same-origin', cache: 'no-store' });
            if (!csrfResponse.ok) throw new Error('Sessão indisponível.');
            const { token } = await csrfResponse.json();
            const response = await fetch(`/api/orders/${order.id}/email`, {
                method: 'PATCH', credentials: 'same-origin', cache: 'no-store',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
                body: JSON.stringify({ email: emailDraft.trim() }),
            });
            if (response.status === 401) { window.location.replace('/code/login.html'); return; }
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Não foi possível salvar o e-mail.');
            onSaved(result.order);
            setPdfError('');
        } catch (failure) {
            setEmailError(failure.message || 'Não foi possível salvar o e-mail.');
        } finally {
            setEmailSaving(false);
        }
    }

    async function sendQuoteEmailAndOpenWhatsapp() {
        if (pdfBusy || order.quote?.totalCents === null) return;
        if (!order.email) {
            setPdfError('Salve o e-mail do cliente neste pedido antes de enviar o orçamento.');
            document.getElementById(`email-${order.id}`)?.focus();
            return;
        }
        const digits = order.whatsapp.replace(/\D/g, '');
        const phone = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
        if (!/^55\d{10,11}$/.test(phone)) { setPdfError('Confira o número de WhatsApp antes de enviar.'); return; }
        if (!window.confirm(`Enviar o orçamento com os valores atuais para ${order.email}? Confirme preços e frete antes de continuar.`)) return;
        const message = 'Olá, somos da PRAPAN!\nVimos que você solicitou um orçamento em nosso site oficial, enviamos ao seu e-mail o orçamento com frete.\nGostaria de dar continuidade na solicitação?';
        const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
        const chatWindow = window.open('about:blank', '_blank');
        if (chatWindow) chatWindow.opener = null;
        setPdfBusy(true);
        setPdfError('');
        setPdfInfo('');
        setWhatsappUrl('');
        try {
            const csrfResponse = await fetch('/api/csrf', { credentials: 'same-origin', cache: 'no-store' });
            if (!csrfResponse.ok) throw new Error('Sessão indisponível.');
            const { token } = await csrfResponse.json();
            const response = await fetch(`/api/orders/${order.id}/quote/email`, {
                method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-CSRF-Token': token },
            });
            if (response.status === 401) { chatWindow?.close(); window.location.replace('/code/login.html'); return; }
            const result = await response.json();
            if (!response.ok || !result.accepted) throw new Error(result.error || 'Não foi possível enviar o e-mail.');
            if (result.order) onSaved(result.order);
            setWhatsappUrl(url);
            if (chatWindow && !chatWindow.closed) chatWindow.location.replace(url);
            setPdfInfo(`${result.alreadySent ? 'Este orçamento já havia sido aceito pela Brevo; o e-mail não foi reenviado.' : `PDF salvo na pasta PDF; envio para ${result.email} aceito pela Brevo.`} ${chatWindow && !chatWindow.closed ? 'Conversa aberta no WhatsApp.' : 'Abra a conversa pelo link abaixo.'} Confira o destinatário e envie a mensagem no WhatsApp.`);
        } catch (failure) {
            chatWindow?.close();
            setPdfError(failure.message || 'Não foi possível enviar o orçamento por e-mail.');
        } finally {
            setPdfBusy(false);
        }
    }

    const shippingLabel = order.shippingStatus === 'quoted' ? (order.shippingCalculation ? 'Custo de combustível registrado' : 'Frete registrado anteriormente') : order.shippingStatus === 'unavailable' ? 'Entrega indisponível' : 'Entrega aguardando análise';
    const statusLabel = order.shippingStatus === 'quoted' ? 'Orçamento pronto' : order.shippingStatus === 'unavailable' ? 'Entrega indisponível' : 'Frete pendente';
    const emailEditor = <form className="order-card__email-form" onSubmit={saveEmail}>
        <label htmlFor={`email-${order.id}`}>{order.email ? 'Corrigir e-mail do cliente' : 'Adicionar e-mail do cliente'}</label>
        <div><input id={`email-${order.id}`} type="email" name={`email-${order.id}`} autoComplete="email" maxLength={254} required placeholder="cliente@empresa.com.br" value={emailDraft} onChange={(event) => setEmailDraft(event.target.value)} /><button type="submit" disabled={emailSaving}>{emailSaving ? 'Salvando…' : 'Salvar e-mail'}</button></div>
        {emailError && <small className="order-card__warning" role="alert">{emailError}</small>}
    </form>;
    return <article className="order-card" aria-labelledby={`order-${order.id}`}>
        <details className="order-card__disclosure">
        <summary className="order-card__head">
            <span className="order-card__identity">
                <span className="order-card__eyebrow">Solicitação #{order.id.slice(0, 8)}</span>
                <strong id={`order-${order.id}`} className="order-card__name">{order.empresa}</strong>
                <span className="order-card__date">Recebida em <time dateTime={order.createdAt}>{dateTime(order.createdAt)}</time></span>
            </span>
            <span className="order-card__meta">
                <span><small>Destino</small><b>{order.cidade}/{order.estado}</b></span>
                <span><small>Pedido</small><b>{order.quote.items.length} {order.quote.items.length === 1 ? 'produto' : 'produtos'} · {order.quote.quantityTotal.toLocaleString('pt-BR')} un.</b></span>
            </span>
            <span className="order-card__outcome">
                <span className={`order-card__status order-card__status--${order.shippingStatus}`}>{statusLabel}</span>
                <strong className="order-card__total">{order.quote.totalCents === null ? 'A analisar' : money(order.quote.totalCents)}</strong>
                <small>{order.quote.totalCents === null ? 'Total aguardando frete' : 'Produtos + entrega'}</small>
            </span>
            <span className="order-card__chevron" aria-hidden="true">⌄</span>
        </summary>
        <div className="order-card__body">
        <div className="order-card__details">
            <div className="order-card__section">
                <h4>Contato</h4>
                <p><b>Cliente:</b> {order.cliente}</p>
                <p><b>WhatsApp:</b> <a href={`tel:${order.whatsapp.replace(/\D/g, '')}`}>{order.whatsapp}</a></p>
                <p><b>E-mail:</b> {order.email ? <a href={`mailto:${order.email}`}>{order.email}</a> : 'Não informado neste pedido antigo'}</p>
                {order.email ? <details className="order-card__email-editor"><summary>Corrigir e-mail</summary>{emailEditor}</details> : emailEditor}
            </div>
            <div className="order-card__section">
                <h4>Entrega</h4>
                <p>{order.endereco}</p>
                <p>{order.cidade}/{order.estado}, CEP {order.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2')}</p>
                {order.addressStatus === 'pending' ? <p className="order-card__warning">CEP ainda não conferido por indisponibilidade do serviço de validação.</p> : <p className="order-card__validated">CEP, cidade e UF conferidos.</p>}
                <p><b>Prioridade:</b> {order.urgencia === 'urgente' ? 'Urgente' : 'Prazo normal'}</p>
                {order.observacoes && <p><b>Observações:</b> {order.observacoes}</p>}
            </div>
        </div>
        <div className="order-card__products">
            <h4>Produtos solicitados</h4>
            <ul>
                {order.quote.items.map((item) => <li key={item.id}>
                    <span><b>{item.name}</b><small>{item.quantity.toLocaleString('pt-BR')} unidades × {money(item.unitPriceCents)}</small></span>
                    <strong>{money(item.totalCents)}</strong>
                </li>)}
            </ul>
            <div className="order-card__quote">
                <div><span>Total de unidades</span><strong>{order.quote.quantityTotal.toLocaleString('pt-BR')}</strong></div>
                <div><span>Produtos</span><strong>{money(order.quote.productsTotalCents)}</strong></div>
                <div><span>Entrega</span><strong>{order.quote.shippingCents === null ? 'Pendente' : money(order.quote.shippingCents)}</strong></div>
                <div className="order-card__quote-final"><span>Total do orçamento</span><strong>{order.quote.totalCents === null ? 'Aguardando frete' : money(order.quote.totalCents)}</strong></div>
            </div>
            <div className="order-card__pdf"><p>{order.quote.pricesProvisional ? 'Preços unitários provisórios. Confirme antes de enviar ao cliente.' : 'Preços autorizados pela política comercial.'}</p><button type="button" onClick={sendQuoteEmailAndOpenWhatsapp} disabled={pdfBusy || order.quote.totalCents === null}>{pdfBusy ? 'Enviando por e-mail…' : 'Enviar PDF por e-mail e abrir WhatsApp'}</button></div>
            {pdfInfo && <p className="order-card__validated" role="status">{pdfInfo} {whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">Abrir conversa</a>}</p>}
            {pdfError && <p className="order-card__warning" role="alert">{pdfError}</p>}
        </div>
        <div className="order-card__shipping">
            <div className="order-card__shipping-overview">
                <div><span className="order-card__shipping-kicker">Entrega</span><strong>{shippingLabel}</strong><small>{order.route?.distanceKm ? `${decimal(order.route.distanceKm)} km de ida${order.route.status === 'approximate' ? ' · conferir localização' : ''}` : order.route?.status === 'unavailable' ? 'Rota não localizada' : 'Distância pendente'}</small></div>
            </div>
            <details className="order-card__shipping-details">
                <summary>{order.shippingStatus === 'pending' ? 'Calcular e registrar entrega' : 'Ver ou ajustar entrega'}<span aria-hidden="true">⌄</span></summary>
                <div className="order-card__shipping-panel">
                    <div className="order-card__shipping-context"><h4>Dados do cálculo</h4><p><b>Origem:</b> Av. das Américas, 779, São José dos Pinhais/PR.</p><p><b>Veículo:</b> VW Delivery. Somente combustível da ida; pedágio, motorista, manutenção e margem não estão incluídos.</p>{order.route?.destination && <p><b>Destino localizado:</b> {order.route.destination}. {order.route.status === 'approximate' ? 'Número não confirmado pela API; confira antes de registrar.' : 'Número confirmado pela API.'}</p>}{order.route?.status === 'unavailable' && <p className="order-card__warning">{order.route.message}</p>}{order.shippingCalculation && <p><b>Último cálculo:</b> {decimal(order.shippingCalculation.distanceKm)} km ÷ {decimal(order.shippingCalculation.efficiencyKmL)} km/l × {money(order.shippingCalculation.fuelPriceCents)}/l = {money(order.shippingCalculation.amountCents)}. {order.shippingCalculation.fuelSource && `Fonte: ${order.shippingCalculation.fuelSource}, coleta ${order.shippingCalculation.fuelReferenceDate}.`}</p>}{order.shippingMessage && <p><b>Observação:</b> {order.shippingMessage}</p>}</div>
            <form onSubmit={(event) => { event.preventDefault(); saveShipping('quoted'); }}>
                <label htmlFor={`shipping-distance-${order.id}`}>Distância rodoviária da ida (km)</label>
                <div className="order-card__route"><input id={`shipping-distance-${order.id}`} name={`shipping-distance-${order.id}`} type="text" inputMode="decimal" autoComplete="off" placeholder="Ex.: 18,5" maxLength={6} value={distance} onChange={(event) => { setDistance(event.target.value); setRouteInfo(''); }} /><button type="button" disabled={routeBusy} onClick={findRoute}>{routeBusy ? 'Consultando…' : 'Recalcular rota'}</button></div>
                <small>Distância preenchida automaticamente quando a API localiza o destino. Confira o trajeto e eventuais restrições reais do veículo.</small>
                {routeInfo && <small className="order-card__route-info" role="status">{routeInfo}</small>}
                <label htmlFor={`shipping-price-${order.id}`}>Diesel S10 pago no posto (R$/litro)</label>
                <input id={`shipping-price-${order.id}`} name={`shipping-price-${order.id}`} type="text" inputMode="decimal" autoComplete="off" placeholder="Ex.: 7,31" maxLength={6} value={fuelPrice} onChange={(event) => setFuelPrice(event.target.value)} />
                <small>No modo automático, o Sentinel consulta o <a href="https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/shpc/qus/ultimas-4-semanas-diesel-gnv.csv" target="_blank" rel="noopener noreferrer">CSV oficial da ANP</a> para São José dos Pinhais. Para uma confirmação manual, informe o valor efetivamente pago.</small>
                <label htmlFor={`shipping-efficiency-${order.id}`}>Consumo real do caminhão (km/l)</label>
                <input id={`shipping-efficiency-${order.id}`} name={`shipping-efficiency-${order.id}`} type="text" inputMode="decimal" autoComplete="off" placeholder="De 5,5 a 8,4" maxLength={3} value={efficiency} onChange={(event) => setEfficiency(event.target.value)} />
                <small>Faixa informada pela empresa: 5,5 a 8,4 km/l. Use a média real do veículo e da carga.</small>
                <output className="order-card__estimate">{validFuel ? `${estimatedLiters.toFixed(2).replace('.', ',')} litros × ${money(fuelPriceCents)}/l = ${money(estimatedCents)} de combustível (somente ida)` : fuelRange ? `Com consumo entre 5,5 e 8,4 km/l: ${money(fuelRange[0])} a ${money(fuelRange[1])} de combustível na ida. Informe o consumo real para registrar.` : 'Preencha distância e diesel para ver a faixa de custo da ida.'}</output>
                <label htmlFor={`shipping-note-${order.id}`}>Observação da entrega</label>
                <textarea id={`shipping-note-${order.id}`} name={`shipping-note-${order.id}`} autoComplete="off" maxLength={300} rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Prazo, condições ou motivo da indisponibilidade" />
                <div className="order-card__shipping-actions"><button type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Registrar custo da ida'}</button><button type="button" disabled={saving} onClick={() => saveShipping('unavailable')}>Entrega indisponível</button></div>
                <p className="order-card__warning" role="alert">{error}</p>
            </form>
                </div>
            </details>
        </div>
        </div>
        </details>
    </article>;
}

function Dashboard() {
    const [section, setSection] = useState(() => window.location.hash === '#agente' ? 'agente' : 'vendas');
    const [orders, setOrders] = useState([]);
    const [ready, setReady] = useState(false);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [updatedAt, setUpdatedAt] = useState(null);

    useEffect(() => {
        const onHashChange = () => setSection(window.location.hash === '#agente' ? 'agente' : 'vendas');
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, []);

    function navigateTo(nextSection) {
        if (nextSection === section) return;
        window.location.hash = nextSection;
        setSection(nextSection);
        window.scrollTo(0, 0);
        window.requestAnimationFrame(() => document.getElementById(nextSection === 'agente' ? 'sentinel-title' : 'dashboard-title')?.focus());
    }

    const refresh = useCallback(async (showBusy = false) => {
        if (showBusy) setLoading(true);
        try {
            const response = await fetch('/api/orders', { credentials: 'same-origin', cache: 'no-store' });
            if (response.status === 401) {
                window.location.replace('/code/login.html');
                return;
            }
            if (!response.ok) throw new Error('Não foi possível atualizar as solicitações.');
            const data = await response.json();
            setOrders(data.orders);
            setUpdatedAt(new Date());
            setReady(true);
            setMessage('');
        } catch {
            setReady(true);
            setMessage('Conexão indisponível. Os pedidos não puderam ser atualizados.');
        } finally {
            if (showBusy) setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh(true);
        const timer = window.setInterval(() => { if (!document.hidden) refresh(); }, 15000);
        const onVisibility = () => { if (!document.hidden) refresh(); };
        document.addEventListener('visibilitychange', onVisibility);
        return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
    }, [refresh]);

    const counts = useMemo(() => ({
        all: orders.length,
        pending: orders.filter((order) => order.shippingStatus === 'pending').length,
        quoted: orders.filter((order) => order.shippingStatus === 'quoted').length,
        unavailable: orders.filter((order) => order.shippingStatus === 'unavailable').length,
    }), [orders]);

    const filtered = useMemo(() => {
        const term = query.trim().toLocaleLowerCase('pt-BR');
        return orders.filter((order) => (statusFilter === 'all' || order.shippingStatus === statusFilter)
            && (!term || [order.empresa, order.cliente, order.cidade, order.cep, order.id]
                .some((value) => value.toLocaleLowerCase('pt-BR').includes(term))));
    }, [orders, query, statusFilter]);

    const filters = [
        { id: 'all', label: 'Total de pedidos', detail: 'Todas as solicitações', count: counts.all },
        { id: 'pending', label: 'Frete pendente', detail: 'Precisam de análise', count: counts.pending },
        { id: 'quoted', label: 'Orçamento pronto', detail: 'Com entrega registrada', count: counts.quoted },
        { id: 'unavailable', label: 'Indisponíveis', detail: 'Entrega não disponível', count: counts.unavailable },
    ];

    async function logout() {
        try {
            const csrfResponse = await fetch('/api/csrf', { credentials: 'same-origin', cache: 'no-store' });
            if (!csrfResponse.ok) throw new Error('csrf');
            const { token } = await csrfResponse.json();
            const response = await fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': token } });
            if (!response.ok) throw new Error('logout');
            window.location.replace('/code/login.html');
        } catch {
            setMessage('Não foi possível encerrar a sessão. Tente novamente.');
        }
    }

    return <div className="dashboard-layout">
        <aside className="dashboard-sidebar" aria-label="Menu do dashboard">
            <div className="dashboard-sidebar__heading"><span className="dashboard-sidebar__eyebrow">Área reservada</span><strong>Painel PraPan<span>.</span></strong><p>Operação e decisões em um só lugar.</p></div>
            <nav className="dashboard-nav" aria-label="Telas do dashboard">
                <button type="button" className={`dashboard-nav__item ${section === 'vendas' ? 'is-active' : ''}`} aria-current={section === 'vendas' ? 'page' : undefined} aria-controls="dashboard-vendas" onClick={() => navigateTo('vendas')}><span className="dashboard-nav__icon" aria-hidden="true">▦</span><span><strong>Vendas</strong><small>Pedidos e orçamentos</small></span><span className="dashboard-nav__count" aria-label={`${counts.all} pedidos`}>{counts.all}</span></button>
                <button type="button" className={`dashboard-nav__item ${section === 'agente' ? 'is-active' : ''}`} aria-current={section === 'agente' ? 'page' : undefined} aria-controls="dashboard-agente" onClick={() => navigateTo('agente')}><span className="dashboard-nav__icon" aria-hidden="true">✦</span><span><strong>Sentinel AI</strong><small>Agente de vendas</small></span></button>
            </nav>
            <div className="dashboard-sidebar__foot"><span className="dashboard-topline__mark" aria-hidden="true"></span><span>Acesso administrativo protegido</span></div>
        </aside>
        <div className="dashboard-shell">
        <div className="dashboard-topline"><span><span className="dashboard-topline__mark" aria-hidden="true"></span>Área reservada <span aria-hidden="true">/</span> {section === 'vendas' ? 'Vendas' : 'Sentinel AI'}</span><button className="dashboard-exit" type="button" onClick={logout}>Sair da conta</button></div>
        <div className="dashboard-screen" id="dashboard-vendas" hidden={section !== 'vendas'}>
        <section className="dashboard-hero" aria-labelledby="dashboard-title">
            <div><p className="dashboard-kicker">Central de operações</p><h1 id="dashboard-title" tabIndex="-1">Pedidos em foco<span>.</span></h1><p>Uma visão clara das solicitações recebidas, do frete e dos orçamentos prontos para enviar.</p></div>
            <div className="dashboard-hero__aside"><span className="dashboard-hero__pulse" aria-hidden="true"></span><strong>Fila de orçamentos</strong><small>Atualização automática a cada 15 segundos</small></div>
        </section>
        <section className="dashboard-metrics" aria-label="Filtrar pedidos por situação">
            {filters.map((filter) => <button className={`dashboard-metric dashboard-metric--${filter.id}`} type="button" key={filter.id} aria-pressed={statusFilter === filter.id} onClick={() => setStatusFilter(filter.id)}>
                <span className="dashboard-metric__label">{filter.label}</span>
                <strong>{filter.count.toLocaleString('pt-BR')}</strong>
                <span className="dashboard-metric__detail">{filter.detail}<span aria-hidden="true">↗</span></span>
            </button>)}
        </section>
        <section className="dashboard-list" aria-labelledby="dashboard-list-title">
            <div className="dashboard-toolbar"><div><p className="dashboard-kicker">Fila de trabalho</p><h2 id="dashboard-list-title">Solicitações recentes</h2><small>{updatedAt ? `Atualizado às ${new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(updatedAt)}` : 'Aguardando atualização'} · {filtered.length} {filtered.length === 1 ? 'pedido exibido' : 'pedidos exibidos'}</small></div><div className="dashboard-controls"><label className="dashboard-search">Buscar pedido<input type="search" name="dashboard-search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Empresa, cliente, cidade ou CEP…" /></label><button type="button" onClick={() => refresh(true)} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar lista'}</button></div></div>
            <p className="dashboard-message" role="status">{message}</p>
            {!ready && <p className="dashboard-empty">Carregando solicitações…</p>}
            {ready && !orders.length && <div className="dashboard-empty"><strong>Nenhuma solicitação ainda.</strong><p>Quando alguém enviar um orçamento pelo formulário, o pedido aparecerá aqui.</p></div>}
            {ready && orders.length > 0 && !filtered.length && <p className="dashboard-empty">Nenhum pedido corresponde aos filtros. Escolha “Total de pedidos” ou ajuste a busca.</p>}
            <div className="dashboard-cards">{filtered.map((order) => <OrderCard key={order.id} order={order} onSaved={(updated) => { setOrders((current) => current.map((item) => item.id === updated.id ? updated : item)); setUpdatedAt(new Date()); }} />)}</div>
        </section>
        </div>
        <div className="dashboard-screen dashboard-screen--agente" id="dashboard-agente" hidden={section !== 'agente'}><SentinelPanel /></div>
        </div>
    </div>;
}

createRoot(document.getElementById('dashboard-react-root')).render(<Dashboard />);
