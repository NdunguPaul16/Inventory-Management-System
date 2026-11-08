import { createHash, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { LoginInput } from '@ims/shared';
import mongoose, { Types, type ClientSession } from 'mongoose';
import { AppError } from '../../lib/errors.js';
import { writeAuditLog } from '../audit/service.js';
import { Role, type RoleDoc } from '../roles/model.js';
import { User } from '../users/model.js';
import { permissionsForRoles, publicUser, verifyPassword } from '../users/service.js';
import { Session } from './model.js';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1_000;
const INVALID_LOGIN_MESSAGE = 'Invalid email or password';
// No account uses this hash. It has the same Argon2 parameters as real user hashes.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$VG9vrxtA/83AsXvXLMLl3Q$e2cfQ+CNQrR4aDuXrW/RKX4MH7UTtuh34UemqzbWG5E';

type LoginFailureReason =
  | 'unknown_account'
  | 'inactive_account'
  | 'locked_account'
  | 'invalid_password'
  | 'account_unavailable'
  | 'credentials_changed';

/** An unverified account is the target of an attempt, never its authenticated actor. */
async function auditFailedLogin(
  reason: LoginFailureReason,
  accountId?: Types.ObjectId,
  options?: { session?: ClientSession; failedLoginCount?: number; lockedUntil?: Date },
): Promise<void> {
  await writeAuditLog({
    action: 'auth.login.failed',
    entityType: accountId ? 'user' : 'authentication_attempt',
    entityId: accountId ?? 'unidentified',
    metadata: {
      reason,
      ...(options?.failedLoginCount !== undefined
        ? { failedLoginCount: options.failedLoginCount }
        : {}),
      ...(options?.lockedUntil ? { lockedUntil: options.lockedUntil } : {}),
    },
    ...(options?.session ? { session: options.session } : {}),
  });
}

async function rejectLogin(
  reason: LoginFailureReason,
  password: string,
  accountId?: Types.ObjectId,
): Promise<never> {
  // Keep early rejection paths close to a normal password check and audit transaction.
  await verifyPassword(DUMMY_PASSWORD_HASH, password);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await auditFailedLogin(reason, accountId, { session });
    });
  } finally {
    await session.endSession();
  }
  throw AppError.unauthenticated(INVALID_LOGIN_MESSAGE);
}

export interface AuthConfig {
  accessTokenSecret: string;
  refreshTokenSecret: string;
  secureCookies: boolean;
}

interface AccessPayload extends jwt.JwtPayload {
  type: 'access';
}

interface RefreshPayload extends jwt.JwtPayload {
  type: 'refresh';
  sid: string;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function equalHashes(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function accessToken(userId: string, config: AuthConfig): string {
  return jwt.sign({ type: 'access' }, config.accessTokenSecret, {
    subject: userId,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

async function issueRefreshToken(
  userId: string,
  config: AuthConfig,
  session: ClientSession,
): Promise<{ token: string; sessionId: Types.ObjectId }> {
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1_000);
  const sessionId = new Types.ObjectId();
  const token = jwt.sign({ type: 'refresh', sid: String(sessionId) }, config.refreshTokenSecret, {
    subject: userId,
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
  });
  await Session.create([{ _id: sessionId, userId, tokenHash: tokenHash(token), expiresAt }], {
    session,
  });
  return { token, sessionId };
}

export async function authenticateCredentials(input: LoginInput, config: AuthConfig) {
  const user = await User.findOne({ email: input.email }).select('+passwordHash');
  // Audit persistence is required for login. A failed audit write denies the attempt;
  // counter changes and their audit event commit together in the transaction below.
  if (!user) {
    return rejectLogin('unknown_account', input.password);
  }
  if (!user.isActive) {
    return rejectLogin('inactive_account', input.password, user._id);
  }
  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    return rejectLogin('locked_account', input.password, user._id);
  }
  const valid = await verifyPassword(user.passwordHash, input.password);
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const current = await User.findById(user._id).select('+passwordHash').session(session);
      if (!current) {
        await auditFailedLogin('account_unavailable', user._id, { session });
        return false as const;
      }
      if (!current.isActive) {
        await auditFailedLogin('inactive_account', current._id, { session });
        return false as const;
      }
      if (current.passwordHash !== user.passwordHash) {
        await auditFailedLogin('credentials_changed', current._id, { session });
        return false as const;
      }
      if (current.lockedUntil && current.lockedUntil > new Date()) {
        await auditFailedLogin('locked_account', current._id, { session });
        return false as const;
      }
      if (!valid) {
        current.failedLoginCount += 1;
        if (current.failedLoginCount >= MAX_FAILED_LOGINS)
          current.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
        await current.save({ session });
        await auditFailedLogin('invalid_password', current._id, {
          session,
          failedLoginCount: current.failedLoginCount,
          ...(current.lockedUntil ? { lockedUntil: current.lockedUntil } : {}),
        });
        return false as const;
      }
      current.failedLoginCount = 0;
      current.lockedUntil = undefined;
      current.lastLoginAt = now;
      await current.save({ session });
      const roles = await Role.find({ _id: { $in: current.roleIds } }).session(session);
      const refresh = await issueRefreshToken(String(current._id), config, session);
      await writeAuditLog({
        actorId: current._id,
        action: 'auth.login',
        entityType: 'user',
        entityId: current._id,
        metadata: { sessionId: refresh.sessionId },
        session,
      });
      return {
        user: publicUser(current, roles),
        accessToken: accessToken(String(current._id), config),
        refreshToken: refresh.token,
      };
    });
    if (result === undefined) throw new Error('Login transaction completed without a result');
    if (result === false) throw AppError.unauthenticated(INVALID_LOGIN_MESSAGE);
    return result;
  } finally {
    await session.endSession();
  }
}

export async function refreshSession(refreshToken: string, config: AuthConfig) {
  let payload: RefreshPayload;
  try {
    payload = jwt.verify(refreshToken, config.refreshTokenSecret) as RefreshPayload;
  } catch {
    throw AppError.unauthenticated('Refresh session has expired or is invalid');
  }
  if (payload.type !== 'refresh' || !payload.sub || !Types.ObjectId.isValid(payload.sid)) {
    throw AppError.unauthenticated('Refresh session is invalid');
  }
  const transaction = await mongoose.startSession();
  try {
    const result = await transaction.withTransaction(async () => {
      const previous = await Session.findById(payload.sid)
        .select('+tokenHash')
        .session(transaction);
      if (
        !previous ||
        previous.userId.toString() !== payload.sub ||
        previous.revokedAt ||
        previous.expiresAt <= new Date() ||
        !equalHashes(previous.tokenHash, tokenHash(refreshToken))
      ) {
        throw AppError.unauthenticated('Refresh session has expired or is invalid');
      }
      const user = await User.findById(previous.userId).session(transaction);
      if (!user || !user.isActive) throw AppError.unauthenticated('Account is unavailable');
      const roles = await Role.find({ _id: { $in: user.roleIds } }).session(transaction);
      previous.revokedAt = new Date();
      await previous.save({ session: transaction });
      const refresh = await issueRefreshToken(String(user._id), config, transaction);
      await writeAuditLog({
        actorId: user._id,
        action: 'auth.refresh',
        entityType: 'session',
        entityId: previous._id,
        metadata: { replacementSessionId: refresh.sessionId },
        session: transaction,
      });
      return {
        user: publicUser(user, roles),
        accessToken: accessToken(String(user._id), config),
        refreshToken: refresh.token,
      };
    });
    if (!result) throw new Error('Refresh transaction completed without a result');
    return result;
  } finally {
    await transaction.endSession();
  }
}

export async function revokeRefreshSession(
  refreshToken: string,
  config: AuthConfig,
): Promise<void> {
  let payload: RefreshPayload;
  try {
    payload = jwt.verify(refreshToken, config.refreshTokenSecret) as RefreshPayload;
  } catch {
    // Logging out clears the cookie even when its token has already expired.
    return;
  }
  if (payload.type !== 'refresh' || !Types.ObjectId.isValid(payload.sid)) return;
  const transaction = await mongoose.startSession();
  try {
    await transaction.withTransaction(async () => {
      const session = await Session.findById(payload.sid).select('+tokenHash').session(transaction);
      if (!session || session.revokedAt || !equalHashes(session.tokenHash, tokenHash(refreshToken)))
        return;
      session.revokedAt = new Date();
      await session.save({ session: transaction });
      await writeAuditLog({
        actorId: session.userId,
        action: 'auth.logout',
        entityType: 'session',
        entityId: session._id,
        session: transaction,
      });
    });
  } finally {
    await transaction.endSession();
  }
}

export async function authContextForAccessToken(token: string, config: AuthConfig) {
  let payload: AccessPayload;
  try {
    payload = jwt.verify(token, config.accessTokenSecret) as AccessPayload;
  } catch {
    throw AppError.unauthenticated('Access token is invalid or expired');
  }
  if (payload.type !== 'access' || !payload.sub || !Types.ObjectId.isValid(payload.sub)) {
    throw AppError.unauthenticated('Access token is invalid');
  }
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw AppError.unauthenticated('Account is unavailable');
  const roles: RoleDoc[] = await Role.find({ _id: { $in: user.roleIds } });
  return {
    userId: user._id,
    permissions: permissionsForRoles(roles),
    user: publicUser(user, roles),
  };
}

export function refreshCookieOptions(config: AuthConfig) {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax' as const,
    path: '/api/v1/auth',
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1_000,
  };
}
