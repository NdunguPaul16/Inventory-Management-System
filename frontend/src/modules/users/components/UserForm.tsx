import {
  createUserSchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from '@ims/shared';
import { useState, type FormEvent } from 'react';
import { Card } from '../../../components/Card';
import { ApiRequestError } from '../../../lib/api';
import type { RoleRecord } from '../../roles/api/roles';
import type { UserRecord } from '../api/users';

type UserFormProps = {
  roles: RoleRecord[];
  canAssignRoles: boolean;
  onCancel: () => void;
} & (
  | { mode: 'create'; onSave: (input: CreateUserInput) => Promise<void> }
  | { mode: 'edit'; record: UserRecord; onSave: (input: UpdateUserInput) => Promise<void> }
);

type FieldName = 'name' | 'email' | 'password' | 'roleIds';
type FieldErrors = Partial<Record<FieldName, string>>;

function validationErrors(
  issues: readonly { path: PropertyKey[]; message: string }[],
): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (field === 'name') errors.name = 'Enter a name with at least 2 characters.';
    if (field === 'email') errors.email = 'Enter a valid email address.';
    if (field === 'password') errors.password = 'Use a password of at least 12 characters.';
    if (field === 'roleIds') errors.roleIds = 'Select at least one role.';
  }
  return errors;
}

export function UserForm(props: UserFormProps) {
  const record = props.mode === 'edit' ? props.record : null;
  const [name, setName] = useState(record?.name ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>(record?.roleIds ?? []);
  const [isActive, setIsActive] = useState(record?.isActive ?? true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleRole(id: string) {
    setRoleIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
    setErrors((current) => ({ ...current, roleIds: undefined }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setErrors({});
    setFormError(null);

    if (props.mode === 'create') {
      const parsed = createUserSchema.safeParse({
        name: name.trim(),
        email: email.trim(),
        password,
        roleIds,
      });
      if (!parsed.success) {
        setErrors(validationErrors(parsed.error.issues));
        return;
      }
      setBusy(true);
      try {
        await props.onSave(parsed.data);
      } catch (error) {
        setFormError(
          error instanceof ApiRequestError && error.status === 409
            ? 'An account with this email already exists.'
            : error instanceof Error
              ? error.message
              : 'Could not create this user.',
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    const changes: UpdateUserInput = {};
    if (name.trim() !== props.record.name) changes.name = name.trim();
    if (password) changes.password = password;
    if (isActive !== props.record.isActive) changes.isActive = isActive;
    if (
      props.canAssignRoles &&
      [...roleIds].sort().join('\0') !== [...props.record.roleIds].sort().join('\0')
    ) {
      changes.roleIds = roleIds;
    }
    const parsed = updateUserSchema.safeParse(changes);
    if (!parsed.success) {
      if (Object.keys(changes).length === 0) setFormError('Make a change before saving.');
      else setErrors(validationErrors(parsed.error.issues));
      return;
    }
    setBusy(true);
    try {
      await props.onSave(parsed.data);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not update this user.');
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-200 disabled:opacity-60';
  return (
    <Card title={record ? `Edit ${record.name}` : 'Create user'}>
      <form
        aria-label={record ? 'Edit user form' : 'Create user form'}
        onSubmit={onSubmit}
        noValidate
        className="space-y-5"
      >
        {formError && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {formError}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="user-name" className="mb-1 block text-sm font-medium text-slate-700">
              Full name
            </label>
            <input
              id="user-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              className={inputClass}
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name && <p className="mt-1 text-xs text-red-700">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="user-email" className="mb-1 block text-sm font-medium text-slate-700">
              Email address
            </label>
            <input
              id="user-email"
              type="email"
              autoComplete="off"
              value={record?.email ?? email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy || Boolean(record)}
              className={inputClass}
              aria-invalid={Boolean(errors.email)}
            />
            {errors.email && <p className="mt-1 text-xs text-red-700">{errors.email}</p>}
            {record && (
              <p className="mt-1 text-xs text-slate-500">
                Email changes are not supported by the API.
              </p>
            )}
          </div>
          <div>
            <label
              htmlFor="user-password"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              {record ? 'New password (optional)' : 'Temporary password'}
            </label>
            <input
              id="user-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              className={inputClass}
              aria-invalid={Boolean(errors.password)}
            />
            {errors.password ? (
              <p className="mt-1 text-xs text-red-700">{errors.password}</p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                At least 12 characters. Share it through a secure channel.
              </p>
            )}
          </div>
          {record && (
            <div>
              <label
                htmlFor="user-status"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Account status
              </label>
              <select
                id="user-status"
                value={isActive ? 'active' : 'inactive'}
                onChange={(event) => setIsActive(event.target.value === 'active')}
                disabled={busy}
                className={inputClass}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              {!isActive && (
                <p className="mt-1 text-xs text-amber-700">
                  Inactive users cannot sign in or refresh a session.
                </p>
              )}
            </div>
          )}
        </div>

        {props.canAssignRoles && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Roles</legend>
            {props.roles.length === 0 ? (
              <p className="text-sm text-slate-500">No roles are available.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {props.roles.map((role) => (
                  <label
                    key={role.id}
                    className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm hover:border-blue-300"
                  >
                    <input
                      type="checkbox"
                      checked={roleIds.includes(role.id)}
                      onChange={() => toggleRole(role.id)}
                      disabled={busy}
                      className="mt-0.5 accent-blue-700"
                    />
                    <span>
                      <span className="block font-medium text-slate-800">{role.name}</span>
                      <span className="text-xs text-slate-500">
                        {role.isSystem ? 'System role' : 'Custom role'}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {errors.roleIds && <p className="mt-1 text-xs text-red-700">{errors.roleIds}</p>}
          </fieldset>
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
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
            disabled={busy || (props.mode === 'create' && props.roles.length === 0)}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
          >
            {busy ? 'Saving…' : record ? 'Save changes' : 'Create user'}
          </button>
        </div>
      </form>
    </Card>
  );
}
