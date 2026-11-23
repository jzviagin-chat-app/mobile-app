import { ApiError, createAuthorized, NetworkError } from '.';

function setup() {
  const deps = {
    getAccessToken: jest.fn(async () => 'access-1'),
    renewAfterRejection: jest.fn(async (_rejected: string) => 'access-2'),
    onBlocked: jest.fn(),
  };
  return { deps, authorized: createAuthorized(deps) };
}

const invalidToken = new ApiError(401, 'invalid_token');

describe('createAuthorized', () => {
  it('runs the call with the fresh access token', async () => {
    const { deps, authorized } = setup();
    const call = jest.fn(async (token: string) => `ok with ${token}`);
    await expect(authorized(call)).resolves.toBe('ok with access-1');
    expect(call).toHaveBeenCalledTimes(1);
    expect(deps.renewAfterRejection).not.toHaveBeenCalled();
  });

  it('on 401 invalid_token renews the rejected token and retries once', async () => {
    const { deps, authorized } = setup();
    const call = jest.fn().mockRejectedValueOnce(invalidToken).mockResolvedValueOnce('ok');
    await expect(authorized(call)).resolves.toBe('ok');
    expect(deps.renewAfterRejection).toHaveBeenCalledWith('access-1');
    expect(call.mock.calls).toEqual([['access-1'], ['access-2']]);
  });

  it('a second 401 fails the call: no loop', async () => {
    const { deps, authorized } = setup();
    const call = jest.fn().mockRejectedValue(invalidToken);
    await expect(authorized(call)).rejects.toBe(invalidToken);
    expect(call).toHaveBeenCalledTimes(2);
    expect(deps.renewAfterRejection).toHaveBeenCalledTimes(1);
  });

  it('a failed renewal (offline, signed out) fails the call without retrying', async () => {
    const { deps, authorized } = setup();
    const offline = new NetworkError('offline');
    deps.renewAfterRejection.mockRejectedValueOnce(offline);
    const call = jest.fn().mockRejectedValueOnce(invalidToken);
    await expect(authorized(call)).rejects.toBe(offline);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('no token (signed out, refresh failed) sends nothing', async () => {
    const { deps, authorized } = setup();
    const offline = new NetworkError('offline');
    deps.getAccessToken.mockRejectedValueOnce(offline);
    const call = jest.fn();
    await expect(authorized(call)).rejects.toBe(offline);
    expect(call).not.toHaveBeenCalled();
  });

  it('403 account_blocked ends the session (also on the retry) and fails the call', async () => {
    const { deps, authorized } = setup();
    const blocked = new ApiError(403, 'account_blocked');
    await expect(authorized(jest.fn().mockRejectedValue(blocked))).rejects.toBe(blocked);
    await expect(
      authorized(jest.fn().mockRejectedValueOnce(invalidToken).mockRejectedValueOnce(blocked)),
    ).rejects.toBe(blocked);
    expect(deps.onBlocked).toHaveBeenCalledTimes(2);
  });

  it('other errors pass through untouched', async () => {
    const { deps, authorized } = setup();
    const forbidden = new ApiError(403, 'action_not_allowed');
    await expect(authorized(jest.fn().mockRejectedValue(forbidden))).rejects.toBe(forbidden);
    expect(deps.onBlocked).not.toHaveBeenCalled();
    expect(deps.renewAfterRejection).not.toHaveBeenCalled();
  });
});
