// Route files stay thin: the screen lives in its feature. Expo Router evaluates a route file only when
// the screen is first shown (React Navigation's getComponent), so its imports load lazily too.
export { LoggedOutScreen as default } from '@/features/auth';
