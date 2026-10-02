/**
 * 予約日時。確定時点では未来かつ1年以内（decide）。失敗の再実行の「今すぐ」は immediate。
 * 記録から戻すとき（restore）は検査しない（公開時には過去になっているのが正常）。Java の ScheduledAt と揃える。
 */
export class ScheduledAt {
  static readonly MAX_AHEAD_DAYS = 365;
  private static readonly SECOND_MS = 1000;
  private static readonly DAY_MS = 24 * 60 * 60 * ScheduledAt.SECOND_MS;

  private constructor(private readonly value: Date) {}

  /** 確定できない理由（空なら確定できる） */
  static violationsOfDecision(value: Date, now: Date): string[] {
    if (Number.isNaN(value.getTime())) return ["予約日時を入力してください"];
    if (value.getTime() <= now.getTime()) return ["予約日時は現在より後にしてください"];
    if (value.getTime() > now.getTime() + ScheduledAt.MAX_AHEAD_DAYS * ScheduledAt.DAY_MS) {
      return ["予約日時は1年以内にしてください"];
    }
    return [];
  }

  static decide(value: Date, now: Date): ScheduledAt {
    const violations = ScheduledAt.violationsOfDecision(value, now);
    if (violations.length > 0) throw new Error(violations.join("\n"));
    return new ScheduledAt(ScheduledAt.truncatedToSeconds(value));
  }

  static immediate(now: Date): ScheduledAt {
    return new ScheduledAt(ScheduledAt.truncatedToSeconds(now));
  }

  static restore(value: Date): ScheduledAt {
    if (Number.isNaN(value.getTime())) throw new Error("予約日時は必須です");
    return new ScheduledAt(value);
  }

  private static truncatedToSeconds(value: Date): Date {
    return new Date(Math.floor(value.getTime() / ScheduledAt.SECOND_MS) * ScheduledAt.SECOND_MS);
  }

  toDate(): Date {
    return new Date(this.value.getTime());
  }

  toISOString(): string {
    return this.value.toISOString();
  }
}
