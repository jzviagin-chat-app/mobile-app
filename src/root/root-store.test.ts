import { RootStore } from './root-store';

describe('RootStore', () => {
  it('starts loading, then restore() ends signed out (no login yet)', async () => {
    const root = new RootStore({ locales: [{ languageCode: 'en' }] });
    expect(root.auth.status).toBe('loading');
    await root.auth.restore();
    expect(root.auth.status).toBe('signedOut');
    expect(root.auth.isSignedIn).toBe(false);
    root.dispose();
  });

  it('picks the app language from the phone', () => {
    const he = new RootStore({ locales: [{ languageCode: 'he' }] });
    const ru = new RootStore({ locales: [{ languageCode: 'ru' }] });
    expect(he.i18n.language).toBe('he');
    expect(ru.i18n.language).toBe('en');
    he.dispose();
    ru.dispose();
  });

  it('builds independent instances (no shared singletons between tests)', () => {
    const a = new RootStore({ locales: [] });
    const b = new RootStore({ locales: [] });
    expect(a.auth).not.toBe(b.auth);
    expect(a.queryClient).not.toBe(b.queryClient);
    a.dispose();
    b.dispose();
  });

  it('dispose() clears the server-data cache', () => {
    const root = new RootStore({ locales: [] });
    root.queryClient.setQueryData(['example'], { ok: true });
    root.dispose();
    expect(root.queryClient.getQueryData(['example'])).toBeUndefined();
  });
});
