import { LoginScreen } from '@/features/auth';
import { useRootStore } from '@/root';

// /auth: the whole login (phone → code → name). Its steps come from LoginFlowStore, not from routes.
export default function AuthRoute() {
  const { login } = useRootStore();
  return <LoginScreen login={login} />;
}
