import { describe, expect, it } from "vitest";
import { Member } from "./Member";
import { Role } from "./Role";

const member = (id: string, roleCode: string, active = true) =>
  Member.restore({ id, email: `${id}@example.com`, displayName: id, roleCode, active });

describe("ロール（BR-001-01）", () => {
  it("AC-001-10 編集者は承認できない。承認者・管理者はできる", () => {
    expect(Role.EDITOR.canApprove()).toBe(false);
    expect(Role.APPROVER.canApprove()).toBe(true);
    expect(Role.ADMIN.canApprove()).toBe(true);
  });

  it("AC-001-23 承認者が付与できるロールに管理者は出ない", () => {
    expect(Role.APPROVER.assignableRoles()).toEqual([Role.APPROVER, Role.EDITOR]);
    expect(Role.ADMIN.assignableRoles()).toEqual([Role.ADMIN, Role.APPROVER, Role.EDITOR]);
    expect(Role.EDITOR.assignableRoles()).toEqual([]);
  });

  it("Instagram連携を扱えるのは管理者だけ", () => {
    expect(Role.all().filter((r) => r.canManageConnection())).toEqual([Role.ADMIN]);
  });
});

describe("メンバー", () => {
  it("AC-001-23 承認者は管理者のメンバーを変更・無効化できない", () => {
    expect(member("approver", "APPROVER").canAdminister(member("admin", "ADMIN"))).toBe(false);
    expect(member("approver", "APPROVER").canAdminister(member("editor", "EDITOR"))).toBe(true);
  });

  it("AC-001-24 自分自身と無効化済みのメンバーは扱えない（自分の行には操作を出さない）", () => {
    const admin = member("admin", "ADMIN");
    expect(admin.canAdminister(admin)).toBe(false);
    expect(admin.canAdminister(member("old", "EDITOR", false))).toBe(false);
  });

  it("招待の入力を検査する", () => {
    expect(Member.violationsOfInvitation("a@example.com", "梶原")).toEqual([]);
    expect(Member.violationsOfInvitation("not-mail", "")).toHaveLength(2);
    expect(Member.violationsOfInvitation("  a@example.com ", " 梶原 ")).toEqual([]);
  });
});
