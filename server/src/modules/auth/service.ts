import { createHash, timingSafeEqual } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
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
  if (!user || !user.isActive) throw AppError.unauthenticated('Invalid email or password');
  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    throw AppError.unauthenticated('Too many failed login attempts; try again later');
  }
  const valid = await verifyPassword(user.passwordHash, input.password);
  const session = await mongoose.startSession();
  try {
    if (!valid) {
      await session.withTransaction(async () => {
        const current = await User.findById(user._id).select('+passwordHash').session(session);
        if (!current || !current.isActive || current.passwordHash !== user.passwordHash) return;
        if (current.lockedUntil && current.lockedUntil > new Date()) return;
        current.failedLoginCount += 1;
        if (current.failedLoginCount >= MAX_FAILED_LOGINS)
          current.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
        await current.save({ session });
        await writeAuditLog({
          actorId: current._id,
          action: 'auth.login.failed',
          entityType: 'user',
          entityId: current._id,
          metadata: {
            failedLoginCount: current.failedLoginCount,
            lockedUntil: current.lockedUntil,
          },
          session,
        });
      });
      throw AppError.unauthenticated('Invalid email or password');
    }

    const result = await session.withTransaction(async () => {
      const current = await User.findById(user._id).select('+passwordHash').session(session);
      if (
        !current ||
        !current.isActive ||
        current.passwordHash !== user.passwordHash ||
        (current.lockedUntil && current.lockedUntil > new Date())
      ) {
        throw AppError.unauthenticated('Invalid email or password');
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
    if (!result) throw new Error('Login transaction completed without a result');
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
