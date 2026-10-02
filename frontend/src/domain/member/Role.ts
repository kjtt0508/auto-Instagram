/** ロール: メンバーができる操作の範囲（BR-001-01）。画面の出し分けは補助で、認可の正は RLS・RPC */
export class Role {
  static readonly ADMIN = new Role("ADMIN", "管理者",
    { approve: true, administerMembers: true, assignAdmin: true, manageConnection: true });
  static readonly APPROVER = new Role("APPROVER", "承認者",
    { approve: true, administerMembers: true, assignAdmin: false, manageConnection: false });
  static readonly EDITOR = new Role("EDITOR", "編集者",
    { approve: false, administerMembers: false, assignAdmin: false, manageConnection: false });

  private constructor(
    readonly code: string,
    readonly label: string,
    private readonly abilities: { approve: boolean; administerMembers: boolean; assignAdmin: boolean; manageConnection: boolean },
  ) {}

  static all(): readonly Role[] {
    return [Role.ADMIN, Role.APPROVER, Role.EDITOR];
  }

  static from(code: string): Role {
    const found = Role.all().find((r) => r.code === code);
    if (!found) throw new Error(`知らないロールです: ${code}`);
    return found;
  }

  /** 承認・予約の確定・予約の取消・再実行ができるか（承認者・管理者） */
  canApprove(): boolean {
    return this.abilities.approve;
  }

  /** メンバーの招待・ロール変更・無効化ができるか（承認者・管理者） */
  canAdministerMembers(): boolean {
    return this.abilities.administerMembers;
  }

  /** Instagram 連携の開始・解除ができるか（管理者） */
  canManageConnection(): boolean {
    return this.abilities.manageConnection;
  }

  /** このロールのメンバーが付与・変更できるロール（管理者ロールは管理者だけ。AC-001-23） */
  assignableRoles(): readonly Role[] {
    if (!this.abilities.administerMembers) return [];
    return Role.all().filter((r) => r !== Role.ADMIN || this.abilities.assignAdmin);
  }

  /** 相手のロールを変更・無効化できるか（管理者のメンバーを扱えるのは管理者だけ） */
  canChange(target: Role): boolean {
    return this.assignableRoles().includes(target);
  }
}
