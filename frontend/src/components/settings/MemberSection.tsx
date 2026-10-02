"use client";

import { useEffect, useState } from "react";
import { CellButton } from "@/components/ui/Button";
import { Cell, GroupedSection } from "@/components/ui/Grouped";
import { Member } from "@/domain/member/Member";
import { Role } from "@/domain/member/Role";
import { changeRole, deactivate, invite, membersOfTenant } from "@/lib/api/memberAdministration";

const FIELD = "min-h-11 w-full bg-transparent px-4 text-[17px] outline-none";

/** S-11 ② メンバー: 招待・ロール変更・無効化（承認者以上。管理者ロールは管理者だけが扱える。AC-001-23） */
export function MemberSection({ me }: { me: Member }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = () => membersOfTenant().then(setMembers, (e: Error) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const act = (command: () => Promise<void>) => command().then(load, (e: Error) => setError(e.message));

  return (
    <>
      <GroupedSection title="メンバー" footer={error ? <span role="alert" className="text-destructive">{error}</span> : undefined}>
        {members.map((m) => <MemberRow key={m.id} me={me} member={m} act={act} />)}
      </GroupedSection>
      {me.role.canAdministerMembers() && <InviteForm roles={me.role.assignableRoles()} act={act} setError={setError} />}
    </>
  );
}

function MemberRow({ me, member, act }: { me: Member; member: Member; act: (c: () => Promise<void>) => void }) {
  const [reason, setReason] = useState("");
  const editable = me.canAdminister(member);
  return (
    <Cell>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate">{member.displayName}</span>
          <span className="block truncate text-[13px] text-secondary-label">{member.email}</span>
        </span>
        {editable ? (
          <select aria-label={`${member.displayName}のロール`} value={member.role.code}
            onChange={(e) => act(() => changeRole(member, Role.from(e.target.value)))} className="min-h-9 rounded-[8px] bg-fill px-2 text-[15px] text-tint">
            {me.role.assignableRoles().map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        ) : <span className="shrink-0 text-secondary-label">{member.isActive() ? member.role.label : "無効"}</span>}
      </div>
      {editable && (
        <div className="mt-2 flex items-center gap-2">
          <input aria-label="無効化の理由" placeholder="無効化の理由（卒業など）" value={reason} onChange={(e) => setReason(e.target.value)}
            className="min-h-9 min-w-0 flex-1 rounded-[8px] bg-fill px-3 text-[15px]" />
          <button type="button" disabled={reason.trim() === ""} onClick={() => act(() => deactivate(member, reason.trim()))}
            className="min-h-9 shrink-0 px-2 text-[15px] text-destructive disabled:opacity-40">無効化</button>
        </div>
      )}
    </Cell>
  );
}

function InviteForm({ roles, act, setError }: { roles: readonly Role[]; act: (c: () => Promise<void>) => void; setError: (m: string) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>(Role.EDITOR);
  const submit = () => {
    const violations = Member.violationsOfInvitation(email, name);
    if (violations.length > 0) return setError(violations.join("\n"));
    act(() => invite(email.trim(), name.trim(), role));
  };
  return (
    <GroupedSection title="招待する" footer="招待した人は、そのGoogleアカウントでログインできるようになります">
      <input aria-label="メールアドレス" type="email" placeholder="メールアドレス（Google）" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
      <div className="border-t border-separator">
        <input aria-label="表示名" placeholder="表示名" value={name} onChange={(e) => setName(e.target.value)} className={FIELD} />
      </div>
      <label className="flex min-h-11 items-center justify-between border-t border-separator px-4">
        <span>ロール</span>
        <select aria-label="招待するロール" value={role.code} onChange={(e) => setRole(Role.from(e.target.value))} className="bg-transparent text-tint">
          {roles.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
      </label>
      <div className="border-t border-separator"><CellButton onClick={submit}>招待</CellButton></div>
    </GroupedSection>
  );
}
