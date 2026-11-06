import { log, mask } from './log';

describe('mask', () => {
  it('masks E.164 phone numbers', () => {
    expect(mask('login for +972501234567')).toBe('login for +97250***4567');
  });

  it('masks national phone numbers with separators', () => {
    expect(mask('number 050-123-4567')).toBe('number 05012***4567');
  });

  it('redacts token-like strings (JWTs, refresh tokens)', () => {
    const jwt = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c2VyLWlkLTEyMyJ9.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
    expect(mask(`token ${jwt}`)).toBe('token [redacted]');
    expect(mask('refresh Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0')).toBe('refresh [redacted]');
  });

  it('leaves ordinary text and short numbers alone', () => {
    expect(mask('retry in 60 seconds, attempt 3')).toBe('retry in 60 seconds, attempt 3');
  });
});

describe('log', () => {
  it('masks message and string fields before writing', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    log.warn('otp failed for +972501234567', { phone: '+972501234567', attempts: 2 });
    expect(spy).toHaveBeenCalledWith('otp failed for +97250***4567', {
      phone: '+97250***4567',
      attempts: 2,
    });
  });
});
