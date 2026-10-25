export class AddressError extends Error {
    constructor(message, status = 422, code = 'invalid') {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function normalized(value) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function validateDestination({ cep, cidade, estado }, fetcher = fetch) {
    let response;
    try {
        response = await fetcher(`https://brasilapi.com.br/api/cep/v2/${cep}`, {
            headers: { Accept: 'application/json' },
            redirect: 'error',
            signal: AbortSignal.timeout(8000),
        });
    } catch {
        throw new AddressError('Serviço de validação de CEP indisponível.', 503, 'unavailable');
    }
    if (response.status === 404) throw new AddressError('CEP não encontrado. Confira o endereço.');
    if (!response.ok) throw new AddressError('Serviço de validação de CEP indisponível.', 503, 'unavailable');

    let destination;
    try { destination = await response.json(); }
    catch { throw new AddressError('Resposta inválida do serviço de CEP.', 503, 'unavailable'); }
    if (!destination || typeof destination.cep !== 'string' || typeof destination.city !== 'string' || typeof destination.state !== 'string') {
        throw new AddressError('Resposta incompleta do serviço de CEP.', 503, 'unavailable');
    }
    if (destination.cep.replace(/\D/g, '') !== cep || normalized(destination.city) !== normalized(cidade) || destination.state !== estado) {
        throw new AddressError('Cidade ou UF não correspondem ao CEP informado.');
    }
    const longitude = Number(destination.location?.coordinates?.longitude);
    const latitude = Number(destination.location?.coordinates?.latitude);
    const coordinates = destination.location?.type === 'Point' && Number.isFinite(longitude) && Number.isFinite(latitude)
        && longitude >= -75 && longitude <= -32 && latitude >= -34 && latitude <= 6 ? [longitude, latitude] : null;
    return { cep: destination.cep.replace(/\D/g, ''), cidade: destination.city, estado: destination.state,
        street: typeof destination.street === 'string' ? destination.street : '', coordinates };
}
