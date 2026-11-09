// Public surface of the auth feature: other code imports only from '@/features/auth'.
export { AuthStore, type AuthStatus } from './auth-store';
export { LoginFlowStore, type LoginNotice, type LoginStep } from './login-flow-store';
export {
  createLoginProgressStorage,
  type LoginProgress,
  type LoginProgressStorage,
} from './login-progress';
export type { LoginError, LoginErrorCode, LoginResult } from './errors';
export { LoginScreen } from './screens/LoginScreen';
