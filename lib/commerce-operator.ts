import { publicOperator } from "@/lib/public-operator";

export const commerceOperator = {
  sellerName: process.env.NEXT_PUBLIC_COMMERCE_SELLER_NAME?.trim() || publicOperator.name,
  responsiblePerson: process.env.NEXT_PUBLIC_COMMERCE_RESPONSIBLE_PERSON?.trim() || publicOperator.name,
  address: process.env.NEXT_PUBLIC_COMMERCE_ADDRESS?.trim() || "",
  phone: process.env.NEXT_PUBLIC_COMMERCE_PHONE?.trim() || "",
  email: publicOperator.contact,
};

export const commerceDisclosureReady = Boolean(
  commerceOperator.sellerName
  && commerceOperator.responsiblePerson
  && commerceOperator.address
  && commerceOperator.phone
  && commerceOperator.email,
);
