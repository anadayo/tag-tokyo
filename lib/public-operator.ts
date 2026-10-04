export const publicOperator = {
  name: process.env.NEXT_PUBLIC_OPERATOR_NAME?.trim() ?? "",
  contact: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() ?? "",
  notificationNumber: process.env.NEXT_PUBLIC_DATING_SERVICE_NOTIFICATION_NUMBER?.trim() ?? "",
};

export const publicOperatorReady = Object.values(publicOperator).every(Boolean);
