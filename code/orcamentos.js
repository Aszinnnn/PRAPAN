import { catalogProducts } from './catalog-data.js';

function addCatalogProducts() {
    const carousel = document.querySelector('#product-carousel');
    const orderItems = document.querySelector('#order-items');
    if (!carousel || !orderItems) return;
    for (const [index, product] of catalogProducts.entries()) {
        if (index < 4) continue;
        const number = String(index + 1).padStart(2, '0');
        const article = document.createElement('article');
        article.className = 'product-card product-card--mockup';
        article.dataset.productId = product.id;
        const visual = document.createElement('div');
        visual.className = 'product-card__visual';
        const zoom = document.createElement('button');
        zoom.className = 'product-card__zoom';
        zoom.type = 'button';
        zoom.dataset.zoomImage = product.image;
        zoom.dataset.zoomTitle = product.name;
        zoom.setAttribute('aria-label', `Ampliar imagem de ${product.name}`);
        const image = document.createElement('img');
        image.src = product.image;
        image.alt = `Conceito visual de embalagem de ${product.name}`;
        image.width = 1536;
        image.height = 1024;
        image.loading = 'lazy';
        const hint = document.createElement('span');
        hint.className = 'product-card__zoom-hint';
        hint.setAttribute('aria-hidden', 'true');
        hint.textContent = 'Ampliar imagem ＋';
        zoom.append(image, hint);
        const badge = document.createElement('span');
        badge.className = 'product-card__number';
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = number;
        visual.append(zoom, badge);
        const body = document.createElement('div');
        body.className = 'product-card__body';
        const eyebrow = document.createElement('p');
        eyebrow.className = 'product-card__eyebrow';
        eyebrow.textContent = 'Imagem ilustrativa';
        const title = document.createElement('h3');
        title.textContent = product.name;
        const price = document.createElement('p');
        price.className = 'product-card__price';
        price.dataset.priceFor = product.id;
        price.textContent = 'Preço sob consulta';
        const description = document.createElement('p');
        description.textContent = 'Selecione este item e informe a quantidade desejada.';
        body.append(eyebrow, title, price, description);
        const select = document.createElement('a');
        select.href = `#produto-${number}`;
        select.append('Selecionar produto ');
        const arrow = document.createElement('span');
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '↗';
        select.append(arrow);
        article.append(visual, body, select);
        carousel.append(article);

        const item = document.createElement('div');
        item.className = 'order-item';
        item.id = `produto-${number}`;
        const choiceLabel = document.createElement('label');
        choiceLabel.className = 'order-item__choice';
        choiceLabel.htmlFor = `selecionar-${number}`;
        const checkbox = document.createElement('input');
        checkbox.id = `selecionar-${number}`;
        checkbox.name = 'produtos';
        checkbox.type = 'checkbox';
        checkbox.value = product.id;
        checkbox.dataset.product = '';
        checkbox.disabled = true;
        const choiceName = document.createElement('span');
        choiceName.textContent = product.name;
        choiceLabel.append(checkbox, choiceName);
        const quantity = document.createElement('div');
        quantity.className = 'order-item__quantity';
        const quantityLabel = document.createElement('label');
        quantityLabel.htmlFor = `quantidade-${number}`;
        quantityLabel.textContent = 'Unidades';
        const quantityInput = document.createElement('input');
        quantityInput.id = `quantidade-${number}`;
        quantityInput.name = `quantidade-${number}`;
        quantityInput.type = 'number';
        quantityInput.min = '100';
        quantityInput.max = '1000000';
        quantityInput.step = '1';
        quantityInput.inputMode = 'numeric';
        quantityInput.placeholder = 'Mín. 100';
        quantityInput.disabled = true;
        quantity.append(quantityLabel, quantityInput);
        item.append(choiceLabel, quantity);
        orderItems.append(item);
    }
}

addCatalogProducts();

const quoteForm = document.querySelector('#quote-form');
const productChoices = [...document.querySelectorAll('[data-product]')];
const formStatus = document.querySelector('#form-status');
const imageDialog = document.querySelector('#image-dialog');
const imageDialogImage = document.querySelector('#image-dialog-image');
const imageDialogTitle = document.querySelector('#image-dialog-title');
const previewDialog = document.querySelector('#preview-dialog');
const orderPreview = document.querySelector('#order-preview');
const copyButton = document.querySelector('#copy-order');
const copyStatus = document.querySelector('#copy-status');
const productCarousel = document.querySelector('#product-carousel');
const carouselPrevious = document.querySelector('[data-carousel-prev]');
const carouselNext = document.querySelector('[data-carousel-next]');
const carouselCount = document.querySelector('#catalog-carousel-count');
const productSearch = document.querySelector('#buscar-produto');
const selectedProductCount = document.querySelector('#order-items-count');
const catalogStatus = document.querySelector('#catalog-status');
const submitButton = quoteForm?.querySelector('button[type="submit"]');
let hasUnsavedChanges = false;

for (const choice of productChoices) choice.disabled = true;

function setProductAvailability(choice, unitPriceCents) {
    const available = Number.isSafeInteger(unitPriceCents) && unitPriceCents > 0;
    const item = choice.closest('.order-item');
    const card = [...document.querySelectorAll('.product-card')].find((entry) => entry.dataset.productId === choice.value);
    const price = card?.querySelector('.product-card__price');
    const description = card?.querySelector('.product-card__body > p:last-child');
    const link = card?.querySelector(':scope > a');
    const name = choice.closest('label')?.querySelector('span');
    choice.disabled = !available;
    if (!available) choice.checked = false;
    syncProductChoice(choice);
    item?.classList.toggle('is-unavailable', !available);
    card?.classList.toggle('is-unavailable', !available);
    if (price) price.textContent = available ? `${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(unitPriceCents / 100)} por unidade` : 'Preço a definir';
    if (description) description.textContent = available ? 'Selecione este item e informe a quantidade desejada.' : 'Disponível para consulta. Orçamento após a definição do preço.';
    if (link) {
        link.setAttribute('aria-disabled', String(!available));
        link.tabIndex = available ? 0 : -1;
        link.firstChild.textContent = available ? 'Selecionar produto ' : 'Aguardando preço ';
    }
    if (name) {
        name.querySelector('.order-item__availability')?.remove();
        if (!available) {
            const note = document.createElement('small');
            note.className = 'order-item__availability';
            note.textContent = 'Aguardando preço';
            name.append(note);
        }
    }
    return available;
}

async function loadCatalog() {
    try {
        const response = await fetch('/api/catalog', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error('Catálogo indisponível.');
        const catalog = await response.json();
        if (!Array.isArray(catalog.products)) throw new Error('Catálogo inválido.');
        const prices = new Map(catalog.products.map((product) => [product.id, product.unitPriceCents]));
        const availableCount = productChoices.filter((choice) => setProductAvailability(choice, prices.get(choice.value))).length;
        if (catalogStatus) catalogStatus.textContent = availableCount ? `${availableCount} produtos disponíveis para orçamento. Itens sem preço não podem ser selecionados.` : 'Nenhum produto está disponível para orçamento até a definição dos preços.';
    } catch {
        productChoices.forEach((choice) => setProductAvailability(choice, null));
        if (catalogStatus) catalogStatus.textContent = 'Não foi possível consultar os preços. Atualize a página para tentar novamente.';
    }
}

void loadCatalog();

if (productCarousel && carouselPrevious && carouselNext && carouselCount) {
    const cards = [...productCarousel.querySelectorAll('.product-card')];
    const visibleCards = () => window.matchMedia('(max-width: 560px)').matches ? 1 : 2;
    const maxStart = () => Math.max(0, cards.length - visibleCards());
    const cardPosition = (card) => card.offsetLeft - cards[0].offsetLeft;
    const currentStart = () => {
        const nearest = cards.reduce((best, card, index) =>
            Math.abs(cardPosition(card) - productCarousel.scrollLeft) <
            Math.abs(cardPosition(cards[best]) - productCarousel.scrollLeft) ? index : best, 0);
        return Math.min(nearest, maxStart());
    };
    const updateCarousel = () => {
        if (!cards.length) return;
        const start = currentStart();
        carouselPrevious.disabled = start === 0;
        carouselNext.disabled = start >= maxStart();
        carouselCount.textContent = `${start + 1} a ${Math.min(cards.length, start + visibleCards())} de ${cards.length} produtos`;
    };
    const goTo = (index) => {
        const target = cards[Math.max(0, Math.min(index, maxStart()))];
        if (!target) return;
        productCarousel.scrollTo({ left: cardPosition(target), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    };
    carouselPrevious.addEventListener('click', () => goTo(currentStart() - 1));
    carouselNext.addEventListener('click', () => goTo(currentStart() + 1));
    productCarousel.addEventListener('keydown', (event) => {
        if (event.target !== productCarousel || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        goTo(currentStart() + (event.key === 'ArrowRight' ? 1 : -1));
    });
    productCarousel.addEventListener('scroll', updateCarousel, { passive: true });
    window.addEventListener('resize', updateCarousel);
    updateCarousel();
}

function getQuantityInput(choice) {
    return choice.closest('.order-item')?.querySelector('input[type="number"]');
}

function syncProductChoice(choice) {
    const quantity = getQuantityInput(choice);
    const item = choice.closest('.order-item');
    if (!quantity || !item) return;

    quantity.disabled = !choice.checked;
    quantity.required = choice.checked;
    item.classList.toggle('is-selected', choice.checked);

    if (choice.checked && !quantity.value) quantity.value = '100';
    if (!choice.checked) {
        quantity.value = '';
        quantity.removeAttribute('aria-invalid');
    }
    if (productChoices.some((product) => product.checked)) {
        document.querySelector('#produtos-error').textContent = '';
    }
    const count = productChoices.filter((product) => product.checked).length;
    if (selectedProductCount) selectedProductCount.textContent = count ? `${count} ${count === 1 ? 'produto selecionado' : 'produtos selecionados'}` : 'Nenhum produto selecionado';
}

function filterProductChoices() {
    const term = (productSearch?.value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    for (const choice of productChoices) {
        const item = choice.closest('.order-item');
        const name = choice.closest('label')?.textContent.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() || '';
        if (item) item.hidden = Boolean(term) && !name.includes(term) && !choice.checked;
    }
}

productSearch?.addEventListener('input', filterProductChoices);

function setFieldError(field, message) {
    const error = document.querySelector(`#${field.id}-error`);
    if (error) error.textContent = message;
    if (message) {
        field.setAttribute('aria-invalid', 'true');
        if (error) field.setAttribute('aria-describedby', error.id);
    } else {
        field.removeAttribute('aria-invalid');
        field.removeAttribute('aria-describedby');
    }
}

function validateField(field) {
    const value = field.value.trim();
    let message = '';

    if (field.required && !value) {
        message = 'Preencha este campo.';
    } else if (field.id === 'whatsapp' && ![10, 11, 12, 13].includes(value.replace(/\D/g, '').length)) {
        message = 'Informe um telefone com DDD válido.';
    } else if (field.id === 'email' && !field.validity.valid) {
        message = 'Informe um e-mail válido para receber o orçamento.';
    } else if (field.id === 'cep' && value.replace(/\D/g, '').length !== 8) {
        message = 'Informe um CEP com 8 dígitos.';
    }

    setFieldError(field, message);
    return !message;
}

function validateProducts() {
    const selected = productChoices.filter((choice) => choice.checked);
    const error = document.querySelector('#produtos-error');
    let firstInvalid = null;

    error.textContent = selected.length ? '' : productChoices.some((choice) => !choice.disabled) ? 'Selecione pelo menos 1 produto.' : 'Nenhum produto com preço disponível para orçamento.';
    if (!selected.length) {
        if (productSearch) productSearch.value = '';
        filterProductChoices();
        firstInvalid = productChoices.find((choice) => !choice.disabled) || productSearch || null;
    }

    for (const choice of selected) {
        const quantity = getQuantityInput(choice);
        const value = Number(quantity.value);
        const valid = Number.isInteger(value) && value >= 100 && value <= 1000000;
        quantity.setAttribute('aria-invalid', String(!valid));
        if (!valid && !firstInvalid) firstInvalid = quantity;
    }

    if (selected.length && firstInvalid) {
        error.textContent = 'Cada produto selecionado exige de 100 a 1.000.000 de unidades inteiras.';
    }

    return firstInvalid;
}

function buildOrderText(order) {
    return [
        `SOLICITAÇÃO PRAPAN ${order.id}`,
        '',
        `Empresa: ${order.empresa}`,
        `Cliente: ${order.cliente}`,
        `WhatsApp: ${order.whatsapp}`,
        `E-mail: ${order.email}`,
        '',
        'Produtos:',
        ...order.items.map((item) => `- ${item.name}: ${new Intl.NumberFormat('pt-BR').format(item.quantity)} unidades`),
        '',
        'Endereço de entrega:',
        order.endereco,
        `${order.cidade} - ${order.estado}`,
        `CEP: ${order.cep}`,
        '',
        ...(order.route?.reference ? [
            `Distância de ida estimada: ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(order.route.distanceKm)} km${order.route.status === 'approximate' ? ' (localização aproximada)' : ''}.`,
            `Custo de combustível de referência: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(order.route.reference.minCents / 100)} a ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(order.route.reference.maxCents / 100)} (diesel S10, pesquisa de ${order.route.reference.period}).`,
            'Esta faixa não é o preço final do frete.',
            '',
        ] : []),
        'Frete: em análise pela PraPan.',
        'O valor dos produtos e da entrega será confirmado no orçamento.'
    ].join('\n');
}

productChoices.forEach((choice) => {
    choice.addEventListener('change', () => {
        syncProductChoice(choice);
        filterProductChoices();
    });
    syncProductChoice(choice);
});

document.querySelectorAll('.product-card > a').forEach((link) => {
    link.addEventListener('click', (event) => {
        const target = document.querySelector(link.getAttribute('href'));
        const choice = target?.querySelector('[data-product]');
        if (!choice || choice.disabled) { event.preventDefault(); return; }
        if (productSearch) productSearch.value = '';
        filterProductChoices();
        choice.checked = true;
        syncProductChoice(choice);
        hasUnsavedChanges = true;
        requestAnimationFrame(() => getQuantityInput(choice)?.focus({ preventScroll: true }));
    });
});

document.querySelectorAll('[data-zoom-image]').forEach((button) => {
    button.addEventListener('click', () => {
        if (!imageDialog || !imageDialogImage || !imageDialogTitle) return;
        imageDialogImage.src = button.dataset.zoomImage;
        imageDialogImage.alt = `Imagem ampliada do ${button.dataset.zoomTitle}`;
        imageDialogTitle.textContent = button.dataset.zoomTitle;
        imageDialog.showModal();
    });
});

document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
});

[imageDialog, previewDialog].forEach((dialog) => {
    dialog?.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
    });
});

quoteForm?.addEventListener('input', (event) => {
    hasUnsavedChanges = true;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
        if (event.target.id === 'cep') {
            const digits = event.target.value.replace(/\D/g, '').slice(0, 8);
            event.target.value = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
        }
        if (event.target.type === 'number') event.target.removeAttribute('aria-invalid');
        else if (event.target.id) setFieldError(event.target, '');
    }
    if (formStatus) formStatus.textContent = '';
});

quoteForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = [...quoteForm.querySelectorAll('.form-field input, .form-field select')];
    let firstInvalid = null;
    for (const field of fields) {
        if (!validateField(field) && !firstInvalid) firstInvalid = field;
    }
    const invalidProduct = validateProducts();
    if (!firstInvalid) firstInvalid = invalidProduct;

    if (firstInvalid) {
        if (formStatus) formStatus.textContent = 'Revise os campos destacados e tente novamente.';
        firstInvalid.focus();
        return;
    }

    const submitButton = quoteForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    if (formStatus) formStatus.textContent = 'Validando o endereço, consultando a rota e registrando a solicitação...';
    try {
        const csrfResponse = await fetch('/api/csrf', { credentials: 'same-origin', cache: 'no-store' });
        if (!csrfResponse.ok) throw new Error('Abra o site em http://127.0.0.1:4173. O Live Server não envia pedidos.');
        const { token } = await csrfResponse.json();
        const getValue = (id) => quoteForm.querySelector(`#${id}`).value.trim();
        const payload = {
            empresa: getValue('empresa'),
            cliente: getValue('cliente'),
            whatsapp: getValue('whatsapp'),
            email: getValue('email'),
            endereco: getValue('endereco'),
            cidade: getValue('cidade'),
            estado: getValue('estado'),
            cep: getValue('cep'),
            urgencia: getValue('urgencia'),
            observacoes: getValue('observacoes'),
            items: productChoices.filter((choice) => choice.checked).map((choice) => ({ id: choice.value, quantity: Number(getQuantityInput(choice).value) })),
        };
        const response = await fetch('/api/orders', {
            method: 'POST', credentials: 'same-origin', cache: 'no-store',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Não foi possível registrar o pedido.');
        if (orderPreview && previewDialog) {
            orderPreview.textContent = buildOrderText(result.order);
            if (copyStatus) copyStatus.textContent = '';
            previewDialog.showModal();
        }
        quoteForm.reset();
        productChoices.forEach(syncProductChoice);
        filterProductChoices();
        hasUnsavedChanges = false;
        if (formStatus) formStatus.textContent = `Solicitação ${result.order.id.slice(0, 8)} registrada. Ela já aparece no dashboard.`;
    } catch (error) {
        if (formStatus) formStatus.textContent = error.message === 'Failed to fetch' ? 'Servidor indisponível. Abra o site em http://127.0.0.1:4173.' : error.message;
    } finally {
        submitButton.disabled = false;
    }
});

copyButton?.addEventListener('click', async () => {
    if (!orderPreview) return;
    try {
        await navigator.clipboard.writeText(orderPreview.textContent);
        if (copyStatus) copyStatus.textContent = 'Pedido copiado.';
    } catch {
        if (copyStatus) copyStatus.textContent = 'Não foi possível copiar automaticamente. Selecione o texto acima para copiar.';
    }
});

window.addEventListener('beforeunload', (event) => {
    if (!hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = '';
});
