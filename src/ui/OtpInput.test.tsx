import { fireEvent, render, screen } from '@testing-library/react-native';

import { OtpInput } from './OtpInput';

describe('OtpInput', () => {
  it('keeps only digits and completes at 6', async () => {
    const onChange = jest.fn();
    const onComplete = jest.fn();
    await render(<OtpInput label="Code" value="" onChange={onChange} onComplete={onComplete} />);
    await fireEvent.changeText(screen.getByTestId('otp-input'), '12 34-56');
    expect(onChange).toHaveBeenCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('ignores typing while busy, but stays editable (keyboard open, no grey disabled field)', async () => {
    const onChange = jest.fn();
    await render(<OtpInput label="Code" value="" onChange={onChange} busy />);
    const input = screen.getByTestId('otp-input');
    expect(input).toBeEnabled();
    await fireEvent.changeText(input, '1');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the digits in boxes', async () => {
    await render(<OtpInput label="Code" value="12" onChange={jest.fn()} />);
    expect(screen.getByText('1')).toBeOnTheScreen();
    expect(screen.getByText('2')).toBeOnTheScreen();
  });
});
