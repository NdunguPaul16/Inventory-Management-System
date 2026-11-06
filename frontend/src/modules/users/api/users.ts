import {
  apiSuccessSchema,
  userSchema,
  z,
  type CreateUserInput,
  type UpdateUserInput,
} from '@ims/shared';
import type { AuthContextValue } from '../../auth/auth-context';

type AuthorizedRequest = AuthContextValue['authorizedRequest'];
export type UserRecord = z.infer<typeof userSchema>;

const userResponseSchema = apiSuccessSchema(userSchema);
const usersResponseSchema = apiSuccessSchema(z.array(userSchema));

export async function getUsers(request: AuthorizedRequest, signal?: AbortSignal) {
  return (await request('/users', usersResponseSchema, { signal })).data;
}

export async function createUser(request: AuthorizedRequest, input: CreateUserInput) {
  return (await request('/users', userResponseSchema, { method: 'POST', body: input })).data;
}

export async function updateUser(request: AuthorizedRequest, id: string, input: UpdateUserInput) {
  return (
    await request(`/users/${encodeURIComponent(id)}`, userResponseSchema, {
      method: 'PATCH',
      body: input,
    })
  ).data;
}
