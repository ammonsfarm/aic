export const CONTACT_CONSENT_VERSION = "2026-07-22";
export const CONTACT_CONSENT_TEXT =
  "I agree that Abiding in Christ may store and use my contact information and message to respond to this request.";

export const CONTACT_ATTEMPT_RETENTION_DAYS = 30;
export const CONTACT_ARCHIVED_RETENTION_DAYS = 365;

export const CONTACT_CATEGORIES = ["general", "feedback", "prayer", "speaking"] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

export const CONTACT_CATEGORY_LABELS: Record<ContactCategory, string> = {
  general: "General correspondence",
  feedback: "Feedback",
  prayer: "Prayer request",
  speaking: "Speaking invitation",
};

export const CONTACT_MESSAGE_STATUSES = ["new", "in_review", "resolved", "archived"] as const;
export type ContactMessageStatus = (typeof CONTACT_MESSAGE_STATUSES)[number];

export const CONTACT_MESSAGE_STATUS_LABELS: Record<ContactMessageStatus, string> = {
  new: "New",
  in_review: "In review",
  resolved: "Resolved",
  archived: "Archived",
};

export const CONTACT_NOTIFICATION_STATUSES = ["not_configured", "pending", "sent", "failed"] as const;
export type ContactNotificationStatus = (typeof CONTACT_NOTIFICATION_STATUSES)[number];

export const CONTACT_NOTIFICATION_STATUS_LABELS: Record<ContactNotificationStatus, string> = {
  not_configured: "Notification not configured",
  pending: "Notification pending",
  sent: "Notification sent",
  failed: "Notification failed",
};
