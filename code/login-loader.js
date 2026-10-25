// Live Server exibe apenas a prévia HTML; a autenticação precisa do Express e do Vite.
fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' })
    .then((response) => {
        if (![200, 401].includes(response.status) || !response.headers.get('content-type')?.includes('application/json')) return;
        return import('./login.jsx');
    })
    .catch(() => {});
