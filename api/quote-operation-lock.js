const active = new Set();

export function claimQuoteOperation(id) {
    if (active.has(id)) return false;
    active.add(id);
    return true;
}

export function releaseQuoteOperation(id) {
    active.delete(id);
}
