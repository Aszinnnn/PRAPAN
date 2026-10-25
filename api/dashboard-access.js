export function claimDashboardEntry(session) {
    if (!session?.dashboardEntryPending) return false;
    session.dashboardEntryPending = false;
    return true;
}
