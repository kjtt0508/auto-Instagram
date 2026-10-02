import { Role } from "./Role";

/** メンバー: 管理画面にログインできる人。無効化されたメンバーはログインできない（削除せず無効化を記録する） */
export class Member {
  static readonly MAX_DISPLAY_NAME = 50;

  private constructor(
    readonly id: string,
    readonly email: string,
    readonly displayName: string,
    readonly role: Role,
    private readonly active: boolean,
  ) {}

  static restore(parts: { id: string; email: string; displayName: string; roleCode: string; active: boolean }): Member {
    if (parts.id === "" || parts.email === "") throw new Error("メンバーIDとメールアドレスは必須です");
    return new Member(parts.id, parts.email, parts.displayName, Role.from(parts.roleCode), parts.active);
  }

  isActive(): boolean {
    return this.active;
  }

  /** 招待時の入力の不備（空なら招待できる） */
  static violationsOfInvitation(email: string, displayName: string): string[] {
    const violations: string[] = [];
    if (!/^[^@\s]+@[^@\s]+$/.test(email.trim())) violations.push("メールアドレスの形式が正しくありません");
    const length = [...displayName.trim()].length;
    if (length < 1 || length > Member.MAX_DISPLAY_NAME) violations.push(`表示名は1〜${Member.MAX_DISPLAY_NAME}文字です`);
    return violations;
  }

  /** 操作する人（this）が、相手のロール変更・無効化をできるか（自分自身と、無効化済みのメンバーは対象外） */
  canAdminister(target: Member): boolean {
    return target.id !== this.id && target.active && this.role.canChange(target.role);
  }
}
