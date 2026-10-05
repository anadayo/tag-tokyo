export const publicOperator = {
  name: process.env.NEXT_PUBLIC_OPERATOR_NAME?.trim() || "堂前光輝",
  contact: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || "sougenclick@gmail.com",
  notificationNumber: process.env.NEXT_PUBLIC_DATING_SERVICE_NOTIFICATION_NUMBER?.trim() ?? "",
};

export const publicContactReady = Boolean(publicOperator.name && publicOperator.contact);
export const publicOperatorReady = publicContactReady && Boolean(publicOperator.notificationNumber);
