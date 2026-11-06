import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { CreateUserInput, UpdateUserInput } from '@ims/shared';
import { Card, PageHeader } from '../../../components/Card';
import { StatusBadge } from '../../../components/StatusBadge';
import { useAuth } from '../../auth/auth-context';
import { canAccess } from '../../auth/permissions';
import { getRoles } from '../../roles/api/roles';
import { createUser, getUsers, updateUser, type UserRecord } from '../api/users';
import { UserForm } from '../components/UserForm';

const PAGE_SIZE = 10;
const USERS_QUERY_KEY = ['admin', 'users'] as const;
const ROLES_QUERY_KEY = ['admin', 'roles'] as const;

function formatDate(value: string | null): string {
  return value
    ? new Date(value).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Never';
}

export function UsersPage() {
  const { user, authorizedRequest, reloadUser } = useAuth();
  const queryClient = useQueryClient();
  const canCreate = Boolean(user && canAccess(user, 'users.create'));
  const canUpdate = Boolean(user && canAccess(user, 'users.update'));
  const canReadRoles = Boolean(user && canAccess(user, 'roles.read'));
  const usersQuery = useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: ({ signal }) => getUsers(authorizedRequest, signal),
    retry: false,
  });
  const rolesQuery = useQuery({
    queryKey: ROLES_QUERY_KEY,
    queryFn: ({ signal }) => getRoles(authorizedRequest, signal),
    enabled: canReadRoles,
    retry: false,
  });
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRecord | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const roleOptions = useMemo(() => {
    if (rolesQuery.data) return rolesQuery.data;
    const roles = new Map(
      (usersQuery.data ?? []).flatMap((item) => item.roles.map((role) => [role.id, role] as const)),
    );
    return [...roles.values()];
  }, [rolesQuery.data, usersQuery.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (usersQuery.data ?? []).filter(
      (item) =>
        (!term || `${item.name} ${item.email}`.toLowerCase().includes(term)) &&
        (roleFilter === 'all' || item.roleIds.includes(roleFilter)) &&
        (statusFilter === 'all' || (statusFilter === 'active') === item.isActive),
    );
  }, [usersQuery.data, search, roleFilter, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleUsers = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  async function saveCreated(input: CreateUserInput) {
    const created = await createUser(authorizedRequest, input);
    await queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
    setCreating(false);
    setSuccess(`${created.name} was created.`);
  }

  async function saveEdited(input: UpdateUserInput) {
    if (!editing) return;
    const updated = await updateUser(authorizedRequest, editing.id, input);
    await queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
    if (updated.id === user?.id) await reloadUser().catch(() => undefined);
    setEditing(null);
    setSuccess(`${updated.name} was updated.`);
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader title="Users" description="Manage accounts, roles and sign-in access." />
        <div className="mb-5 flex gap-2">
          {canReadRoles && (
            <Link
              to="/settings/roles"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              View roles
            </Link>
          )}
          {canCreate && canReadRoles && (
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setEditing(null);
                setSuccess(null);
              }}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              Create user
            </button>
          )}
        </div>
      </div>

      {success && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
        >
          {success}
        </p>
      )}

      {creating && (
        <div className="mb-5">
          {rolesQuery.isPending ? (
            <Card>
              <p role="status" className="text-sm text-slate-600">
                Loading roles…
              </p>
            </Card>
          ) : rolesQuery.isError ? (
            <Card>
              <p role="alert" className="text-sm text-red-700">
                Could not load roles.{' '}
                <button
                  type="button"
                  onClick={() => void rolesQuery.refetch()}
                  className="font-medium underline"
                >
                  Retry
                </button>
              </p>
            </Card>
          ) : (
            <UserForm
              key="new"
              mode="create"
              roles={rolesQuery.data ?? []}
              canAssignRoles
              onSave={saveCreated}
              onCancel={() => setCreating(false)}
            />
          )}
        </div>
      )}
      {editing && (
        <div className="mb-5">
          <UserForm
            key={editing.id}
            mode="edit"
            record={editing}
            roles={roleOptions}
            canAssignRoles={canReadRoles && !rolesQuery.isError && !rolesQuery.isPending}
            onSave={saveEdited}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div>
            <label
              htmlFor="users-search"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Search users
            </label>
            <input
              id="users-search"
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Name or email"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <label
              htmlFor="users-role"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Role
            </label>
            <select
              id="users-role"
              value={roleFilter}
              onChange={(event) => {
                setRoleFilter(event.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="all">All roles</option>
              {roleOptions.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="users-status"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Status
            </label>
            <select
              id="users-status"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        {usersQuery.isPending ? (
          <p role="status" className="py-10 text-center text-sm text-slate-500">
            Loading users…
          </p>
        ) : usersQuery.isError ? (
          <div role="alert" className="py-10 text-center text-sm text-red-700">
            Could not load users.{' '}
            <button
              type="button"
              onClick={() => void usersQuery.refetch()}
              className="font-medium underline"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            {usersQuery.data.length === 0
              ? 'No users have been created yet.'
              : 'No users match your filters.'}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-[800px] w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th scope="col" className="pb-3 pr-4">
                      User
                    </th>
                    <th scope="col" className="pb-3 pr-4">
                      Roles
                    </th>
                    <th scope="col" className="pb-3 pr-4">
                      Status
                    </th>
                    <th scope="col" className="pb-3 pr-4">
                      Last sign-in
                    </th>
                    <th scope="col" className="pb-3 text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.map((item) => (
                    <tr key={item.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-3 pr-4">
                        <span className="block font-medium text-slate-900">{item.name}</span>
                        <span className="text-xs text-slate-500">{item.email}</span>
                      </td>
                      <td className="py-3 pr-4 text-slate-700">
                        {item.roles.map((role) => role.name).join(', ') || 'No role'}
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge tone={item.isActive ? 'success' : 'neutral'}>
                          {item.isActive ? 'Active' : 'Inactive'}
                        </StatusBadge>
                      </td>
                      <td className="py-3 pr-4 text-slate-600">{formatDate(item.lastLoginAt)}</td>
                      <td className="py-3 text-right">
                        {canUpdate && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(item);
                              setCreating(false);
                              setSuccess(null);
                            }}
                            className="font-medium text-blue-700 hover:underline"
                            aria-label={`Edit ${item.name}`}
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm text-slate-600">
              <p>
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
                >
                  Previous
                </button>
                <span>
                  Page {currentPage} of {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage === pageCount}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
