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
let hasUnsavedChanges = false;

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
}

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

    error.textContent = selected.length ? '' : 'Selecione pelo menos 1 produto.';
    if (!selected.length) firstInvalid = productChoices[0];

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
    choice.addEventListener('change', () => syncProductChoice(choice));
    syncProductChoice(choice);
});

document.querySelectorAll('.product-card > a').forEach((link) => {
    link.addEventListener('click', () => {
        const target = document.querySelector(link.getAttribute('href'));
        const choice = target?.querySelector('[data-product]');
        if (!choice) return;
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
