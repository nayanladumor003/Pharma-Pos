/**
 * Structured logging for meaningful, traceable business events only — auth
 * events (login/logout/refresh/permission denial) and inventory/sale events
 * (creation, failure, stock movements) — not every request. NEVER pass a
 * password, token, password hash, or full payment card/account detail as
 * `details`.
 */
type AuditEvent =
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'refresh_success'
  | 'refresh_reuse_detected'
  | 'refresh_failed'
  | 'account_inactive'
  | 'permission_denied'
  | 'sale_created'
  | 'sale_failed'
  | 'khata_settlement'
  | 'purchase_received'
  | 'supplier_payment';

export function auditLog(event: AuditEvent, details: Record<string, string | number | undefined>): void {
  console.log(
    JSON.stringify({
      audit: true,
      event,
      timestamp: new Date().toISOString(),
      ...details
    })
  );
}
