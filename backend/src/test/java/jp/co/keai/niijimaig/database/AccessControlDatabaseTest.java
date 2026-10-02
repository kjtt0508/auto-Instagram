package jp.co.keai.niijimaig.database;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.support.TransactionTemplate;

import jp.co.keai.niijimaig.TestcontainersConfiguration;
import jp.co.keai.niijimaig.support.SupabaseFixture;
import jp.co.keai.niijimaig.support.SupabaseFixture.LoggedIn;

/**
 * DB が最後の砦として守ること（RLS・RPC の権限・状態遷移・版の固定）。
 * 業務判断そのもの（文字数・画像仕様・予約日時）はドメインの単体テストで確かめる。
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@ActiveProfiles("test")
class AccessControlDatabaseTest {

	@Autowired JdbcTemplate jdbc;
	@Autowired TransactionTemplate tx;

	SupabaseFixture db;
	UUID tenant;
	LoggedIn editor;
	LoggedIn approver;
	LoggedIn admin;

	@BeforeEach
	void setUp() {
		db = new SupabaseFixture(jdbc, tx);
		String suffix = UUID.randomUUID().toString().substring(0, 8);
		tenant = db.tenant("新島info-" + suffix);
		admin = db.member(tenant, "admin-" + suffix + "@example.com", "ADMIN");
		approver = db.member(tenant, "approver-" + suffix + "@example.com", "APPROVER");
		editor = db.member(tenant, "editor-" + suffix + "@example.com", "EDITOR");
	}

	@Test
	@DisplayName("AC-001-01 許可リストにないアカウントは、どのデータも読めない")
	void strangerReadsNothing() {
		UUID post = createDraft(editor);
		LoggedIn stranger = db.stranger("stranger-" + UUID.randomUUID() + "@example.com");

		int posts = db.as(stranger, j -> j.queryForObject("select count(*) from posts where id = ?", Integer.class, post));
		int members = db.as(stranger, j -> j.queryForObject("select count(*) from members", Integer.class));
		UUID linked = db.as(stranger, j -> j.queryForObject("select public.link_my_member()", UUID.class));

		assertThat(posts).isZero();
		assertThat(members).isZero();
		assertThat(linked).isNull();
	}

	@Test
	@DisplayName("AC-001-02 無効化されたメンバーは、許可リストにない人と同じ扱いになる")
	void deactivatedMemberReadsNothing() {
		UUID post = createDraft(editor);
		db.as(approver, j -> j.queryForList("select public.deactivate_member(?, ?)", editor.memberId(), "卒業"));

		int posts = db.as(editor, j -> j.queryForObject("select count(*) from posts where id = ?", Integer.class, post));

		assertThat(posts).isZero();
	}

	@Test
	@DisplayName("AC-001-10 編集者は承認待ちの投稿を予約に確定できない")
	void editorCannotApprove() {
		UUID post = createDraft(editor);
		UUID revision = latestRevision(post);
		db.as(editor, j -> j.queryForList("select public.request_approval(?, ?)", post, revision));

		assertThatThrownBy(() -> db.as(editor, j -> j.queryForList("select public.approve_post(?, ?, ?)",
				post, revision, Timestamp.from(Instant.now().plus(1, ChronoUnit.DAYS)))))
				.isInstanceOf(DataAccessException.class)
				.rootCause().hasMessageContaining("権限がありません");
	}

	@Test
	@DisplayName("AC-001-10 編集者は出来事を直接記録して承認を回避できない")
	void editorCannotInsertEventsDirectly() {
		UUID post = createDraft(editor);
		UUID revision = latestRevision(post);
		db.as(editor, j -> j.queryForList("select public.request_approval(?, ?)", post, revision));

		assertThatThrownBy(() -> db.as(editor, j -> j.update(
				"insert into post_events (post_id, event_type, from_status, to_status) values (?, 'APPROVED', 'AWAITING_APPROVAL', 'SCHEDULED')",
				post))).isInstanceOf(DataAccessException.class);
	}

	@Test
	@DisplayName("AC-001-23 承認者は編集者を招待できるが、管理者ロールは付与できない")
	void approverCannotGrantAdmin() {
		UUID invited = db.as(approver, j -> j.queryForObject("select public.invite_member(?, ?, 'EDITOR')",
				UUID.class, "new-" + UUID.randomUUID() + "@example.com", "新メンバー"));

		assertThat(invited).isNotNull();
		assertThatThrownBy(() -> db.as(approver, j -> j.queryForObject("select public.invite_member(?, ?, 'ADMIN')",
				UUID.class, "boss-" + UUID.randomUUID() + "@example.com", "管理者")))
				.rootCause().hasMessageContaining("管理者ロール");
		assertThatThrownBy(() -> db.as(approver, j -> j.queryForList("select public.change_member_role(?, 'ADMIN')", invited)))
				.rootCause().hasMessageContaining("管理者ロール");
	}

	@Test
	@DisplayName("NFR-001-05 他団体の投稿は読めず、他団体の投稿は操作できない")
	void otherTenantIsIsolated() {
		UUID post = createDraft(editor);
		UUID otherTenant = db.tenant("他団体-" + UUID.randomUUID());
		LoggedIn outsider = db.member(otherTenant, "other-" + UUID.randomUUID() + "@example.com", "ADMIN");

		int visible = db.as(outsider, j -> j.queryForObject("select count(*) from post_current where post_id = ?", Integer.class, post));

		assertThat(visible).isZero();
		assertThatThrownBy(() -> db.as(outsider, j -> j.queryForList("select public.discard_post(?)", post)))
				.rootCause().hasMessageContaining("投稿が見つかりません");
	}

	@Test
	@DisplayName("NFR-001-04 承認依頼後は版が固定され、同じ遷移を2回は記録できない")
	void revisionsFrozenAndTransitionsSerialized() {
		UUID post = createDraft(editor);
		UUID revision = latestRevision(post);
		db.as(editor, j -> j.queryForList("select public.request_approval(?, ?)", post, revision));
		Timestamp tomorrow = Timestamp.from(Instant.now().plus(1, ChronoUnit.DAYS));

		assertThatThrownBy(() -> db.as(editor, j -> j.queryForObject(
				"select public.save_post_revision(?, ?::jsonb)", UUID.class, post, revisionJson("書き換え"))))
				.rootCause().hasMessageContaining("frozen");

		db.as(approver, j -> j.queryForList("select public.approve_post(?, ?, ?)", post, revision, tomorrow));
		assertThatThrownBy(() -> db.as(admin, j -> j.queryForList("select public.approve_post(?, ?, ?)", post, revision, tomorrow)))
				.isInstanceOf(DataAccessException.class);

		String status = db.as(editor, j -> j.queryForObject("select status from post_current where post_id = ?", String.class, post));
		assertThat(status).isEqualTo("SCHEDULED");
	}

	@Test
	@DisplayName("AC-001-03 アクセストークンの表は画面（authenticated）から読めない")
	void tokenTableIsNotReadable() {
		assertThatThrownBy(() -> db.as(admin, j -> j.queryForObject("select count(*) from instagram_connection_current", Integer.class)))
				.isInstanceOf(DataAccessException.class);
		int grants = db.as(admin, j -> j.queryForObject("select count(*) from instagram_token_grants", Integer.class));
		assertThat(grants).isZero();
	}

	private UUID createDraft(LoggedIn author) {
		return db.as(author, j -> j.queryForObject("select public.save_post_revision(null, ?::jsonb)", UUID.class,
				revisionJson("11/3 学園祭のお知らせ #新島info")));
	}

	private String revisionJson(String caption) {
		return """
				{"format":"FEED_IMAGE","mediaSource":"UPLOAD","caption":"%s","prCategory":"NONE",
				 "media":[{"position":1,"storagePath":"%s/posts/a.jpg","width":1080,"height":1350,"byteSize":500000}]}
				""".formatted(caption, tenant);
	}

	private UUID latestRevision(UUID post) {
		return jdbc.queryForObject("select id from post_revisions where post_id = ? order by revision_no desc limit 1",
				UUID.class, post);
	}
}
