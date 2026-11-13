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
  errorCodes,
  rateLimits,
  type ErrorCode,
  type ErrorDetails,
  type RateLimit,
} from './errors';
