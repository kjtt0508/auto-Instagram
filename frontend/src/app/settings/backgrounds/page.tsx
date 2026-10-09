"use client";

import { AdminPage } from "@/components/settings/AdminPage";
import { BackgroundPhotoSection } from "@/components/settings/BackgroundPhotoSection";

/** S-14 背景写真（管理者） */
export default function BackgroundPhotosPage() {
  return <AdminPage title="背景写真"><BackgroundPhotoSection /></AdminPage>;
}
