import { RootStore } from './root-store';

describe('RootStore', () => {
  it('starts loading, then restore() ends signed out (no login yet)', async () => {
    const root = new RootStore({ locales: [{ languageCode: 'en' }] });
    expect(root.session.status).toBe('loading');
    await root.session.restore();
    expect(root.session.status).toBe('signedOut');
    expect(root.session.isSignedIn).toBe(false);
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
    expect(a.session).not.toBe(b.session);
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
