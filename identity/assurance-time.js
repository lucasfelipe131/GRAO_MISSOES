// OIDC NumericDate claims are integer seconds; central service proofs use
// integer milliseconds. Never guess a unit or coerce an untrusted claim.
export const AUTH_FUTURE_SKEW_SECONDS = 5

function withinWindow(value, now, maxAge, futureSkew) {
 return Number.isSafeInteger(value) && value > 0
  && Number.isSafeInteger(now) && now > 0
  && Number.isSafeInteger(maxAge) && maxAge >= 0
  && value <= now + futureSkew && now - value <= maxAge
}

export function isRecentOidcTimestamp(value, {nowMs = Date.now(), maxAgeSeconds = 300} = {}) {
 if (!Number.isSafeInteger(nowMs) || nowMs <= 0) return false
 return withinWindow(value, Math.floor(nowMs / 1000), maxAgeSeconds, AUTH_FUTURE_SKEW_SECONDS)
}

export function isRecentServiceTimestamp(value, {nowMs = Date.now(), maxAgeSeconds = 300} = {}) {
 if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) return false
 return withinWindow(value, nowMs, maxAgeSeconds * 1000, AUTH_FUTURE_SKEW_SECONDS * 1000)
}

// Reports the method actually authenticated. Password-only never becomes AAL2
// and never supplies an MFA timestamp. Callers still enforce app roles/scope.
export function recentAssuranceMethod(claims, {passwordSso, ...window} = {}) {
 if (claims?.auth_level === 'AAL2' && isRecentOidcTimestamp(claims.mfa_authenticated_at, window)) return 'mfa'
 if (claims?.auth_level === 'AAL1' && claims.mfa_authenticated_at === null
  && Array.isArray(claims.amr) && claims.amr.length === 1 && claims.amr[0] === 'pwd'
  && passwordSso?.permits(claims) === true
  && isRecentOidcTimestamp(claims.password_authenticated_at, window)) return 'pwd'
 return null
}
