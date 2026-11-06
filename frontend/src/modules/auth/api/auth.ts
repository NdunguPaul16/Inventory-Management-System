import {
  apiSuccessSchema,
  authUserResponseSchema,
  authUserSchema,
  z,
  type LoginInput,
} from '@ims/shared';
import { apiNoContent, apiRequest } from '../../../lib/api';

const sessionResponseSchema = apiSuccessSchema(
  z.object({ user: authUserSchema, accessToken: z.string().min(1) }),
);

export function login(input: LoginInput) {
  return apiRequest('/auth/login', sessionResponseSchema, { method: 'POST', body: input });
}

export function refresh() {
  return apiRequest('/auth/refresh', sessionResponseSchema, { method: 'POST' });
}

export async function currentUser(accessToken: string) {
  const response = await apiRequest('/auth/me', authUserResponseSchema, { accessToken });
  return response.data;
}

export function logout() {
  return apiNoContent('/auth/logout');
}
