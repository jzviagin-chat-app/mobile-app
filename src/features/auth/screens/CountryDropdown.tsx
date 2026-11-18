import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';

import type { Language } from '@/lib/i18n';
import { Text, TextField, useTheme } from '@/ui';

import { listCountries, searchCountries, type Country } from '../countries';
import type { CountryCode } from '../phone';

const ROW_HEIGHT = 48;
const VISIBLE_ROWS = 5;
const MIN_ROWS = 2;
const SEARCH_HEIGHT = 84; // label + field

/** Where the country button is on screen (from measureInWindow). */
export type Anchor = { y: number; height: number };

type Props = {
  anchor: Anchor;
  selected: CountryCode;
  onSelect: (code: CountryCode) => void;
  onClose: () => void;
};

/**
 * A searchable dropdown under the country button: a search field and up to 5 rows (fewer when the
 * keyboard leaves less room) that scroll through
 * every country (the selectable ones first, the rest greyed out). It opens above the button when there's
 * no room below (e.g. with the keyboard up). Closes on a tap outside or Android's back button. Rendered
 * only while open, so the 245-country list isn't built until it's needed.
 */
export function CountryDropdown({ anchor, selected, onSelect, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const window = useWindowDimensions();
  const [query, setQuery] = useState('');
  const all = useMemo(() => listCountries(i18n.language as Language), [i18n.language]);
  const shown = useMemo(() => searchCountries(all, query), [all, query]);

  // The search field opens the keyboard: placement and the number of rows follow its live height, so
  // the list never ends up behind it.
  const keyboard = useKeyboardState((state) => (state.isVisible ? state.height : 0));
  const chrome = SEARCH_HEIGHT + theme.spacing.sm * 3; // search field, padding, gap above the list
  const fullHeight = chrome + ROW_HEIGHT * VISIBLE_ROWS;
  const spaceBelow = window.height - keyboard - (anchor.y + anchor.height) - theme.spacing.sm;
  const below = spaceBelow >= fullHeight || anchor.y < fullHeight;
  const space = below
    ? spaceBelow - theme.spacing.xs
    : anchor.y - theme.spacing.xs - theme.spacing.sm;
  const rows = Math.max(
    MIN_ROWS,
    Math.min(VISIBLE_ROWS, Math.floor((space - chrome) / ROW_HEIGHT)),
  );
  const panelHeight = chrome + ROW_HEIGHT * rows;
  const position = below
    ? { top: anchor.y + anchor.height + theme.spacing.xs }
    : { top: Math.max(theme.spacing.sm, anchor.y - panelHeight - theme.spacing.xs) };

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
          onClose();
        }}
        style={({ pressed }) => [
          styles.row,
          {
            gap: theme.spacing.md,
            paddingHorizontal: theme.spacing.md,
            backgroundColor: isSelected ? theme.colors.background : 'transparent',
            opacity: item.selectable ? (pressed ? 0.6 : 1) : 0.4,
          },
        ]}
      >
        <Text>{item.flag}</Text>
        <View style={styles.name}>
          <Text numberOfLines={1} style={isSelected ? styles.bold : undefined}>
            {item.name}
          </Text>
          {!item.selectable ? (
            <Text variant="caption" muted>
              {t('auth.country.notAvailable')}
            </Text>
          ) : null}
        </View>
        <Text muted style={styles.ltr}>{`+${item.callingCode}`}</Text>
      </Pressable>
    );
  }

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable
        testID="country-backdrop"
        accessibilityLabel={t('auth.country.close')}
        style={StyleSheet.absoluteFill}
        onPress={onClose}
      />
      <View
        style={[
          styles.panel,
          position,
          {
            start: theme.spacing.lg,
            end: theme.spacing.lg,
            padding: theme.spacing.sm,
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            shadowColor: theme.colors.shadow,
          },
        ]}
      >
        <TextField
          label={t('auth.country.search')}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          autoFocus
          testID="country-search"
        />
        <FlatList
          testID="country-list"
          data={shown}
          keyExtractor={(item) => item.code}
          renderItem={renderItem}
          getItemLayout={(_data, index) => ({
            length: ROW_HEIGHT,
            offset: ROW_HEIGHT * index,
            index,
          })}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={VISIBLE_ROWS * 2}
          style={{ height: ROW_HEIGHT * rows, marginTop: theme.spacing.sm }}
          ListEmptyComponent={
            <Text muted style={{ padding: theme.spacing.md }}>
              {t('auth.country.noResults')}
            </Text>
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 12,
    elevation: 8,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  row: { height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', borderRadius: 8 },
  name: { flex: 1 },
  bold: { fontWeight: '700' },
  ltr: { direction: 'ltr' },
});
