/**
 * @jest-environment jsdom
 */
/* eslint-env jest */

import {
  notifySuccess,
  notifyInfo,
  notifyWarning,
  notifyError,
} from './notifications.js';

// Mock toast
jest.mock('react-toastify', () => ({
  toast: {
    success: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { toast } = require('react-toastify');

describe('notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('notifySuccess calls toast.success', () => {
    notifySuccess('Test message');
    expect(toast.success).toHaveBeenCalledWith('Test message');
  });

  test('notifyInfo calls toast.info', () => {
    notifyInfo('Test message');
    expect(toast.info).toHaveBeenCalledWith('Test message');
  });

  test('notifyWarning calls toast.warn', () => {
    notifyWarning('Test message');
    expect(toast.warn).toHaveBeenCalledWith('Test message');
  });

  test('notifyError calls toast.error', () => {
    notifyError('Test message');
    expect(toast.error).toHaveBeenCalledWith('Test message');
  });
});
