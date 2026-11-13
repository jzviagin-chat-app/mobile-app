import * as Device from 'expo-device';
import { Platform } from 'react-native';

import type { DeviceIn } from './api';

export type DeviceInfo = DeviceIn & { platform: 'ios' | 'android' };

/**
 * This phone, as sent to otp/verify and register (shown later in the devices list).
 * The name is the one set in the phone's settings ("Jacob's S22"), else the model name. On iOS 16+ the
 * name is just "iPhone" without a special entitlement (expo-device docs), so the model is more useful there.
 */
export function getDeviceInfo(): DeviceInfo {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const name = (platform === 'ios' ? Device.modelName : (Device.deviceName ?? Device.modelName))
    ?.trim()
    .slice(0, 100);
  return name ? { platform, name } : { platform };
}
