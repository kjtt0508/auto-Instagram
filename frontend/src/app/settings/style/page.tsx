"use client";

import { AdminPage } from "@/components/settings/AdminPage";
import { StyleSettingsSection } from "@/components/settings/StyleSettingsSection";

/** S-15 投稿の型の設定（管理者） */
export default function StyleSettingsPage() {
  return <AdminPage title="投稿の型の設定"><StyleSettingsSection /></AdminPage>;
}
