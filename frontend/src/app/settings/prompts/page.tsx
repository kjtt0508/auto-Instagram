"use client";

import { AdminPage } from "@/components/settings/AdminPage";
import { PromptVersionSection } from "@/components/settings/PromptVersionSection";

/** S-10 プロンプト版（管理者） */
export default function PromptVersionsPage() {
  return <AdminPage title="プロンプト版"><PromptVersionSection /></AdminPage>;
}
