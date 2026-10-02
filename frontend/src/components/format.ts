// 表示の書式（日本時間）。入力欄 <input type="datetime-local"> の値も日本時間として扱う
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit",
});
const timeFormat = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });

export const formatDateTime = (date: Date): string => dateTimeFormat.format(date);
export const formatTime = (date: Date): string => timeFormat.format(date);

/** 日本時間の日付キー（YYYY-MM-DD）。カレンダーで日ごとにまとめるのに使う */
export const japanDateKey = (date: Date): string => new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);

/** <input type="datetime-local"> の値（日本時間）→ Date。空なら Invalid Date */
export const fromJapanLocalInput = (value: string): Date => new Date(value ? `${value}:00+09:00` : Number.NaN);

/** Date → <input type="datetime-local"> の値（日本時間） */
export const toJapanLocalInput = (date: Date): string => new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 16);

/** 日本時間の今日の年と月 */
export const japanYearMonth = (date: Date) => {
  const [year, month] = japanDateKey(date).split("-").map(Number);
  return { year, month };
};
