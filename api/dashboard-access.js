// Uma autenticação permite abrir o HTML administrativo uma única vez.
// Atualizar ou reabrir a URL exige novas credenciais, mesmo com cookie ativo.
export function claimDashboardEntry(session) {
    if (!session?.dashboardEntryPending) return false;
    session.dashboardEntryPending = false;
    return true;
}
