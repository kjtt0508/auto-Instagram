package jp.co.keai.niijimaig.database;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import jp.co.keai.niijimaig.TestcontainersConfiguration;
import jp.co.keai.niijimaig.support.SupabaseFixture.LoggedIn;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** プロンプト版・生成の記録・LLM 利用回数・RLS を DB で確かめる（REQ-002 設計 1・5章、V10） */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@ActiveProfiles("test")
class PromptAndGenerationDatabaseTest extends DraftDatabaseSupport {

	static final String ACTIVE ="select version_no, body from active_prompt_versions where tenant_id = ? and purpose = ?";

	@Test
	@DisplayName("AC-002-21 プロンプトの初版（PLAN・REVISE）は、絵の指示に固有名詞・商標・実在の人物を入れない・差し替えが必要の印を付ける・ネタに無い事実を書かない、の指示を含む")
	void initialPromptsContainRequiredInstructions() {
		jdbc.queryForList("select app.seed_initial_prompts(?)", tenant);

		for (String purpose : List.of("PLAN", "REVISE")) {
			Map<String, Object> active = db.as(editor, j -> j.queryForMap(ACTIVE, tenant, purpose));
			String body = (String) active.get("body");

			assertThat(active.get("version_no")).as(purpose).isEqualTo(1);
			assertThat(body).as(purpose).contains("絵の指示に固有名詞・商標・実在の人物を入れない")
					.contains("needsReplacement を true にして差し替えが必要の印を付ける")
					.contains("ネタに無い事実を書かないこと")
					.contains("{{ideaText}}");
			assertThat(body).as(purpose + " は団体の文面を含まない").doesNotContain("新島").doesNotContain("同志社");
				assertThat(body).as(purpose + " は団体によらない言い方（前置き・締めの言葉の例を書かない）")
						.doesNotContain("大学生向けSNSメディア").doesNotContain("まとめたよ").doesNotContain("紹介します");
				assertThat(body.replaceAll("\\{\\{[^{}]*}}", "")).as(purpose + " は文字数・個数の上限を数値で書かない（{{limits}} に任せる）")
						.doesNotContainPattern("[0-9０-９]");
				assertThat(body).as(purpose + " は帯の色の例を二重に書かない（{{accentColors}} だけ）").contains("{{accentColors}}")
						.doesNotContain("PURPLE").doesNotContain("TEAL");
				assertThat(body).as(purpose).contains("{{limits}}").contains("{{coverTargets}}")
						.contains("picturePrompt").contains("needsReplacement").doesNotContain("pictureBrief");
		}
		assertThat(db.<String>as(editor, j -> j.queryForObject(ACTIVE.replace("version_no, body", "body"), String.class, tenant, "PLAN"))).contains("{{backgroundPhotos}}");
		assertThat(db.<String>as(editor, j -> j.queryForObject(ACTIVE.replace("version_no, body", "body"), String.class, tenant, "REVISE"))).contains("{{instruction}}");
		assertThat(db.<List<Map<String, Object>>>as(editor, j -> j.queryForList("select 1 from active_prompt_versions where tenant_id = ? and purpose = 'CAPTION'", tenant))).isEmpty();
	}

	@Test
	@DisplayName("AC-002-21 初版を入れる処理は繰り返しても版を増やさない。すでに版がある用途には入れない")
	void seedingIsIdempotent() {
		jdbc.queryForList("select app.seed_initial_prompts(?)", tenant);
		jdbc.queryForList("select app.seed_initial_prompts(?)", tenant);

		assertThat(jdbc.queryForObject("select count(*) from prompt_versions where tenant_id = ?", Integer.class, tenant)).isEqualTo(2);
		assertThat(jdbc.queryForObject("select count(*) from prompt_activations a join prompt_versions v on v.id = a.prompt_version_id where v.tenant_id = ?",
				Integer.class, tenant)).isEqualTo(2);
	}

	@Test
	@DisplayName("AC-002-08 本文を変えて新しい版を作って有効にすると、版が連番で増えて新しい版が有効になり、前の版は無効として残る")
	void newPromptVersionBecomesActive() {
		jdbc.queryForList("select app.seed_initial_prompts(?)", tenant);
		UUID first = jdbc.queryForObject("select prompt_version_id from active_prompt_versions where tenant_id = ? and purpose = 'PLAN'", UUID.class, tenant);

		String newBody = initialBody("PLAN") + "\n- 新しい指示";
		UUID second = db.as(admin, j -> j.queryForObject("select public.create_prompt_version('PLAN', ?)", UUID.class, newBody));
		assertThat(db.<Integer>as(editor, j -> j.queryForObject(ACTIVE, (rs, i) -> rs.getInt("version_no"), tenant, "PLAN"))).isEqualTo(1);
		db.as(admin, j -> j.queryForList("select public.activate_prompt_version(?)", second));

		Map<String, Object> active = db.as(editor, j -> j.queryForMap(ACTIVE, tenant, "PLAN"));
		assertThat(active).containsEntry("version_no", 2).containsEntry("body", newBody);
		assertThat(jdbc.queryForList("select version_no from prompt_versions where tenant_id = ? and purpose = 'PLAN' order by version_no", Integer.class, tenant))
				.containsExactly(1, 2);
		assertThat(jdbc.queryForObject("select body from prompt_versions where id = ?", String.class, first)).contains("ネタに無い事実を書かないこと");
		assertThat(db.<Integer>as(editor, j -> j.queryForObject(ACTIVE.replace("version_no, body", "version_no"), Integer.class, tenant, "REVISE"))).isEqualTo(1);

		db.as(admin, j -> j.queryForList("select public.activate_prompt_version(?)", first));
		assertThat(db.<Integer>as(editor, j -> j.queryForObject(ACTIVE.replace("version_no, body", "version_no"), Integer.class, tenant, "PLAN"))).isEqualTo(1);
		db.as(admin, j -> j.queryForList("select public.activate_prompt_version(?)", first));
		assertThat(jdbc.queryForObject("select count(*) from prompt_activations where prompt_version_id = ?", Integer.class, first)).isEqualTo(2);
		assertRejected(() -> jdbc.update("update prompt_versions set body = 'x' where id = ?", first), "P0405", "append-only");
	}

	@Test
	@DisplayName("AC-002-08 プロンプト版の作成・有効化は管理者だけ。用途・本文が不正、他団体の版は拒否される")
	void promptRpcsAreAdminOnlyAndValidated() {
		jdbc.queryForList("select app.seed_initial_prompts(?)", tenant);
		UUID version = jdbc.queryForObject("select prompt_version_id from active_prompt_versions where tenant_id = ? and purpose = 'REVISE'", UUID.class, tenant);
		UUID otherTenant = db.tenant("他団体-" + UUID.randomUUID());
		LoggedIn outsider = db.member(otherTenant, "other-" + UUID.randomUUID() + "@example.com", "ADMIN");

		for (LoggedIn user : List.of(editor, approver)) {
			assertRejected(() -> db.as(user, j -> j.queryForObject("select public.create_prompt_version('PLAN', 'x')", UUID.class)), "42501", "権限がありません");
			assertRejected(() -> db.as(user, j -> j.queryForList("select public.activate_prompt_version(?)", version)), "42501", "権限がありません");
		}
		assertRejected(() -> db.as(admin, j -> j.queryForObject("select public.create_prompt_version('UNKNOWN', 'x')", UUID.class)), "22023", "用途");
		assertRejected(() -> db.as(admin, j -> j.queryForObject("select public.create_prompt_version('PLAN', '')", UUID.class)), "22023", "本文");
		assertRejected(() -> db.as(outsider, j -> j.queryForList("select public.activate_prompt_version(?)", version)), "P0404", "見つかりません");
		assertThat(db.<List<Map<String, Object>>>as(outsider, j -> j.queryForList("select 1 from prompt_versions where id = ?", version))).isEmpty();
	}

	@Test
	@DisplayName("AC-002-03 差し込み値の検査は共通テストケース（fixtures/prompt-placeholders.json）と一致する（必須が欠ければ拒否・許されない名前は拒否・許される名前は通る）")
	void placeholderRulesMatchFixture() {
		JsonNode purposes = JsonMapper.builder().build().readTree(Path.of("../docs/model/fixtures/prompt-placeholders.json").toFile()).get("purposes");
		for (String purpose : List.of("PLAN", "REVISE", "CAPTION")) {
			List<String> required = names(purposes.get(purpose).get("required"));
			List<String> allowed = names(purposes.get(purpose).get("allowed"));
			String check = "select app.require_prompt_placeholders(?, ?)";

			jdbc.queryForList(check, purpose, body(required));
			for (String name : allowed) {
				jdbc.queryForList(check, purpose, body(required) + body(List.of(name)));
			}
			for (String name : required) {
				List<String> without = new ArrayList<>(required);
				without.remove(name);
				assertRejected(() -> jdbc.queryForList(check, purpose, body(without)), "22023", "{{" + name + "}}");
			}
			assertRejected(() -> jdbc.queryForList(check, purpose, body(required) + "{{notAllowedName}}"), "22023", "{{notAllowedName}}");
			for (String name : List.of("today", "ideaText", "coverTargets", "accentColors", "backgroundPhotos", "limits", "currentDraft", "instruction", "bodySlideCount")) {
				if (!allowed.contains(name)) {
					assertRejected(() -> jdbc.queryForList(check, purpose, body(required) + "{{" + name + "}}"), "22023", "{{" + name + "}}");
				}
			}
		}
	}

	private static List<String> names(JsonNode array) {
		List<String> result = new ArrayList<>();
		array.forEach(n -> result.add(n.asString()));
		return result;
	}

	private static String body(List<String> names) {
		return names.stream().map(n -> "{{" + n + "}}").collect(java.util.stream.Collectors.joining(" "));
	}

	@Test
	@DisplayName("AC-002-08 同時に版を作っても版番号は重ならず連番になる")
	void concurrentVersionCreationIsSerialized() throws Exception {
		jdbc.queryForList("select app.seed_initial_prompts(?)", tenant);
		String planBody = initialBody("PLAN");
		ExecutorService pool = Executors.newFixedThreadPool(4);
		List<Callable<UUID>> calls = new ArrayList<>();
		for (int i = 0; i < 8; i++) {
			calls.add(() -> db.as(admin, j -> j.queryForObject("select public.create_prompt_version('PLAN', ?)", UUID.class, planBody)));
		}
		for (Future<UUID> f : pool.invokeAll(calls)) {
			f.get();
		}
		pool.shutdown();

		assertThat(jdbc.queryForList("select version_no from prompt_versions where tenant_id = ? and purpose = 'PLAN' order by version_no", Integer.class, tenant))
				.containsExactly(1, 2, 3, 4, 5, 6, 7, 8, 9);
	}

	@Test
	@DisplayName("BR-002-08 生成は入力・LLM 呼び出し（作り直しは2行目）・成功した下書き案・修正指示とまとめて記録され、失敗も残る")
	void generationIsRecordedWithAttemptsAndRevision() {
		UUID parent = recordGeneration("SUCCEEDED");
		UUID prompt = jdbc.queryForObject("select prompt_version_id from active_prompt_versions where tenant_id = ? and purpose = 'REVISE'", UUID.class, tenant);
		UUID idea = jdbc.queryForObject("select idea_id from generations where id = ?", UUID.class, parent);
		UUID child = UUID.randomUUID();
		String attempts = "[{\"model\":\"m\",\"rawOutput\":\"x\",\"violations\":[\"cover.keyword は10文字以内\"]},{\"model\":\"m\",\"rawOutput\":\"{}\",\"violations\":[]}]";

		db.asServiceRole(j -> j.queryForList(
				"select public.record_generation(?, ?, ?, 'REVISE', 'API', ?, ?, '{}'::jsonb, 'SUCCEEDED', ?::jsonb, '{\"caption\":\"直した\"}'::jsonb, ?, 'もっとくだけて')",
				child, tenant, editor.memberId(), idea, prompt, attempts, parent));
		UUID quota = UUID.randomUUID();
		db.asServiceRole(j -> j.queryForList(
				"select public.record_generation(?, ?, ?, 'REVISE', 'API', ?, ?, '{}'::jsonb, 'QUOTA_EXCEEDED', '[]'::jsonb, null, ?, 'もっと短く')",
				quota, tenant, editor.memberId(), idea, prompt, parent));

		assertThat(jdbc.queryForList("select attempt_no from generation_attempts where generation_id = ? order by attempt_no", Integer.class, child)).containsExactly(1, 2);
		assertThat(jdbc.queryForObject("select parent_generation_id from generation_revisions where generation_id = ?", UUID.class, child)).isEqualTo(parent);
		assertThat(jdbc.queryForObject("select count(*) from generation_results where generation_id = ?", Integer.class, child)).isEqualTo(1);
		assertThat(jdbc.queryForObject("select outcome from generations where id = ?", String.class, quota)).isEqualTo("QUOTA_EXCEEDED");
		assertThat(jdbc.queryForObject("select count(*) from generation_attempts where generation_id = ?", Integer.class, quota)).isZero();
		assertThat(jdbc.queryForObject("select count(*) from generation_results where generation_id = ?", Integer.class, quota)).isZero();
	}

	@Test
	@DisplayName("BR-002-08 生成の記録は、参照（ネタ・プロンプト版・メンバー）が自団体で用途が合い、結果と下書き案が合っているときだけ受け付ける")
	void generationRecordIsValidated() {
		UUID parent = recordGeneration("SUCCEEDED");
		UUID prompt = jdbc.queryForObject("select prompt_version_id from active_prompt_versions where tenant_id = ? and purpose = 'PLAN'", UUID.class, tenant);
		UUID idea = jdbc.queryForObject("select idea_id from generations where id = ?", UUID.class, parent);
		UUID otherTenant = db.tenant("他団体-" + UUID.randomUUID());
		String call = "select public.record_generation(?, ?, ?, ?, ?, ?, ?, '{}'::jsonb, ?, ?::jsonb, ?::jsonb, null, null)";

		// 用途が違うプロンプト版・他団体のネタ・成功なのに下書き案が無い・失敗なのに下書き案がある・手動コピペなのに LLM 呼び出しがある
		assertRejected(() -> db.asServiceRole(j -> j.queryForList(call, UUID.randomUUID(), tenant, editor.memberId(), "REVISE", "API", idea, prompt, "TIMEOUT", "[]", null)),
				"22023", "生成の参照");
		assertRejected(() -> db.asServiceRole(j -> j.queryForList(call, UUID.randomUUID(), otherTenant, editor.memberId(), "PLAN", "API", idea, prompt, "TIMEOUT", "[]", null)),
				"22023", "生成の参照");
		assertRejected(() -> db.asServiceRole(j -> j.queryForList(call, UUID.randomUUID(), tenant, editor.memberId(), "PLAN", "API", idea, prompt, "SUCCEEDED", "[]", null)),
				"22023", "下書き案");
		assertRejected(() -> db.asServiceRole(j -> j.queryForList(call, UUID.randomUUID(), tenant, editor.memberId(), "PLAN", "API", idea, prompt, "TIMEOUT", "[]", "{}")),
				"22023", "下書き案");
		assertRejected(() -> db.asServiceRole(j -> j.queryForList(call, UUID.randomUUID(), tenant, editor.memberId(), "PLAN", "MANUAL", idea, prompt, "SUCCEEDED",
				"[{\"model\":\"m\",\"rawOutput\":\"x\",\"violations\":[]}]", "{}")), "22023", "LLM 呼び出し");
		assertThat(jdbc.queryForObject("select count(*) from generations where tenant_id = ?", Integer.class, tenant)).isEqualTo(1);
	}

	@Test
	@DisplayName("NFR-001-05 ネタ・生成・LLM 呼び出しは自団体のメンバーだけが読め、画面からは記録できず、記録は追記のみ")
	void generationRecordsAreIsolatedAndServiceRoleOnly() {
		UUID generation = recordGeneration("SUCCEEDED");
		UUID otherTenant = db.tenant("他団体-" + UUID.randomUUID());
		LoggedIn outsider = db.member(otherTenant, "other-" + UUID.randomUUID() + "@example.com", "ADMIN");

		for (String table : List.of("generations", "generation_attempts", "generation_results")) {
			String column = "generations".equals(table) ? "id" : "generation_id";
			assertThat(db.<Integer>as(editor, j -> j.queryForObject("select count(*) from " + table + " where " + column + " = ?", Integer.class, generation))).as(table).isEqualTo(1);
			assertThat(db.<Integer>as(outsider, j -> j.queryForObject("select count(*) from " + table + " where " + column + " = ?", Integer.class, generation))).as(table).isZero();
		}
		assertThat(db.<Integer>as(outsider, j -> j.queryForObject("select count(*) from ideas", Integer.class))).isZero();
		assertThat(db.<Integer>as(outsider, j -> j.queryForObject("select count(*) from prompt_versions where tenant_id = ?", Integer.class, tenant))).isZero();
		assertRejected(() -> db.as(editor, j -> j.queryForList("select public.record_idea(?, ?, ?, 'x')", UUID.randomUUID(), tenant, editor.memberId())),
				"42501", "permission denied");
		assertRejected(() -> db.as(admin, j -> j.update("insert into ideas (tenant_id, source, body, created_by) values (?, 'MEMO', 'x', ?)", tenant, admin.memberId())),
				"42501", "permission denied");
		assertRejected(() -> jdbc.update("insert into ideas (tenant_id, source, body, created_by) values (?, 'NEWS', 'x', ?)", tenant, admin.memberId()),
				"23514", "ideas_source_check");
		assertRejected(() -> jdbc.update("update generations set outcome = 'TIMEOUT' where id = ?", generation), "P0405", "append-only");
	}

	@Test
	@DisplayName("NFR-002-03 AC-002-10 LLM 利用回数の確保は同時に30回呼ばれても上限（20回）を超えず、モデルごとに数える")
	void llmReservationNeverExceedsLimit() throws Exception {
		ExecutorService pool = Executors.newFixedThreadPool(8);
		List<Callable<Boolean>> calls = new ArrayList<>();
		for (int i = 0; i < 30; i++) {
			calls.add(() -> db.asServiceRole(j -> j.queryForObject("select allowed from public.try_consume_llm(?, 'model-a', 20)", Boolean.class, tenant)));
		}
		long allowed = 0;
		for (Future<Boolean> f : pool.invokeAll(calls)) {
			allowed += f.get() ? 1 : 0;
		}
		pool.shutdown();

		assertThat(allowed).isEqualTo(20);
		assertThat(jdbc.queryForObject("select count from llm_usage_daily where tenant_id = ? and model = 'model-a'", Integer.class, tenant)).isEqualTo(20);
		Boolean otherModel = db.asServiceRole(j -> j.queryForObject("select allowed from public.try_consume_llm(?, 'model-b', 20)", Boolean.class, tenant));
		assertThat(otherModel).isTrue();
		Map<String, Object> over = db.asServiceRole(j -> j.queryForMap("select * from public.try_consume_llm(?, 'model-a', 20)", tenant));
		assertThat(over).containsEntry("allowed", false).containsEntry("used", 20);
	}
}
