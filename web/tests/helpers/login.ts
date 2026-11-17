import { getAuth } from '../../src/core/auth';
export async function testLogin(label: string) {
  const response = await getAuth().api.signUpEmail({
    body: { name: label, email: `${label}-${crypto.randomUUID()}@example.test`, password: 'Isolated-qa-password-123!' },
    asResponse: true,
  });
  if (!response.ok) throw new Error(`QA signup failed: ${response.status}`);
  const payload = await response.json();
  return { userId: payload.user.id as string, cookie: response.headers.getSetCookie().map((value: string) => value.split(';')[0]).join('; ') };
}
