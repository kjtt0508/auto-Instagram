package jp.co.keai.niijimaig.database;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.postgresql.util.PSQLException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

import jp.co.keai.niijimaig.support.SupabaseFixture;
import jp.co.keai.niijimaig.support.SupabaseFixture.LoggedIn;

/** REQ-002 の DB テストの共通の下ごしらえ: 団体・メンバー・JSON の組み立て・投稿の公開までの流れ */
abstract class DraftDatabaseSupport {

	@Autowired JdbcTemplate jdbc;
	@Autowired TransactionTemplate tx;

	SupabaseFixture db;
	UUID tenant;
	LoggedIn admin;
	LoggedIn approver;
	LoggedIn editor;

	@BeforeEach
	void setUpTenant() {
		db = new SupabaseFixture(jdbc, tx);
		String suffix = UUID.randomUUID().toString().substring(0, 8);
		tenant = db.tenant("新島info-" + suffix);
		admin = db.member(tenant, "admin-" + suffix + "@example.com", "ADMIN");
		approver = db.member(tenant, "approver-" + suffix + "@example.com", "APPROVER");
		editor = db.member(tenant, "editor-" + suffix + "@example.com", "EDITOR");
	}

	/** 投稿の型の設定を1つ登録する（管理者の RPC） */
	void configureStyle() {
		db.as(admin, j -> j.queryForObject(
				"select public.save_post_style_settings('帯', '{対象A,対象B}'::text[], '最後まで', '紹介', '---\nフッター', '{#固定}'::text[], null)",
				Integer.class));
	}

	// ───────── JSON ─────────

	String cover(String extra) {
		return "{\"role\":\"COVER\",\"target\":\"対象A\",\"keyword\":\"オトクな割引\",\"annotation\":\"学生のうちに\",\"closingWords\":\"まとめたよ\",\"accent\":\"RED\""
				+ extra + "}";
	}

	String body(String description, String emphases, String material) {
		return "{\"role\":\"BODY\",\"heading\":\"見出し\",\"description\":\"" + description + "\",\"emphases\":" + emphases
				+ ",\"picturePrompt\":\"桜並木\",\"needsReplacement\":false" + (material == null ? "" : ",\"material\":" + material) + "}";
	}

	String closing() {
		return "{\"role\":\"CLOSING\"}";
	}

	String material(String generation) {
		return "{\"storagePath\":\"" + tenant + "/posts/" + UUID.randomUUID() + ".jpg\",\"width\":1080,\"height\":810,\"byteSize\":300000"
				+ (generation == null ? "" : ",\"generation\":" + generation) + "}";
	}

	String generationRef(UUID generation, int candidatePosition) {
		return "{\"generationId\":\"" + generation + "\",\"candidatePosition\":" + candidatePosition + "}";
	}

	/** 表紙1・中のスライド（説明文は「これは説明です」）1・最後1 の TEMPLATE の版 */
	String simpleTemplate() {
		return template("niijima@1", "", cover(""), body("これは説明です", "[]", null), closing());
	}

	String template(String version, String extra, String... slides) {
		return "{\"format\":\"CAROUSEL\",\"mediaSource\":\"TEMPLATE\",\"caption\":\"本文\",\"prCategory\":\"NONE\","
				+ "\"templateVersion\":\"" + version + "\",\"hashtags\":[\"#学割\",\"#京都\"]" + extra
				+ ",\"slides\":[" + String.join(",", slides) + "]}";
	}

	String uploadRevision() {
		return "{\"format\":\"FEED_IMAGE\",\"mediaSource\":\"UPLOAD\",\"caption\":\"本文\",\"prCategory\":\"NONE\",\"media\":[{\"position\":1,"
				+ "\"storagePath\":\"" + tenant + "/posts/" + UUID.randomUUID() + ".jpg\",\"width\":1080,\"height\":1350,\"byteSize\":500000}]}";
	}

	// ───────── 投稿の流れ ─────────

	UUID save(LoggedIn user, String revisionJson) {
		return db.as(user, j -> j.queryForObject("select post_id from public.save_post_revision(null, ?::jsonb)", UUID.class, revisionJson));
	}

	UUID saveAgain(LoggedIn user, UUID post, String revisionJson) {
		return db.as(user, j -> j.queryForObject("select revision_id from public.save_post_revision(?, ?::jsonb)", UUID.class, post, revisionJson));
	}

	UUID latestRevision(UUID post) {
		return jdbc.queryForObject("select id from post_revisions where post_id = ? order by revision_no desc limit 1", UUID.class, post);
	}

	/** 承認を依頼して承認する。戻り値は承認の出来事（post_events.id） */
	long approve(UUID post) {
		UUID revision = latestRevision(post);
		db.as(editor, j -> j.queryForList("select public.request_approval(?, ?)", post, revision));
		db.as(approver, j -> j.queryForList("select public.approve_post(?, ?, ?)", post, revision,
				Timestamp.from(Instant.now().plus(1, ChronoUnit.DAYS))));
		return jdbc.queryForObject("select max(id) from post_events where post_id = ? and event_type = 'APPROVED'", Long.class, post);
	}

	/** 公開済みにする（定期処理が行う記録を、公開日時を指定して直接書く） */
	void publish(UUID post, Instant publishedAt) {
		UUID revision = latestRevision(post);
		jdbc.update("insert into post_events (post_id, event_type, from_status, to_status, revision_id) values (?, 'PUBLISH_STARTED', 'SCHEDULED', 'PUBLISHING', ?)",
				post, revision);
		jdbc.update("insert into post_events (post_id, event_type, from_status, to_status, revision_id) values (?, 'PUBLISHED', 'PUBLISHING', 'PUBLISHED', ?)",
				post, revision);
		jdbc.update("insert into post_publications (post_id, ig_media_id, permalink, published_at) values (?, ?, ?, ?)",
				post, "ig-" + UUID.randomUUID(), "https://www.instagram.com/p/x/", Timestamp.from(publishedAt));
	}

	/** 画像のあるアップロードの投稿を、指定の日時に公開済みにする。戻り値は投稿ID */
	UUID publishedUploadPost(Instant publishedAt) {
		UUID post = save(editor, uploadRevision());
		approve(post);
		publish(post, publishedAt);
		return post;
	}

	/** 画像化済みのテンプレートの投稿を、指定の日時に公開済みにする。戻り値は投稿ID */
	UUID publishedTemplatePost(Instant publishedAt) {
		configureStyleIfAbsent();
		UUID post = save(editor, simpleTemplate());
		long event = approve(post);
		recordRender(event, 1);
		publish(post, publishedAt);
		return post;
	}

	void configureStyleIfAbsent() {
		Integer n = jdbc.queryForObject("select count(*) from post_style_settings where tenant_id = ?", Integer.class, tenant);
		if (n == 0) {
			configureStyle();
		}
	}

	String renderPath(long event, int position) {
		return tenant + "/renders/" + event + "/" + position + ".jpg";
	}

	void recordRender(long event, int position) {
		db.asServiceRole(j -> j.queryForList("select public.record_template_render(?, ?, ?, 1080, 1350, 200000)",
				event, position, renderPath(event, position)));
	}

	List<Map<String, Object>> pastPosts(long approvalEvent) {
		return jdbc.queryForList("select position, past_post_id, cover_storage_path from approval_past_posts where approval_event_id = ? order by position",
				approvalEvent);
	}

	/** 例外の SQLSTATE とメッセージを確かめる（DB が返した拒否の理由） */
	void assertRejected(ThrowingCallable call, String sqlState, String message) {
		assertThatThrownBy(call).rootCause()
				.isInstanceOfSatisfying(PSQLException.class, e -> assertThat(e.getSQLState()).isEqualTo(sqlState))
				.hasMessageContaining(message);
	}

	/** 管理者が背景写真を登録する */
	UUID registerPhoto(String description) {
		String path = tenant + "/backgrounds/" + UUID.randomUUID() + ".jpg";
		return db.as(admin, j -> j.queryForObject("select public.register_background_photo(?, ?)", UUID.class, path, description));
	}

	/** 初版の本文（差し込み値が正しくそろった本文として、新しい版の作成に使う） */
	String initialBody(String purpose) {
		return jdbc.queryForObject("select app.initial_prompt_body(?)", String.class, purpose);
	}

	/** プロンプトの初版を入れ、ネタ1件・生成1件（PLAN・API）を service role で記録する。戻り値は生成ID */
	UUID recordGeneration(String outcome) {
		jdbc.queryForList("select app.seed_initial_prompts(?)", tenant);
		UUID prompt = jdbc.queryForObject("select prompt_version_id from active_prompt_versions where tenant_id = ? and purpose = 'PLAN'",
				UUID.class, tenant);
		UUID idea = UUID.randomUUID();
		db.asServiceRole(j -> j.queryForList("select public.record_idea(?, ?, ?, 'ネタの本文')", idea, tenant, editor.memberId()));
		UUID id = UUID.randomUUID();
		String result = "SUCCEEDED".equals(outcome) ? "{\"caption\":\"本文\"}" : null;
		db.asServiceRole(j -> j.queryForList(
				"select public.record_generation(?, ?, ?, 'PLAN', 'API', ?, ?, '{\"ideaText\":\"ネタの本文\"}'::jsonb, ?, "
						+ "'[{\"model\":\"gemini\",\"rawOutput\":\"{}\",\"violations\":[]}]'::jsonb, ?::jsonb, null, null)",
				id, tenant, editor.memberId(), idea, prompt, outcome, result));
		return id;
	}

	/** 画像生成の記録（REQ-005）。素材画像としての採用の検査に使う */
	UUID recordImageGeneration(UUID forTenant, UUID member, String style, String outcome, int candidates) {
		UUID id = UUID.randomUUID();
		db.asServiceRole(j -> j.queryForList(
				"select public.record_image_generation(?, ?, ?, ?, '桜並木', 'cherry blossoms', 'CLOUDFLARE_WORKERS_AI', 'flux', ?, ?)",
				id, forTenant, member, style, outcome, candidates));
		return id;
	}
}
