import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Language } from '@/lib/i18n';
import { Button, Text, TextField, useTheme } from '@/ui';

import { listCountries, searchCountries, type Country } from '../countries';
import type { CountryCode } from '../phone';

type Props = {
  visible: boolean;
  selected: CountryCode;
  onSelect: (code: CountryCode) => void;
  onClose: () => void;
};

/** A searchable list of every country; only the selectable ones can be picked (the rest are greyed). */
export function CountryPicker({ visible, selected, onSelect, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const all = useMemo(() => listCountries(i18n.language as Language), [i18n.language]);
  const shown = useMemo(() => searchCountries(all, query), [all, query]);

  function close() {
    setQuery('');
    onClose();
  }

  function renderItem({ item }: { item: Country }) {
    const isSelected = item.code === selected;
    return (
      <Pressable
        testID={`country-${item.code}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: !item.selectable, selected: isSelected }}
        disabled={!item.selectable}
        onPress={() => {
          onSelect(item.code);
          close();
        }}
        style={({ pressed }) => [
          styles.item,
          {
            paddingVertical: theme.spacing.sm + 4,
            gap: theme.spacing.md,
            opacity: item.selectable ? (pressed ? 0.6 : 1) : 0.4,
          },
        ]}
      >
        <Text>{item.flag}</Text>
        <View style={styles.name}>
          <Text style={isSelected ? styles.bold : undefined}>{item.name}</Text>
          {!item.selectable ? (
            <Text variant="caption" muted>
              {t('auth.country.notAvailable')}
            </Text>
          ) : null}
        </View>
        <Text muted style={styles.code}>{`+${item.callingCode}`}</Text>
      </Pressable>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView
        style={[
          styles.fill,
          { backgroundColor: theme.colors.background, padding: theme.spacing.lg },
        ]}
      >
        <View style={[styles.header, { marginBottom: theme.spacing.md }]}>
          <Text variant="title" accessibilityRole="header">
            {t('auth.country.title')}
          </Text>
          <Button title={t('auth.country.close')} variant="secondary" onPress={close} />
        </View>
        <TextField
          label={t('auth.country.search')}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          testID="country-search"
        />
        <FlatList
          data={shown}
          keyExtractor={(item) => item.code}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          ListEmptyComponent={
            <Text muted style={{ marginTop: theme.spacing.md }}>
              {t('auth.country.noResults')}
            </Text>
          }
          style={{ marginTop: theme.spacing.sm }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  item: { flexDirection: 'row', alignItems: 'center' },
  name: { flex: 1 },
  bold: { fontWeight: '700' },
  code: { direction: 'ltr' },
});
