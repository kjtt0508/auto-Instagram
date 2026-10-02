// Instagram 連携が失敗したときの理由のコード。API関数（server）がリダイレクトに付け、設定画面が文言にする。両側がこの定義を使う
export const CONNECTING_FAILURE_MESSAGES = {
  access_denied: "Instagramで許可されませんでした",
  state: "連携の有効期限が切れました。もう一度お試しください",
  account_type: "ビジネスまたはクリエイターのアカウントに切り替えてから連携してください",
  failed: "連携に失敗しました。もう一度お試しください",
} as const;

export type ConnectingFailureReason = keyof typeof CONNECTING_FAILURE_MESSAGES;
