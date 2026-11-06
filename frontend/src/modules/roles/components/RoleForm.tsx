import {
  createRoleSchema,
  permissionSchema,
  updateRoleSchema,
  type CreateRoleInput,
  type UpdateRoleInput,
} from '@ims/shared';
import { useState, type FormEvent } from 'react';
import { Card } from '../../../components/Card';
import { ApiRequestError } from '../../../lib/api';
import type { RoleRecord } from '../api/roles';
import { groupPermissions, permissionChoices } from '../permissions';

type RoleFormProps = {
  roles: RoleRecord[];
  onCancel: () => void;
} & (
  | { mode: 'create'; onSave: (input: CreateRoleInput) => Promise<void> }
  | { mode: 'edit'; record: RoleRecord; onSave: (input: UpdateRoleInput) => Promise<void> }
);

export function RoleForm(props: RoleFormProps) {
  const record = props.mode === 'edit' ? props.record : null;
  const locked = Boolean(record?.isSystem);
  const [name, setName] = useState(record?.name ?? '');
  const [description, setDescription] = useState(record?.description ?? '');
  const [selected, setSelected] = useState<string[]>(record?.permissions ?? []);
  const [custom, setCustom] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    description?: string;
    permissions?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choices = permissionChoices(props.roles, selected);

  function togglePermission(permission: string) {
    setSelected((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission],
    );
    setFieldErrors((current) => ({ ...current, permissions: undefined }));
  }

  function addCustom() {
    const permission = custom.trim();
    if (!permissionSchema.safeParse(permission).success) {
      setFieldErrors((current) => ({
        ...current,
        permissions: 'Enter a valid permission, such as inventory.balances.read.',
      }));
      return;
    }
    setSelected((current) => [...new Set([...current, permission])]);
    setCustom('');
    setFieldErrors((current) => ({ ...current, permissions: undefined }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    setFieldErrors({});
    if (props.mode === 'create') {
      const parsed = createRoleSchema.safeParse({
        name: name.trim(),
        description: description.trim() || undefined,
        permissions: selected,
      });
      if (!parsed.success) {
        setFieldErrors({
          name: parsed.error.issues.some((issue) => issue.path[0] === 'name')
            ? 'Enter a role name with at least 2 characters.'
            : undefined,
          description: parsed.error.issues.some((issue) => issue.path[0] === 'description')
            ? 'Keep the description under 500 characters.'
            : undefined,
          permissions: parsed.error.issues.some((issue) => issue.path[0] === 'permissions')
            ? 'Select at least one valid permission.'
            : undefined,
        });
        return;
      }
      setBusy(true);
      try {
        await props.onSave(parsed.data);
      } catch (error) {
        setFormError(
          error instanceof ApiRequestError && error.status === 409
            ? 'A role with this name already exists.'
            : error instanceof Error
              ? error.message
              : 'Could not create the role.',
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    const changes: UpdateRoleInput = {};
    if (!locked && name.trim() !== props.record.name) changes.name = name.trim();
    if ((description.trim() || null) !== props.record.description)
      changes.description = description.trim() || null;
    if (
      !locked &&
      [...selected].sort().join('\0') !== [...props.record.permissions].sort().join('\0')
    )
      changes.permissions = selected;
    const parsed = updateRoleSchema.safeParse(changes);
    if (!parsed.success) {
      if (Object.keys(changes).length === 0) setFormError('Make a change before saving.');
      else
        setFieldErrors({
          name: parsed.error.issues.some((issue) => issue.path[0] === 'name')
            ? 'Enter a valid role name.'
            : undefined,
          description: parsed.error.issues.some((issue) => issue.path[0] === 'description')
            ? 'Keep the description under 500 characters.'
            : undefined,
          permissions: parsed.error.issues.some((issue) => issue.path[0] === 'permissions')
            ? 'Select at least one valid permission.'
            : undefined,
        });
      return;
    }
    setBusy(true);
    try {
      await props.onSave(parsed.data);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not update the role.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={record ? `Edit ${record.name}` : 'Create role'}>
      <form
        aria-label={record ? 'Edit role form' : 'Create role form'}
        onSubmit={onSubmit}
        noValidate
        className="space-y-5"
      >
        {formError && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {formError}
          </p>
        )}
        {locked && (
          <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
            System role names and permissions are protected. You can edit the description only.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="role-name" className="mb-1 block text-sm font-medium text-slate-700">
              Role name
            </label>
            <input
              id="role-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy || locked}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:ring-2 focus:ring-blue-200 disabled:bg-slate-50"
            />
            {fieldErrors.name && <p className="mt-1 text-xs text-red-700">{fieldErrors.name}</p>}
          </div>
          <div>
            <label
              htmlFor="role-description"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Description
            </label>
            <input
              id="role-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:ring-2 focus:ring-blue-200"
            />
            {fieldErrors.description && (
              <p className="mt-1 text-xs text-red-700">{fieldErrors.description}</p>
            )}
          </div>
        </div>

        {locked ? (
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Permissions</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {groupPermissions(record?.permissions ?? []).map((group) => (
                <div key={group.name} className="rounded-lg border border-slate-200 p-3">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {group.name}
                  </h3>
                  <p className="text-xs leading-6 text-slate-700">{group.permissions.join(', ')}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Permissions</legend>
            <p className="mb-3 text-xs text-slate-500">
              Select the exact actions this role can perform. The * permission grants full access.
            </p>
            <div className="max-h-80 space-y-3 overflow-y-auto rounded-lg border border-slate-200 p-3">
              {choices.map((group) => (
                <div key={group.name}>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {group.name}
                  </h3>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {group.permissions.map((permission) => (
                      <label
                        key={permission}
                        className="inline-flex items-center gap-2 text-xs text-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={selected.includes(permission)}
                          onChange={() => togglePermission(permission)}
                          disabled={busy}
                          className="accent-blue-700"
                        />
                        <span>{permission}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <label htmlFor="custom-permission" className="sr-only">
                Custom permission
              </label>
              <input
                id="custom-permission"
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                placeholder="Add a permission string"
                className="min-w-56 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={addCustom}
                disabled={busy}
                className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
              >
                Add permission
              </button>
            </div>
            {fieldErrors.permissions && (
              <p className="mt-1 text-xs text-red-700">{fieldErrors.permissions}</p>
            )}
          </fieldset>
        )}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={props.onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
          >
            {busy ? 'Saving…' : record ? 'Save changes' : 'Create role'}
          </button>
        </div>
      </form>
    </Card>
  );
}
