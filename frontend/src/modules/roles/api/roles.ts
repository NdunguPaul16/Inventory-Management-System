import {
  apiSuccessSchema,
  roleSchema,
  z,
  type CreateRoleInput,
  type UpdateRoleInput,
} from '@ims/shared';
import type { AuthContextValue } from '../../auth/auth-context';

type AuthorizedRequest = AuthContextValue['authorizedRequest'];
export type RoleRecord = z.infer<typeof roleSchema>;

const roleResponseSchema = apiSuccessSchema(roleSchema);
const rolesResponseSchema = apiSuccessSchema(z.array(roleSchema));

export async function getRoles(request: AuthorizedRequest, signal?: AbortSignal) {
  return (await request('/roles', rolesResponseSchema, { signal })).data;
}

export async function createRole(request: AuthorizedRequest, input: CreateRoleInput) {
  return (await request('/roles', roleResponseSchema, { method: 'POST', body: input })).data;
}

export async function updateRole(request: AuthorizedRequest, id: string, input: UpdateRoleInput) {
  return (
    await request(`/roles/${encodeURIComponent(id)}`, roleResponseSchema, {
      method: 'PATCH',
      body: input,
    })
  ).data;
}
