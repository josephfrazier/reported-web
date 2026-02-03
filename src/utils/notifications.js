/**
 * Notification Utilities
 * Extracted from Home.js for better modularity and testability
 * Wrapper functions for toast notifications
 */

import { toast } from 'react-toastify';

export const notifySuccess = notificationContent =>
  toast.success(notificationContent);

export const notifyInfo = notificationContent =>
  toast.info(notificationContent);

export const notifyWarning = notificationContent =>
  toast.warn(notificationContent);

export const notifyError = notificationContent =>
  toast.error(notificationContent);
