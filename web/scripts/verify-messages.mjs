// Guard against a successful build with an unavailable Inlang message plugin.
import { m } from '../src/paraglide/messages.js';

for (const key of [
  'tubitle.hero.title',
  'tubitle.library.title',
  'tubitle.library.page',
  'common.sign.sign_in_title',
]) {
  if (typeof m[key] !== 'function')
    throw new Error(`Missing compiled message: ${key}`);
  for (const locale of ['en', 'zh']) {
    const value = m[key]({ page: 2 }, { locale });
    if (typeof value !== 'string' || !value.trim())
      throw new Error(`Empty ${locale} message: ${key}`);
  }
}
console.log(
  'Verified compiled product and authentication messages in en and zh.'
);
