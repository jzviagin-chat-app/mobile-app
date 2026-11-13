import { HomeScreen } from '@/features/home';
import { useRootStore } from '@/root';

// Route files stay thin: they pick the stores a screen needs and render it.
export default function HomeRoute() {
  const { auth } = useRootStore();
  return <HomeScreen auth={auth} />;
}
