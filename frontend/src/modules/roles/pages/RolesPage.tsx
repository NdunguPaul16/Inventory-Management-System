import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import type { CreateRoleInput, UpdateRoleInput } from '@ims/shared';
import { Card, PageHeader } from '../../../components/Card';
import { StatusBadge } from '../../../components/StatusBadge';
import { useAuth } from '../../auth/auth-context';
import { canAccess } from '../../auth/permissions';
import { createRole, getRoles, updateRole, type RoleRecord } from '../api/roles';
import { RoleForm } from '../components/RoleForm';
import { groupPermissions } from '../permissions';

const ROLES_QUERY_KEY = ['admin', 'roles'] as const;

export function RolesPage() {
  const { user, authorizedRequest, reloadUser } = useAuth();
  const queryClient = useQueryClient();
  const canCreate = Boolean(user && canAccess(user, 'roles.create'));
  const canUpdate = Boolean(user && canAccess(user, 'roles.update'));
  const canReadUsers = Boolean(user && canAccess(user, 'users.read'));
  const rolesQuery = useQuery({
    queryKey: ROLES_QUERY_KEY,
    queryFn: ({ signal }) => getRoles(authorizedRequest, signal),
    retry: false,
  });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RoleRecord | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function saveCreated(input: CreateRoleInput) {
    const created = await createRole(authorizedRequest, input);
    await queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    setCreating(false);
    setSuccess(`${created.name} was created.`);
  }

  async function saveEdited(input: UpdateRoleInput) {
    if (!editing) return;
    const updated = await updateRole(authorizedRequest, editing.id, input);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
    ]);
    await reloadUser().catch(() => undefined);
    setEditing(null);
    setSuccess(`${updated.name} was updated.`);
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader title="Roles" description="Review system roles and manage custom access." />
        <div className="mb-5 flex gap-2">
          {canReadUsers && (
            <Link
              to="/settings/users"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              View users
            </Link>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setEditing(null);
                setSuccess(null);
              }}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              Create role
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
          <RoleForm
            key="new"
            mode="create"
            roles={rolesQuery.data ?? []}
            onSave={saveCreated}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}
      {editing && (
        <div className="mb-5">
          <RoleForm
            key={editing.id}
            mode="edit"
            record={editing}
            roles={rolesQuery.data ?? []}
            onSave={saveEdited}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {rolesQuery.isPending ? (
        <Card>
          <p role="status" className="py-10 text-center text-sm text-slate-500">
            Loading roles…
          </p>
        </Card>
      ) : rolesQuery.isError ? (
        <Card>
          <div role="alert" className="py-10 text-center text-sm text-red-700">
            Could not load roles.{' '}
            <button
              type="button"
              onClick={() => void rolesQuery.refetch()}
              className="font-medium underline"
            >
              Retry
            </button>
          </div>
        </Card>
      ) : rolesQuery.data.length === 0 ? (
        <Card>
          <p className="py-10 text-center text-sm text-slate-500">No roles are available.</p>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {rolesQuery.data.map((role) => (
            <Card
              key={role.id}
              title={
                <span className="flex items-center gap-2">
                  <span>{role.name}</span>
                  <StatusBadge tone={role.isSystem ? 'neutral' : 'success'}>
                    {role.isSystem ? 'System' : 'Custom'}
                  </StatusBadge>
                </span>
              }
              actions={
                canUpdate && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(role);
                      setCreating(false);
                      setSuccess(null);
                    }}
                    className="text-sm font-medium text-blue-700 hover:underline"
                    aria-label={`Edit ${role.name}`}
                  >
                    Edit
                  </button>
                )
              }
            >
              <p className="mb-3 min-h-10 text-sm text-slate-600">
                {role.description || 'No description provided.'}
              </p>
              <div className="space-y-2">
                {groupPermissions(role.permissions).map((group) => (
                  <div key={group.name}>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {group.name}
                    </h3>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {group.permissions.map((permission) => (
                        <span
                          key={permission}
                          className="rounded-md bg-blue-50 px-2 py-1 font-mono text-xs text-blue-900"
                        >
                          {permission}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
