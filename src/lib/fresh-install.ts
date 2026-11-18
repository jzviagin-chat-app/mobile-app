import { File, Paths } from 'expo-file-system';

const MARKER = 'installed';

/**
 * True on the first launch after an install (then never again until the app is reinstalled).
 * Why: the iOS Keychain survives uninstalling the app, so a reinstall would otherwise come back signed in,
 * while the server treats every install as a new device. The app's documents folder is deleted with the
 * app, so a marker file there tells a fresh install apart.
 */
export function isFirstLaunchAfterInstall(): boolean {
  const marker = new File(Paths.document, MARKER);
  if (marker.exists) return false;
  marker.create();
  return true;
}
