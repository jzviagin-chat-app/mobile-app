export {
  createAuthApi,
  type AuthApi,
  type AuthApiOptions,
  type CodeSent,
  type DeviceIn,
  type LoggedIn,
  type RegistrationRequired,
} from './client';
export {
  ApiError,
  NetworkError,
  SignedOutError,
  errorCodes,
  isApiError,
  rateLimits,
  type ErrorCode,
  type ErrorDetails,
  type RateLimit,
} from './errors';
export { createAuthorized, type Authorized, type AuthorizedDeps } from './authorized';
