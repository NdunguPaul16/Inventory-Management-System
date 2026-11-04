import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

/**
 * Starts one single-node replica set for the whole run. It must be a replica set,
 * not a standalone mongod: multi-document transactions require one.
 */
export default async function setup(project: TestProject) {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    // The first mongod start can be slow (binary download, antivirus scan on Windows).
    instanceOpts: [{ launchTimeout: 60_000 }],
  });
  project.provide('mongoUri', replSet.getUri());
  return async () => {
    await replSet.stop();
  };
}
