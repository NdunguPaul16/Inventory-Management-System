import mongoose from 'mongoose';
import process from 'node:process';

export function assertDatabaseRole(status, role, dbName) {
  const roles = status.authInfo?.authenticatedUserRoles;
  if (
    !Array.isArray(roles) ||
    roles.length !== 1 ||
    roles[0]?.role !== role ||
    roles[0]?.db !== dbName
  ) {
    throw new Error('A single database-scoped test role is required');
  }
}

/** The caller must run assertVolumeTarget before invoking this function. */
export async function connectVolume(target, role, connect = mongoose.connect) {
  if (!target?.uri || !target?.dbName || !['read', 'readWrite'].includes(role)) {
    throw new Error('Validated volume target and database role are required');
  }
  try {
    await connect(target.uri, {
      dbName: target.dbName,
      autoIndex: false,
      autoCreate: false,
      retryReads: false,
      retryWrites: false,
      serverSelectionTimeoutMS: 10_000,
    });
    const db = mongoose.connection.db;
    if (!db || db.databaseName !== target.dbName) {
      throw new Error('Connected database does not match the approved target');
    }
    const status = await db.admin().command({ connectionStatus: 1 });
    assertDatabaseRole(status, role, target.dbName);
    return db;
  } catch (error) {
    await mongoose.disconnect().catch(() => {});
    throw error;
  }
}

export async function disconnectVolume() {
  await mongoose.disconnect();
}

export function reportFailure(kind, category = 'configuration_or_connection') {
  process.stderr.write(
    `${JSON.stringify({ status: 'FAIL', step: kind, errorCategory: category })}\n`,
  );
  process.exitCode = 1;
}
