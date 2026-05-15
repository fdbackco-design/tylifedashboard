export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
};

export type PushSubscribeBody = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type PushSendBody = {
  title: string;
  body: string;
  url?: string;
  /** 지정 시 해당 사용자 구독 기기에만 발송 */
  targetUserId?: string;
};

export type PushSendResult = {
  sent: number;
  failed: number;
  removed: number;
  errors: string[];
};
