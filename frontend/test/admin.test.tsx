import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@ims/shared';
import type { RoleRecord } from '../src/modules/roles/api/roles';
import type { UserRecord } from '../src/modules/users/api/users';
import { healthBody, jsonResponse, renderRoute, sessionBody, testUser } from './utils';

const ADMIN_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const STOREKEEPER_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const USER_ID = 'cccccccccccccccccccccccc';
const NOW = '2026-11-06T09:00:00.000Z';

const adminRole: RoleRecord = {
  id: ADMIN_ID,
  name: 'Admin',
  description: 'Full system access',
  permissions: ['*'],
  isSystem: true,
};
const storekeeperRole: RoleRecord = {
  id: STOREKEEPER_ID,
  name: 'Storekeeper',
  description: 'Stock receiving',
  permissions: ['inventory.balances.read', 'inventory.adjustments.request'],
  isSystem: true,
};

function userRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: USER_ID,
    name: 'Amina Otieno',
    email: 'amina@example.com',
    roleIds: [STOREKEEPER_ID],
    roles: [storekeeperRole],
    permissions: storekeeperRole.permissions,
    isActive: true,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function mockAdminApi({
  authUser = testUser(),
  users = [],
  roles = [adminRole, storekeeperRole],
  expireFirstWrite = false,
}: {
  authUser?: AuthUser;
  users?: UserRecord[];
  roles?: RoleRecord[];
  expireFirstWrite?: boolean;
} = {}) {
  let accessNumber = 0;
  let writeExpired = false;
  const currentUsers = [...users];
  const currentRoles = [...roles];
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    const method = options?.method ?? 'GET';
    if (url === '/api/v1/auth/refresh') {
      accessNumber += 1;
      return jsonResponse(200, sessionBody(authUser, `token-${accessNumber}`));
    }
    if (url === '/api/v1/auth/me') return jsonResponse(200, { data: authUser, meta: {} });
    if (url === '/api/v1/health') return jsonResponse(200, healthBody());
    if (expireFirstWrite && method !== 'GET' && !writeExpired) {
      writeExpired = true;
      return jsonResponse(401, {
        error: { code: 'UNAUTHENTICATED', message: 'Access token expired' },
      });
    }
    if (url === '/api/v1/users' && method === 'GET')
      return jsonResponse(200, { data: currentUsers, meta: {} });
    if (url === '/api/v1/roles' && method === 'GET')
      return jsonResponse(200, { data: currentRoles, meta: {} });
    if (url === '/api/v1/users' && method === 'POST') {
      const input = JSON.parse(String(options?.body)) as {
        name: string;
        email: string;
        roleIds: string[];
      };
      const assigned = currentRoles.filter((role) => input.roleIds.includes(role.id));
      const created = userRecord({
        id: 'dddddddddddddddddddddddd',
        name: input.name,
        email: input.email,
        roleIds: input.roleIds,
        roles: assigned,
        permissions: [...new Set(assigned.flatMap((role) => role.permissions))],
      });
      currentUsers.push(created);
      return jsonResponse(201, { data: created, meta: {} });
    }
    if (url.startsWith('/api/v1/users/') && method === 'PATCH') {
      const id = url.split('/').at(-1);
      const index = currentUsers.findIndex((item) => item.id === id);
      const input = JSON.parse(String(options?.body)) as Partial<UserRecord>;
      const assigned = input.roleIds
        ? currentRoles.filter((role) => input.roleIds?.includes(role.id))
        : currentUsers[index]!.roles;
      const updated = {
        ...currentUsers[index]!,
        ...input,
        roles: assigned,
        permissions: [...new Set(assigned.flatMap((role) => role.permissions))],
        updatedAt: NOW,
      };
      currentUsers[index] = updated;
      return jsonResponse(200, { data: updated, meta: {} });
    }
    if (url === '/api/v1/roles' && method === 'POST') {
      const input = JSON.parse(String(options?.body)) as {
        name: string;
        description?: string;
        permissions: string[];
      };
      const created: RoleRecord = {
        id: 'eeeeeeeeeeeeeeeeeeeeeeee',
        name: input.name,
        description: input.description ?? null,
        permissions: input.permissions,
        isSystem: false,
      };
      currentRoles.push(created);
      return jsonResponse(201, { data: created, meta: {} });
    }
    if (url.startsWith('/api/v1/roles/') && method === 'PATCH') {
      const id = url.split('/').at(-1);
      const index = currentRoles.findIndex((role) => role.id === id);
      const input = JSON.parse(String(options?.body)) as Partial<RoleRecord>;
      const updated = { ...currentRoles[index]!, ...input };
      currentRoles[index] = updated;
      return jsonResponse(200, { data: updated, meta: {} });
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Unexpected test request' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('users and roles administration', () => {
  it('creates a user with selected roles and edits name, status and assignment', async () => {
    const fetchMock = mockAdminApi({ users: [userRecord()] });
    renderRoute('/settings/users');
    await screen.findByRole('heading', { level: 1, name: 'Users' });
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }));
    const createForm = screen.getByRole('form', { name: 'Create user form' });
    fireEvent.change(within(createForm).getByLabelText('Full name'), {
      target: { value: 'Njeri Kamau' },
    });
    fireEvent.change(within(createForm).getByLabelText('Email address'), {
      target: { value: 'njeri@example.com' },
    });
    fireEvent.change(within(createForm).getByLabelText('Temporary password'), {
      target: { value: 'temporary-password-2026' },
    });
    await userEvent.click(within(createForm).getByRole('checkbox', { name: /Storekeeper/ }));
    await userEvent.click(within(createForm).getByRole('button', { name: 'Create user' }));

    expect(await screen.findByRole('status', { name: '' })).toHaveTextContent(
      'Njeri Kamau was created.',
    );
    const createCall = fetchMock.mock.calls.find(
      ([url, options]) => url === '/api/v1/users' && options?.method === 'POST',
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      email: 'njeri@example.com',
      roleIds: [STOREKEEPER_ID],
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Edit Njeri Kamau' }));
    const editForm = screen.getByRole('form', { name: 'Edit user form' });
    fireEvent.change(within(editForm).getByLabelText('Full name'), {
      target: { value: 'Njeri M. Kamau' },
    });
    fireEvent.change(within(editForm).getByLabelText('Account status'), {
      target: { value: 'inactive' },
    });
    await userEvent.click(within(editForm).getByRole('checkbox', { name: /Admin/ }));
    await userEvent.click(within(editForm).getByRole('checkbox', { name: /Storekeeper/ }));
    await userEvent.click(within(editForm).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Njeri M. Kamau')).toBeInTheDocument();
    const updateCall = fetchMock.mock.calls.find(
      ([url, options]) => url.endsWith('/dddddddddddddddddddddddd') && options?.method === 'PATCH',
    );
    expect(JSON.parse(String(updateCall?.[1]?.body))).toEqual({
      name: 'Njeri M. Kamau',
      isActive: false,
      roleIds: [ADMIN_ID],
    });
  }, 15_000);

  it('filters users by search, role and status and paginates locally', async () => {
    const users = Array.from({ length: 12 }, (_, index) =>
      userRecord({
        id: String(index + 1).padStart(24, '0'),
        name: `Person ${String(index + 1).padStart(2, '0')}`,
        email: `person${index + 1}@example.com`,
        isActive: index % 2 === 0,
      }),
    );
    mockAdminApi({ users });
    renderRoute('/settings/users');
    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'Person 03' } });
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
    expect(screen.getByText('Person 03')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'inactive' } });
    expect(screen.getByText('No users match your filters.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'active' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: ADMIN_ID } });
    expect(screen.getByText('No users match your filters.')).toBeInTheDocument();
  });

  it('creates and edits a custom role with grouped permission selection', async () => {
    const fetchMock = mockAdminApi();
    renderRoute('/settings/roles');
    await screen.findByRole('heading', { level: 1, name: 'Roles' });
    await userEvent.click(screen.getByRole('button', { name: 'Create role' }));
    const createForm = screen.getByRole('form', { name: 'Create role form' });
    fireEvent.change(within(createForm).getByLabelText('Role name'), {
      target: { value: 'Warehouse Reader' },
    });
    await userEvent.click(
      within(createForm).getByRole('checkbox', { name: 'inventory.balances.read' }),
    );
    expect(within(createForm).getByRole('heading', { name: 'Inventory' })).toBeInTheDocument();
    await userEvent.click(within(createForm).getByRole('button', { name: 'Create role' }));
    expect(await screen.findByText('Warehouse Reader')).toBeInTheDocument();
    const createCall = fetchMock.mock.calls.find(
      ([url, options]) => url === '/api/v1/roles' && options?.method === 'POST',
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      name: 'Warehouse Reader',
      permissions: ['inventory.balances.read'],
    });

    await userEvent.click(screen.getByRole('button', { name: 'Edit Warehouse Reader' }));
    const editForm = screen.getByRole('form', { name: 'Edit role form' });
    await userEvent.click(
      within(editForm).getByRole('checkbox', { name: 'inventory.layers.read' }),
    );
    await userEvent.click(within(editForm).getByRole('button', { name: 'Save changes' }));
    const updateCall = fetchMock.mock.calls.find(
      ([url, options]) => url.endsWith('/eeeeeeeeeeeeeeeeeeeeeeee') && options?.method === 'PATCH',
    );
    expect(JSON.parse(String(updateCall?.[1]?.body))).toEqual({
      permissions: ['inventory.balances.read', 'inventory.layers.read'],
    });
  });

  it('keeps system-role name and permissions protected while allowing description edits', async () => {
    const fetchMock = mockAdminApi();
    renderRoute('/settings/roles');
    await screen.findByRole('button', { name: 'Edit Admin' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit Admin' }));
    const form = screen.getByRole('form', { name: 'Edit role form' });
    expect(within(form).getByLabelText('Role name')).toBeDisabled();
    expect(within(form).queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText('Description'), {
      target: { value: 'Platform administrators' },
    });
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    const updateCall = fetchMock.mock.calls.find(
      ([url, options]) => url.endsWith(`/${ADMIN_ID}`) && options?.method === 'PATCH',
    );
    expect(JSON.parse(String(updateCall?.[1]?.body))).toEqual({
      description: 'Platform administrators',
    });
  });

  it('hides write actions from a role reader and denies a user-only route', async () => {
    const reader = testUser(['roles.read'], 'Role reader');
    mockAdminApi({ authUser: reader });
    renderRoute('/settings/roles');
    expect(await screen.findByRole('heading', { level: 1, name: 'Roles' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create role' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit Admin/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('refreshes an expired access token before retrying an administration write', async () => {
    const fetchMock = mockAdminApi({ expireFirstWrite: true });
    renderRoute('/settings/roles');
    await screen.findByRole('heading', { level: 1, name: 'Roles' });
    await userEvent.click(screen.getByRole('button', { name: 'Create role' }));
    const form = screen.getByRole('form', { name: 'Create role form' });
    fireEvent.change(within(form).getByLabelText('Role name'), {
      target: { value: 'Stock Reader' },
    });
    await userEvent.click(within(form).getByRole('checkbox', { name: 'inventory.balances.read' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Create role' }));
    expect(await screen.findByText('Stock Reader')).toBeInTheDocument();
    const writes = fetchMock.mock.calls.filter(
      ([url, options]) => url === '/api/v1/roles' && options?.method === 'POST',
    );
    expect(writes).toHaveLength(2);
    expect((writes[1]?.[1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-2',
    );
  });
});
