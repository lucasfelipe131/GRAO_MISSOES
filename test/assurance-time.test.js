import test from 'node:test'
import assert from 'node:assert/strict'
import {isRecentOidcTimestamp, isRecentServiceTimestamp, recentAssuranceMethod} from '../identity/assurance-time.js'
import {passwordSsoPolicy, PASSWORD_SSO} from '../identity/password-sso.js'

const nowMs = Date.parse('2026-10-22T18:00:00.000Z')
const nowSeconds = nowMs / 1000

test('OIDC seconds accept exactly five minutes and reject stale, future or millisecond claims', () => {
 for (const stamp of [nowSeconds, nowSeconds - 300, nowSeconds + 5]) assert.equal(isRecentOidcTimestamp(stamp, {nowMs}), true)
 for (const stamp of [nowSeconds - 301, nowSeconds + 6, nowSeconds + 3600, nowMs]) assert.equal(isRecentOidcTimestamp(stamp, {nowMs}), false)
})

test('service proof milliseconds preserve millisecond boundaries and reject second claims', () => {
 for (const stamp of [nowMs, nowMs - 300000, nowMs + 5000]) assert.equal(isRecentServiceTimestamp(stamp, {nowMs}), true)
 for (const stamp of [nowMs - 300001, nowMs + 5001, nowMs + 3600000, nowSeconds]) assert.equal(isRecentServiceTimestamp(stamp, {nowMs}), false)
})

test('both clocks reject coercion, negative, zero, non-integer and unsafe timestamps', () => {
 const invalid = [undefined, null, '', '1761156000', false, true, [], {}, 0, -1, NaN, Infinity, -Infinity, nowSeconds + 0.5, Number.MAX_SAFE_INTEGER + 1]
 for (const stamp of invalid) {
  assert.equal(isRecentOidcTimestamp(stamp, {nowMs}), false, String(stamp))
  assert.equal(isRecentServiceTimestamp(stamp, {nowMs}), false, String(stamp))
 }
 assert.equal(isRecentServiceTimestamp(nowMs + 0.5, {nowMs}), false)
})

test('clock and maximum-age options cannot weaken integer validation', () => {
 for (const invalid of [0, -1, NaN, Infinity, '300', 300.5]) {
  if (invalid !== 300.5) assert.equal(isRecentOidcTimestamp(nowSeconds, {nowMs:invalid}), false)
  assert.equal(isRecentServiceTimestamp(nowMs, {nowMs:invalid}), false)
 }
 assert.equal(isRecentOidcTimestamp(nowSeconds, {nowMs:nowMs + 0.5}), false)
 for (const maxAgeSeconds of [-1, NaN, Infinity, '300', 300.5]) {
  assert.equal(isRecentOidcTimestamp(nowSeconds, {nowMs, maxAgeSeconds}), false)
  assert.equal(isRecentServiceTimestamp(nowMs, {nowMs, maxAgeSeconds}), false)
 }
})

test('long-lived session validation is explicit and cannot extend the default recent window', () => {
 assert.equal(isRecentOidcTimestamp(nowSeconds - 600, {nowMs}), false)
 assert.equal(isRecentOidcTimestamp(nowSeconds - 600, {nowMs, maxAgeSeconds:43200}), true)
 assert.equal(isRecentServiceTimestamp(nowMs - 600000, {nowMs}), false)
 assert.equal(isRecentServiceTimestamp(nowMs - 600000, {nowMs, maxAgeSeconds:43200}), true)
 assert.equal(isRecentOidcTimestamp(nowSeconds - 43201, {nowMs, maxAgeSeconds:43200}), false)
 assert.equal(isRecentServiceTimestamp(nowMs - 43200001, {nowMs, maxAgeSeconds:43200}), false)
})

function passwordFixture() {
 const tenantId = PASSWORD_SSO.tenantId
 const env = {NODE_ENV:'test', VAL_IDENTITY_TEST:'true', VAL_TEST_PASSWORD_SSO:'true', VAL_PASSWORD_SSO_SUBJECTS_JSON:JSON.stringify([{subjectId:'synthetic-subject',roleRef:'technical_reviewer'}])}
 const passwordSso = passwordSsoPolicy(env, {issuer:'http://127.0.0.1', origin:'http://127.0.0.1', tenantId, clientId:'val-sog'})
 const stamp = Math.floor(Date.now() / 1000)
 const claims = {sub:'synthetic-subject', tenant_id:tenantId, role_ref:'technical_reviewer', auth_level:'AAL1', session_id:'synthetic-session', acr:PASSWORD_SSO.acr, amr:['pwd'], password_only_policy:PASSWORD_SSO.policy, password_authenticated_at:stamp, mfa_authenticated_at:null}
 return {env, passwordSso, claims, clock:stamp * 1000}
}

test('recent password-only assurance remains truthful AAL1 and never creates MFA', () => {
 const {passwordSso, claims, clock} = passwordFixture()
 const before = structuredClone(claims)
 assert.equal(passwordSso.permits(claims), true)
 assert.equal(recentAssuranceMethod(claims, {passwordSso, nowMs:clock}), 'pwd')
 assert.deepEqual(claims, before)
 assert.equal(claims.auth_level, 'AAL1')
 assert.equal(claims.mfa_authenticated_at, null)
 assert.equal(recentAssuranceMethod({...claims,password_authenticated_at:claims.password_authenticated_at-301}, {passwordSso,nowMs:clock}), null)
 assert.equal(recentAssuranceMethod({...claims,password_authenticated_at:claims.password_authenticated_at+6}, {passwordSso,nowMs:clock}), null)
 assert.equal(recentAssuranceMethod({...claims,password_authenticated_at:clock}, {passwordSso,nowMs:clock}), null)
})

test('password assurance still requires the enabled subject-role policy and exact method', () => {
 const {env, passwordSso, claims, clock} = passwordFixture()
 for (const patch of [{sub:'foreign'}, {tenant_id:'foreign'}, {role_ref:'admin'}, {amr:['pwd','mfa']}, {mfa_authenticated_at:clock/1000}, {password_only_policy:'foreign'}]) {
  assert.equal(recentAssuranceMethod({...claims,...patch}, {passwordSso,nowMs:clock}), null)
 }
 assert.equal(recentAssuranceMethod(claims, {nowMs:clock}), null)
 env.VAL_TEST_PASSWORD_SSO = 'false'
 assert.equal(recentAssuranceMethod(claims, {passwordSso,nowMs:clock}), null)
})

test('MFA assurance is independent of password opt-in and also rejects future and wrong units', () => {
 assert.equal(recentAssuranceMethod({auth_level:'AAL2',mfa_authenticated_at:nowSeconds}, {nowMs}), 'mfa')
 for (const stamp of [nowSeconds - 301, nowSeconds + 6, nowMs, null, -1, nowSeconds + 0.5]) {
  assert.equal(recentAssuranceMethod({auth_level:'AAL2',mfa_authenticated_at:stamp}, {nowMs}), null)
 }
 assert.equal(recentAssuranceMethod({auth_level:'AAL1',mfa_authenticated_at:nowSeconds}, {nowMs}), null)
})

