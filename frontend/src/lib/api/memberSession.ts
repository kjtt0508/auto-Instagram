import { Member } from "@/domain/member/Member";
import { Tenant } from "@/domain/tenant/Tenant";
import { forgetPreviewImages } from "@/lib/template/previewImages";
import { forgetAllAutosaves } from "./autosaveScope";
import { check, supabase, unwrap, unwrapOptional } from "./supabase";

/** ログインの状態。許可リストに無い・無効化されたアカウントは forbidden（AC-001-01, 02） */
export type SessionState =
  | { kind: "signedOut" }
  | { kind: "forbidden"; email: string }
  | { kind: "member"; member: Member; tenant: Tenant };

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/` },
  });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  forgetAllAutosaves();
  forgetPreviewImages();
  await supabase().auth.signOut();
}

/** ログイン中のメンバーと団体。初回ログインなら許可リストのメンバーと結びつける（link_my_member） */
export async function currentSession(): Promise<SessionState> {
  const { data } = await supabase().auth.getSession();
  const user = data.session?.user;
  if (!user) return { kind: "signedOut" };
  check(await supabase().rpc("link_my_member"));
  const row = unwrapOptional(await supabase().from("member_current")
    .select("member_id, tenant_id, email, display_name, role, active")
    .eq("auth_user_id", user.id).maybeSingle<MemberRow>());
  if (!row || !row.active) return { kind: "forbidden", email: user.email ?? "" };
  const member = Member.restore({ id: row.member_id, email: row.email, displayName: row.display_name,
    roleCode: row.role, active: row.active });
  return { kind: "member", member, tenant: await tenantOf(row.tenant_id) };
}

type MemberRow = { member_id: string; tenant_id: string; email: string; display_name: string; role: string; active: boolean };

async function tenantOf(tenantId: string): Promise<Tenant> {
  const tenant = unwrap(await supabase().from("tenants").select("id, name").eq("id", tenantId).single());
  const settings = unwrap(await supabase().from("tenant_settings_current").select("pr_label")
    .eq("tenant_id", tenantId).single());
  return Tenant.restore({ id: tenant.id, name: tenant.name, prLabel: settings.pr_label });
}
