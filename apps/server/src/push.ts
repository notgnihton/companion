import webpush from "web-push";
import { config } from "./config.js";
import { Notification, PushSubscriptionRecord } from "./types.js";

const hasConfiguredVapidKeys =
  typeof config.VAPID_PUBLIC_KEY === "string" &&
  config.VAPID_PUBLIC_KEY.length > 0 &&
  typeof config.VAPID_PRIVATE_KEY === "string" &&
  config.VAPID_PRIVATE_KEY.length > 0;

const vapidKeys: { publicKey: string; privateKey: string } = hasConfiguredVapidKeys
  ? {
      publicKey: config.VAPID_PUBLIC_KEY!,
      privateKey: config.VAPID_PRIVATE_KEY!
    }
  : webpush.generateVAPIDKeys();

webpush.setVapidDetails(config.VAPID_SUBJECT, vapidKeys.publicKey, vapidKeys.privateKey);

export interface PushSendResult {
  delivered: boolean;
  shouldDropSubscription: boolean;
  statusCode?: number;
  error?: string;
  attempts: number;
  retries: number;
}

interface PushRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  send?: (subscription: PushSubscriptionRecord, payload: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

export function getVapidPublicKey(): string {
  return vapidKeys.publicKey;
}

export function hasStaticVapidKeys(): boolean {
  return hasConfiguredVapidKeys;
}

export async function sendPushNotification(
  subscription: PushSubscriptionRecord,
  notification: Pick<Notification, "id" | "title" | "message" | "priority" | "source" | "timestamp" | "metadata" | "actions" | "url">,
  options: PushRetryOptions = {}
): Promise<PushSendResult> {
  const payload = JSON.stringify({
    notificationId: notification.id,
    title: notification.title,
    message: notification.message,
    priority: notification.priority,
    source: notification.source,
    timestamp: notification.timestamp,
    deadlineId: notification.metadata?.deadlineId,
    actions: notification.actions,
    url: notification.url
  });

  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const sender = options.send ?? ((target: PushSubscriptionRecord, body: string) => webpush.sendNotification(target, body));
  const sleep = options.sleep ?? defaultSleep;

  let attempt = 0;
  let lastError: unknown = undefined;

  while (attempt <= maxRetries) {
    attempt += 1;

    try {
      await sender(subscription, payload);
      return {
        delivered: true,
        shouldDropSubscription: false,
        attempts: attempt,
        retries: attempt - 1
      };
    } catch (error) {
      lastError = error;
      const statusCode = readStatusCode(error);
      const shouldDropSubscription = statusCode === 404 || statusCode === 410;

      if (shouldDropSubscription || attempt > maxRetries) {
        return {
          delivered: false,
          shouldDropSubscription,
          statusCode,
          error: error instanceof Error ? error.message : "Failed to deliver push notification",
          attempts: attempt,
          retries: attempt - 1
        };
      }

      const delay = baseDelayMs * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }

  return {
    delivered: false,
    shouldDropSubscription: false,
    error: lastError instanceof Error ? lastError.message : "Failed to deliver push notification",
    attempts: maxRetries + 1,
    retries: maxRetries
  };
}

function readStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  if ("statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }

  return undefined;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
