import { ConfigError, parseConfig } from './config';

describe('parseConfig', () => {
  it('accepts the production URL and strips a trailing slash', () => {
    expect(parseConfig({ apiUrl: 'https://jzviagin-chat-app.129-159-150-34.sslip.io/' })).toEqual({
      apiUrl: 'https://jzviagin-chat-app.129-159-150-34.sslip.io',
    });
  });

  it('accepts a local http URL for development', () => {
    expect(parseConfig({ apiUrl: 'http://localhost:8000' }).apiUrl).toBe('http://localhost:8000');
  });

  it.each([undefined, '', 'not a url', 'ftp://example.com'])('rejects %p', (apiUrl) => {
    expect(() => parseConfig({ apiUrl })).toThrow(ConfigError);
  });

  it('names the setting but never echoes the value', () => {
    expect(() => parseConfig({ apiUrl: 'secret-looking-value' })).toThrow(/apiUrl/);
    expect(() => parseConfig({ apiUrl: 'secret-looking-value' })).not.toThrow(
      /secret-looking-value/,
    );
  });
});
