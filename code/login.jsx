import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

function LoginForm() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [csrfToken, setCsrfToken] = useState('');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let active = true;
        fetch('/api/csrf', { credentials: 'same-origin', cache: 'no-store' })
            .then((response) => response.ok ? response.json() : Promise.reject())
            .then((data) => { if (active) setCsrfToken(data.token); })
            .catch(() => { if (active) setMessage('Acesso temporariamente indisponível.'); });
        return () => { active = false; };
    }, []);

    async function submit(event) {
        event.preventDefault();
        if (loading || !csrfToken) return;
        setLoading(true);
        setMessage('');
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({ email, password }),
            });
            if (!response.ok) {
                setPassword('');
                setMessage(response.status === 429 ? 'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.'
                    : response.status === 403 ? 'Sessão de acesso expirada ou configuração do site incorreta. Atualize a página e tente novamente.'
                        : response.status === 503 ? 'Autenticação temporariamente indisponível. Tente novamente mais tarde.'
                            : 'E-mail ou senha inválidos.');
                return;
            }
            setPassword('');
            window.location.assign('/dashboard');
        } catch {
            setPassword('');
            setMessage('Acesso temporariamente indisponível.');
        } finally {
            setLoading(false);
        }
    }

    return <>
        <form className="login-form" id="login-form" onSubmit={submit} aria-label="Acesso ao dashboard" aria-describedby="login-status">
            <fieldset disabled={loading}>
                <legend className="visually-hidden">Credenciais de acesso</legend>
                <div className="login-field">
                    <label htmlFor="login-email">E-mail de acesso</label>
                    <input id="login-email" name="username" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck="false" placeholder="voce@empresa.com.br" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} />
                </div>
                <div className="login-field">
                    <label htmlFor="login-password">Senha</label>
                    <input id="login-password" name="password" type="password" autoComplete="current-password" placeholder="Digite sua senha" maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} />
                </div>
                <button className="login-submit" id="login-submit" type="submit" disabled={!csrfToken || loading}>
                    {loading ? 'Verificando...' : 'Entrar no dashboard'} <span aria-hidden="true">↗</span>
                </button>
            </fieldset>
        </form>
        <p className="login-status" id="login-status" role="alert">{message}</p>
    </>;
}

const loginRoot = document.getElementById('login-react-root');
if (loginRoot) createRoot(loginRoot).render(<LoginForm />);
