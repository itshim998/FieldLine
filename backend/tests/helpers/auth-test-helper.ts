import { authService } from '../../src/services/auth.service.js';
import { AccountType } from '../../src/models/domain.types.js';

/**
 * Creates a signed, valid HMAC-SHA256 session token for testing.
 */
export function createTestSessionToken(
  projectId: string,
  accountType: AccountType = 'admin',
  displayName?: string
): string {
  return authService.createSessionToken({
    projectId,
    accountType,
    displayName: displayName || (accountType === 'admin' ? 'Test Admin Lead' : 'Test Worker Crew')
  });
}

/**
 * Returns an HTTP Authorization header with a signed session token.
 */
export function authHeader(
  projectId: string,
  accountType: AccountType = 'admin'
): { Authorization: string } {
  const token = createTestSessionToken(projectId, accountType);
  return {
    Authorization: `Bearer ${token}`
  };
}

/**
 * Helper for Admin role authorization header.
 */
export function adminAuthHeader(projectId: string): { Authorization: string } {
  return authHeader(projectId, 'admin');
}

/**
 * Helper for Worker role authorization header.
 */
export function workerAuthHeader(projectId: string): { Authorization: string } {
  return authHeader(projectId, 'worker');
}
