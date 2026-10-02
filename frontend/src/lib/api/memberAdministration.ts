import { Member } from "@/domain/member/Member";
import type { Role } from "@/domain/member/Role";
import { check, supabase, unwrap } from "./supabase";

// メンバーの招待・ロール変更・無効化（S-11。BR-001-01, AC-001-23）。管理者ロールの制限は RPC でも確かめる

export async function membersOfTenant(): Promise<Member[]> {
  const rows = unwrap(await supabase().from("member_current")
    .select("member_id, email, display_name, role, active").order("display_name"));
  return rows.map((r) => Member.restore({ id: r.member_id, email: r.email, displayName: r.display_name,
    roleCode: r.role, active: r.active }));
}

export async function invite(email: string, displayName: string, role: Role): Promise<void> {
  check(await supabase().rpc("invite_member", { p_email: email, p_display_name: displayName, p_role: role.code }));
}

export async function changeRole(member: Member, role: Role): Promise<void> {
  check(await supabase().rpc("change_member_role", { p_member: member.id, p_role: role.code }));
}

export async function deactivate(member: Member, reason: string): Promise<void> {
  check(await supabase().rpc("deactivate_member", { p_member: member.id, p_reason: reason }));
}
