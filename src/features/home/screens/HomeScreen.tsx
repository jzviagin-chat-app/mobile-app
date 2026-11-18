import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';

import type { AuthStore } from '@/features/auth';
import { Button, Screen, Text } from '@/ui';

/** Placeholder for the logged-in home (the chats list comes in phase 9). For now: sign out. */
export const HomeScreen = observer(function HomeScreen({ auth }: { auth: AuthStore }) {
  const { t } = useTranslation();
  return (
    <Screen centered>
      <Text variant="title" accessibilityRole="header">
        {t('home.title')}
      </Text>
      <Text muted>{t('home.signedIn')}</Text>
      <Button
        testID="sign-out"
        variant="secondary"
        title={t('home.signOut')}
        onPress={() => void auth.signOut()}
      />
    </Screen>
  );
});
