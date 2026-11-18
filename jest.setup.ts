import '@/root/mobx-config';

// The keyboard library's own mock (no native module in Node).
jest.mock('react-native-keyboard-controller', () =>
  jest.requireActual('react-native-keyboard-controller/jest'),
);
