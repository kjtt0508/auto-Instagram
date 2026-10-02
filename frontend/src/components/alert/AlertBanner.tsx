import Link from "next/link";
import { Chevron } from "@/components/ui/Grouped";
import type { Alert } from "@/domain/alert/Alert";

/** 警告バナー（BR-001-12）。重要度の順はドメインが決める。エラーは赤、注意は黄の印を付けたセルで並べる */
export function AlertBanner({ alerts }: { alerts: readonly { alert: Alert; href: string }[] }) {
  if (alerts.length === 0) return null;
  return (
    <ul aria-label="警告" className="mt-2 overflow-hidden rounded-cell bg-cell">
      {alerts.map(({ alert, href }) => (
        <li key={alert.code} role="alert" className="border-separator [&+&]:border-t">
          <Link href={href} className="flex min-h-11 items-center gap-3 px-4 py-2.5 active:bg-fill">
            <span aria-hidden="true"
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-on-tint ${alert.isError() ? "bg-destructive" : "bg-caution"}`}>!</span>
            <span className="min-w-0 flex-1 text-[15px]">{alert.message}</span>
            <Chevron />
          </Link>
        </li>
      ))}
    </ul>
  );
}
