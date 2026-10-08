package jp.co.keai.niijimaig.database;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import jp.co.keai.niijimaig.TestcontainersConfiguration;
import jp.co.keai.niijimaig.support.SupabaseFixture.LoggedIn;

/** V10 のレビュー指摘の修正を DB で確かめる（REQ-002 設計 4・5章）: 権限・差し込み値・生成の記録の整合・承認の出来事・過去の投稿の選び方・保存の形 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@ActiveProfiles("test")
class DraftHardeningDatabaseTest extends DraftDatabaseSupport {

	static final Instant BASE = Instant.parse("2026-09-01T00:00:00Z");
	static final String INSERT_OBJECT = "insert into storage.objects (bucket_id, name) values ('uploads-private', ?)";

	// ───────── 権限 ─────────

	private void asAnon(Consumer<JdbcTemplate> work) {
		tx.execute(status -> {
			jdbc.execute("set local role anon");
			work.accept(jdbc);
			return null;
		});
	}

	@Test
	@DisplayName("NFR-001-05 anon（ログインしていない人）は、REQ-002 の新しい表・ビューを読めず、新しい RPC も使えない")
	void anonCannotUseNewTablesViewsOrRpcs() {
		List<String> relations = List.of("ideas", "prompt_versions", "prompt_activations", "generations", "generation_attempts", "generation_results",
				"generation_revisions", "post_style_settings", "post_style_logos", "background_photos", "background_photo_retirements", "template_releases",
				"revision_templates", "revision_generations", "post_slides", "cover_slides", "cover_backgrounds", "body_slides", "body_emphases",
				"body_materials", "material_adoptions", "revision_hashtags", "approval_past_posts", "template_renders", "template_publish_media",
				"active_prompt_versions", "post_style_settings_current", "usable_background_photos", "revision_generated_styles");
		for (String relation : relations) {
			assertRejected(() -> asAnon(j -> j.queryForObject("select count(*) from " + relation, Integer.class)), "42501", "permission denied");
		}
		List<String> rpcs = List.of(
				"select public.register_background_photo('x', 'y')",
				"select public.retire_background_photo(gen_random_uuid())",
				"select public.save_post_style_settings('a', '{a}'::text[], 'a', 'a', 'a', '{}'::text[], null)",
				"select public.create_prompt_version('PLAN', 'x')",
				"select public.activate_prompt_version(gen_random_uuid())",
				"select public.record_idea(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x')",
				"select public.record_generation(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'PLAN', 'API', gen_random_uuid(), gen_random_uuid(),"
						+ " '{}'::jsonb, 'TIMEOUT', '[]'::jsonb, null, null, null)",
				"select public.record_template_render(gen_random_uuid(), 1, 1, 'x', 1, 1, 1)",
				"select public.record_template_publish_media(gen_random_uuid(), 1, 1, 'x', 1, 1, 1)");
		for (String rpc : rpcs) {
			assertRejected(() -> asAnon(j -> j.queryForList(rpc)), "42501", "permission denied");
		}
	}

	@Test
	@DisplayName("AC-001-02 無効化した管理者は、管理者の RPC（背景写真・投稿の型の設定・プロンプト版）を使えない")
	void deactivatedAdminCannotUseAdminRpcs() {
		LoggedIn second = db.member(tenant, "admin2-" + UUID.randomUUID() + "@example.com", "ADMIN");
		db.as(admin, j -> j.queryForList("select public.deactivate_member(?, '交代')", second.memberId()));
		String body = initialBody("PLAN");
		String path = tenant + "/backgrounds/" + UUID.randomUUID() + ".jpg";

		assertRejected(() -> db.as(second, j -> j.queryForObject("select public.register_background_photo(?, 'x')", UUID.class, path)), "42501", "利用が許可されていません");
		assertRejected(() -> db.as(second, j -> j.queryForList("select public.retire_background_photo(gen_random_uuid())")), "42501", "利用が許可されていません");
		assertRejected(() -> db.as(second, j -> j.queryForObject("select public.create_prompt_version('PLAN', ?)", UUID.class, body)), "42501", "利用が許可されていません");
		assertRejected(() -> db.as(second, j -> j.queryForList("select public.activate_prompt_version(gen_random_uuid())")), "42501", "利用が許可されていません");
		assertRejected(() -> db.as(second, j -> j.queryForObject(
				"select public.save_post_style_settings('a', '{a}'::text[], 'a', 'a', 'a', '{}'::text[], null)", Integer.class)), "42501", "利用が許可されていません");
	}

	// ───────── プロンプト版 ─────────

	@Test
	@DisplayName("AC-002-21 既存の団体がある状態で初版を入れる処理（V10 の末尾と同じ文）を実行すると、全団体に PLAN・REVISE の初版が入って有効になる")
	void initialPromptsAreSeededForAllExistingTenants() {
		UUID first = db.tenant("既存団体-" + UUID.randomUUID());
		UUID second = db.tenant("既存団体-" + UUID.randomUUID());

		jdbc.queryForList("select app.seed_initial_prompts(t.id) from tenants t");

		for (UUID t : List.of(tenant, first, second)) {
			assertThat(jdbc.queryForList("select purpose from active_prompt_versions where tenant_id = ? and version_no = 1 order by purpose", String.class, t))
					.as(t.toString()).containsExactly("PLAN", "REVISE");
		}
	}

	@Test
	@DisplayName("AC-002-08 プロンプト版を作るとき、用途の必須の差し込み値がそろっていなければ、また知らない差し込み値があれば拒否される")
	void promptPlaceholdersAreChecked() {
		String plan = initialBody("PLAN");
		String revise = initialBody("REVISE");
		String create = "select public.create_prompt_version(?, ?)";

		assertThat(db.<UUID>as(admin, j -> j.queryForObject(create, UUID.class, "PLAN", plan))).isNotNull();
		assertThat(db.<UUID>as(admin, j -> j.queryForObject(create, UUID.class, "REVISE", revise))).isNotNull();
		assertThat(db.<UUID>as(admin, j -> j.queryForObject(create, UUID.class, "CAPTION", "{{today}} {{ideaText}}"))).isNotNull();

		assertRejected(() -> db.as(admin, j -> j.queryForObject(create, UUID.class, "PLAN", plan.replace("{{limits}}", ""))), "22023", "{{limits}}");
		assertRejected(() -> db.as(admin, j -> j.queryForObject(create, UUID.class, "PLAN", plan.replace("{{backgroundPhotos}}", ""))), "22023", "{{backgroundPhotos}}");
		assertRejected(() -> db.as(admin, j -> j.queryForObject(create, UUID.class, "REVISE", revise.replace("{{instruction}}", ""))), "22023", "{{instruction}}");
		assertRejected(() -> db.as(admin, j -> j.queryForObject(create, UUID.class, "PLAN", plan + "{{unknownValue}}")), "22023", "{{unknownValue}}");
		assertRejected(() -> db.as(admin, j -> j.queryForObject(create, UUID.class, "PLAN", revise)), "22023", "差し込み値");
		assertRejected(() -> db.as(admin, j -> j.queryForObject(create, UUID.class, "REVISE", plan)), "22023", "{{currentDraft}}");
		assertRejected(() -> db.as(admin, j -> j.queryForObject(create, UUID.class, "REVISE", revise + "{{backgroundPhotos}}")), "22023", "{{backgroundPhotos}}");
		assertRejected(() -> db.as(admin, j -> j.queryForObject(create, UUID.class, "CAPTION", "{{nope}}")), "22023", "{{nope}}");
	}

	// ───────── 生成の記録 ─────────

	private static final String RECORD = "select public.record_generation(?, ?, ?, ?, ?, ?, ?, '{}'::jsonb, ?, ?::jsonb, ?::jsonb, ?::uuid, ?::text)";
	private static final String ONE_ATTEMPT = "[{\"model\":\"m\",\"rawOutput\":\"x\",\"violations\":[]}]";

	private void record(String purpose, String route, UUID idea, UUID prompt, String outcome, String attempts, String result, UUID parent, String instruction) {
		db.asServiceRole(j -> j.queryForList(RECORD, UUID.randomUUID(), tenant, editor.memberId(), purpose, route, idea, prompt, outcome, attempts, result, parent, instruction));
	}

	@Test
	@DisplayName("BR-002-08 修正指示（REVISE）は親の生成が必須で、それ以外は親を持たない。親は同じネタの生成に限る")
	void revisionRequiresParentOfSameIdea() {
		UUID parent = recordGeneration("SUCCEEDED");
		UUID idea = jdbc.queryForObject("select idea_id from generations where id = ?", UUID.class, parent);
		UUID revisePrompt = jdbc.queryForObject("select prompt_version_id from active_prompt_versions where tenant_id = ? and purpose = 'REVISE'", UUID.class, tenant);
		UUID planPrompt = jdbc.queryForObject("select prompt_version_id from active_prompt_versions where tenant_id = ? and purpose = 'PLAN'", UUID.class, tenant);
		UUID otherIdea = UUID.randomUUID();
		db.asServiceRole(j -> j.queryForList("select public.record_idea(?, ?, ?, '別のネタ')", otherIdea, tenant, editor.memberId()));

		assertRejected(() -> record("REVISE", "API", idea, revisePrompt, "TIMEOUT", "[]", null, null, null), "22023", "親の生成");
		assertRejected(() -> record("PLAN", "API", idea, planPrompt, "TIMEOUT", "[]", null, parent, "直して"), "22023", "親の生成");
		assertRejected(() -> record("REVISE", "API", otherIdea, revisePrompt, "TIMEOUT", "[]", null, parent, "直して"), "22023", "ネタが違います");

		record("REVISE", "API", idea, revisePrompt, "TIMEOUT", "[]", null, parent, "直して");
		record("REVISE", "MANUAL", idea, revisePrompt, "SUCCEEDED", "[]", "{}", parent, "直して");
		assertThat(jdbc.queryForObject("select count(*) from generation_revisions where parent_generation_id = ?", Integer.class, parent)).isEqualTo(2);
	}

	@Test
	@DisplayName("BR-002-08 API 経由で出力を得た生成（SUCCEEDED・INVALID_OUTPUT）には、LLM の呼び出しの記録が1回以上ある。出力を得ていない失敗と手動コピペは呼び出しが無くてよい")
	void apiOutputRequiresAttempt() {
		UUID generation = recordGeneration("SUCCEEDED");
		UUID idea = jdbc.queryForObject("select idea_id from generations where id = ?", UUID.class, generation);
		UUID planPrompt = jdbc.queryForObject("select prompt_version_id from active_prompt_versions where tenant_id = ? and purpose = 'PLAN'", UUID.class, tenant);

		assertRejected(() -> record("PLAN", "API", idea, planPrompt, "SUCCEEDED", "[]", "{}", null, null), "22023", "LLM 呼び出し");
		assertRejected(() -> record("PLAN", "API", idea, planPrompt, "INVALID_OUTPUT", "[]", null, null, null), "22023", "LLM 呼び出し");

		record("PLAN", "API", idea, planPrompt, "INVALID_OUTPUT", ONE_ATTEMPT, null, null, null);
		for (String outcome : List.of("LLM_ERROR", "QUOTA_EXCEEDED", "TIMEOUT")) {
			record("PLAN", "API", idea, planPrompt, outcome, "[]", null, null, null);
		}
		record("PLAN", "MANUAL", idea, planPrompt, "SUCCEEDED", "[]", "{}", null, null);
	}

	// ───────── 承認の出来事 ─────────

	private void publishMedia(UUID revision, long event) {
		db.asServiceRole(j -> j.queryForList("select public.record_template_publish_media(?, ?, 1, ?, 1080, 1350, 1)",
				revision, event, tenant + "/" + UUID.randomUUID() + ".jpg"));
	}

	@Test
	@DisplayName("AC-002-02 画像化・公開用画像は、アップロードの版の承認の出来事には記録できない（TEMPLATE の版だけ）")
	void rendersAreRejectedForUploadRevision() {
		UUID post = save(editor, uploadRevision());
		UUID revision = latestRevision(post);
		long event = approve(post);

		assertRejected(() -> recordRender(event, 1), "P0404", "承認の出来事");
		assertRejected(() -> publishMedia(revision, event), "P0404", "承認の出来事");
	}

	@Test
	@DisplayName("AC-002-02 承認の出来事がその投稿の最新の承認でなければ（再承認のあとの古い承認）、画像化・公開用画像は記録できない")
	void rendersAreRejectedForSupersededApproval() {
		configureStyle();
		UUID post = save(editor, simpleTemplate());
		UUID revision = latestRevision(post);
		long first = approve(post);
		db.as(approver, j -> j.queryForList("select public.cancel_schedule(?)", post));
		UUID second = saveAgain(editor, post, simpleTemplate());
		long latest = approve(post);

		assertRejected(() -> recordRender(first, 1), "P0404", "承認の出来事");
		assertRejected(() -> publishMedia(revision, first), "P0404", "承認の出来事");
		recordRender(latest, 1);
		publishMedia(second, latest);
		assertThat(jdbc.queryForObject("select count(*) from template_renders where approval_event_id = ?", Integer.class, latest)).isEqualTo(1);
	}

	// ───────── 過去の投稿 ─────────

	@Test
	@DisplayName("AC-002-15 表紙の無い過去の投稿（画像化の記録が無い）は飛ばして、その次に新しい投稿を選ぶ。表紙のある投稿が2件見つかったら止める")
	void pastPostsWithoutCoverAreSkipped() {
		configureStyle();
		UUID older = publishedUploadPost(BASE);
		UUID old = publishedUploadPost(BASE.plus(1, ChronoUnit.DAYS));
		UUID oldest = publishedUploadPost(BASE.minus(1, ChronoUnit.DAYS));
		UUID noRender = save(editor, simpleTemplate());
		approve(noRender);                                                    // 画像化の記録を残さないまま公開済みにする（表紙が無い）
		publish(noRender, BASE.plus(3, ChronoUnit.DAYS));
		UUID target = save(editor, simpleTemplate());

		long event = approve(target);

		assertThat(pastPosts(event)).extracting(p -> p.get("past_post_id")).containsExactly(old, older);
		assertThat(pastPosts(event)).extracting(p -> p.get("position")).containsExactly(1, 2);
		assertThat(pastPosts(event)).extracting(p -> p.get("past_post_id")).doesNotContain(noRender, oldest);
	}

	@Test
	@DisplayName("AC-002-15 公開済みの投稿がすべて表紙の無い投稿なら、過去の投稿は記録されない")
	void noPastPostsWhenNoneHasCover() {
		configureStyle();
		UUID noRender = save(editor, simpleTemplate());
		approve(noRender);
		publish(noRender, BASE);
		UUID target = save(editor, simpleTemplate());

		assertThat(pastPosts(approve(target))).isEmpty();
	}

	// ───────── 保存の形 ─────────

	@Test
	@DisplayName("BR-002-11 ハッシュタグ（hashtags）が配列でない、または要素が文字列でない形は保存できない")
	void malformedHashtagsAreRejected() {
		configureStyle();
		String valid = "[\"#学割\",\"#京都\"]";
		for (String hashtags : List.of("\"#学割\"", "{\"a\":1}", "5", "null", "[1]", "[null]", "[[\"#a\"]]", "[\"#a\",{\"b\":1}]")) {
			String json = template("niijima@1", "", cover(""), body("説明", "[]", null), closing()).replace(valid, hashtags);
			assertRejected(() -> save(editor, json), "22023", "ハッシュタグ");
		}
		assertThat(jdbc.queryForObject("select count(*) from posts where tenant_id = ?", Integer.class, tenant)).isZero();
	}

	@Test
	@DisplayName("BR-002-11 アップロードの保存では、テンプレート用の項目（templateVersion・slides・hashtags・generationId）を無視する")
	void uploadSaveIgnoresTemplateFields() {
		UUID generation = recordGeneration("SUCCEEDED");
		String json = uploadRevision().replace("\"format\":\"FEED_IMAGE\"", "\"format\":\"FEED_IMAGE\",\"templateVersion\":\"niijima@1\",\"hashtags\":[\"#a\"],"
				+ "\"slides\":[{\"role\":\"COVER\"}],\"generationId\":\"" + generation + "\"");

		UUID post = save(editor, json);

		UUID revision = latestRevision(post);
		assertThat(jdbc.queryForObject("select count(*) from post_media where revision_id = ?", Integer.class, revision)).isEqualTo(1);
		for (String table : List.of("revision_templates", "revision_generations", "revision_hashtags", "post_slides")) {
			assertThat(jdbc.queryForObject("select count(*) from " + table + " where revision_id = ?", Integer.class, revision)).as(table).isZero();
		}
	}

	@Test
	@DisplayName("BR-002-11 post_revisions.generation_id は REQ-002 では使わない（常に NULL）ことが列のコメントに書かれている")
	void legacyGenerationColumnIsDocumented() {
		String comment = jdbc.queryForObject("select col_description('post_revisions'::regclass, "
				+ "(select attnum from pg_attribute where attrelid = 'post_revisions'::regclass and attname = 'generation_id'))", String.class);

		assertThat(comment).contains("使わない").contains("revision_generations");
	}

	// ───────── Storage ─────────

	@Test
	@DisplayName("BR-002-21 Storage: 背景写真は backgrounds/{ファイル名}.jpg、ロゴは style/{ファイル名}.png か .jpg の形だけ、自団体の管理者が置ける")
	void storagePathShapeIsRestricted() {
		db.as(admin, j -> j.update(INSERT_OBJECT, tenant + "/backgrounds/" + UUID.randomUUID() + ".jpg"));
		db.as(admin, j -> j.update(INSERT_OBJECT, tenant + "/style/" + UUID.randomUUID() + ".png"));
		db.as(admin, j -> j.update(INSERT_OBJECT, tenant + "/style/" + UUID.randomUUID() + ".jpg"));

		for (String path : List.of(tenant + "/backgrounds/a.png", tenant + "/backgrounds/a/b.jpg", tenant + "/backgrounds/../posts/a.jpg",
				tenant + "/backgrounds/a b.jpg", tenant + "/backgrounds/", tenant + "/style/a.gif", tenant + "/style/a/b.png", tenant + "/style/a.png.exe",
				tenant + "/backgrounds/a.jpg/x")) {
			assertRejected(() -> db.as(admin, j -> j.update(INSERT_OBJECT, path)), "42501", "row-level security");
		}
	}
}
