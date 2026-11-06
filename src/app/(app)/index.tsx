import { useTranslation } from 'react-i18next';

import { Screen, Text } from '@/ui';

// Placeholder for the logged-in home (chats list). Unreachable until login exists (step 2).
export default function HomeRoute() {
  const { t } = useTranslation();
  return (
    <Screen centered>
      <Text variant="title">{t('home.title')}</Text>
    </Screen>
  );
}
