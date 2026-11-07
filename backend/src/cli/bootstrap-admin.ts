import { createInterface } from 'node:readline/promises';
import { bootstrapAdminSchema } from '@ims/shared';
import { connectDb, disconnectDb } from '../config/db.js';
import { EnvValidationError, loadEnvFile, parseEnv } from '../config/env.js';
import { seedDefaultRoles } from '../modules/roles/service.js';
import { User } from '../modules/users/model.js';
import { bootstrapAdministrator } from '../modules/users/service.js';

class CliError extends Error {}

function configuredCredentials() {
  const values = {
    name: process.env.BOOTSTRAP_ADMIN_NAME,
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  };
  const supplied = Object.values(values).filter((value) => value !== undefined).length;
  if (supplied === 0) return undefined;
  if (supplied !== Object.keys(values).length) {
    throw new CliError(
      'Provide BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL, and BOOTSTRAP_ADMIN_PASSWORD together.',
    );
  }
  return bootstrapAdminSchema.parse(values);
}

async function hiddenInput(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new CliError(
      'Use an interactive terminal or provide all three BOOTSTRAP_ADMIN_* variables.',
    );
  }

  process.stdout.write(prompt);
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let value = '';
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          finish(new CliError('Bootstrap cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else if (character >= ' ') {
          value += character;
        }
      }
    };
    input.on('data', onData);
  });
}

async function promptCredentials() {
  const configured = configuredCredentials();
  if (configured) return configured;
  if (!process.stdin.isTTY) {
    throw new CliError(
      'Use an interactive terminal or provide all three BOOTSTRAP_ADMIN_* variables.',
    );
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let name: string;
  let email: string;
  try {
    name = await prompt.question('Administrator name: ');
    email = await prompt.question('Administrator email: ');
  } finally {
    prompt.close();
  }

  const password = await hiddenInput('Password: ');
  const confirmation = await hiddenInput('Confirm password: ');
  if (password !== confirmation) throw new CliError('Passwords do not match.');
  return bootstrapAdminSchema.parse({ name, email, password });
}

async function main(): Promise<void> {
  let connected = false;
  try {
    loadEnvFile();
    const env = parseEnv(process.env);
    if (!env.MONGODB_URI) {
      throw new CliError('MONGODB_URI must point to the intended persistent database.');
    }
    const credentials = await promptCredentials();

    await connectDb(env.MONGODB_URI, {
      dbName: env.MONGODB_DB_NAME,
      autoIndex: env.NODE_ENV !== 'production',
    });
    connected = true;

    if (await User.exists({})) {
      throw new CliError('Bootstrap refused: users already exist; no account was changed.');
    }

    await seedDefaultRoles();
    const created = await bootstrapAdministrator(credentials);
    if (!created) {
      throw new CliError('Bootstrap refused: a user was created during this operation.');
    }
    process.stdout.write('Initial administrator created. Credentials were not printed.\n');
  } catch (error) {
    const message =
      error instanceof CliError
        ? error.message
        : error instanceof EnvValidationError
          ? error.message
          : 'Bootstrap failed. Error details were suppressed to protect credentials and database secrets.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    if (connected) {
      await disconnectDb().catch(() => {
        process.stderr.write('Could not cleanly close the database connection.\n');
      });
    }
  }
}

void main();
