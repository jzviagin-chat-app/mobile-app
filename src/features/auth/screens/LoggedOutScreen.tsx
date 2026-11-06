import { useTranslation } from 'react-i18next';

import { Screen, Text } from '@/ui';

/** First screen when nobody is logged in. Step 2 replaces the subtitle with the phone-number form. */
export function LoggedOutScreen() {
  const { t } = useTranslation();
  return (
    <Screen centered>
      <Text variant="title" accessibilityRole="header">
        {t('auth.loggedOut.title')}
      </Text>
      <Text muted>{t('auth.loggedOut.subtitle')}</Text>
    </Screen>
  );
}
