package jp.co.keai.niijimaig.database;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.support.TransactionTemplate;

import jp.co.keai.niijimaig.TestcontainersConfiguration;
import jp.co.keai.niijimaig.support.SupabaseFixture;
import jp.co.keai.niijimaig.support.SupabaseFixture.LoggedIn;

/** 画像生成の記録・回数・候補の採用を DB で確かめる（REQ-005 設計 5章、V8） */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@ActiveProfiles("test")
class ImageGenerationDatabaseTest {

	static final String RECORD = "select public.record_image_generation(?, ?, ?, ?, '桜並木', 'cherry blossoms', 'CLOUDFLARE_WORKERS_AI', 'flux', ?, ?)";

	@Autowired JdbcTemplate jdbc;
	@Autowired TransactionTemplate tx;

	SupabaseFixture db;
	UUID tenant;
	LoggedIn editor;

	@BeforeEach
	void setUp() {
		db = new SupabaseFixture(jdbc, tx);
		String suffix = UUID.randomUUID().toString().substring(0, 8);
		tenant = db.tenant("新島info-" + suffix);
		jdbc.update("insert into image_generation_settings (tenant_id, version, provider, model, daily_limit, warn_ratio) "
				+ "values (?, 1, 'CLOUDFLARE_WORKERS_AI', '@cf/black-forest-labs/flux-1-schnell', 20, 0.80)", tenant);
		editor = db.member(tenant, "editor-" + suffix + "@example.com", "EDITOR");
	}

	@Test
	@DisplayName("NFR-005-03 AC-005-06 回数の確保は同時に30回呼ばれても上限（20回）を超えない")
	void reservationNeverExceedsLimit() throws Exception {
		ExecutorService pool = Executors.newFixedThreadPool(8);
		List<Callable<Boolean>> calls = new ArrayList<>();
		for (int i = 0; i < 30; i++) {
			calls.add(() -> db.asServiceRole(j -> j.queryForObject(
					"select allowed from public.try_consume_image_generation(?, 20)", Boolean.class, tenant)));
		}
		long allowed = 0;
		for (Future<Boolean> f : pool.invokeAll(calls)) {
			allowed += f.get() ? 1 : 0;
		}
		pool.shutdown();

		Map<String, Object> usage = db.as(editor, j -> j.queryForMap("select * from public.image_generation_usage()"));
		assertThat(allowed).isEqualTo(20);
		assertThat(usage).containsEntry("used", 20).containsEntry("daily_limit", 20);
	}

	@Test
	@DisplayName("AC-005-06 回数の日は UTC の日付（日本時間 9:00 区切り）で、前日の回数は数えない")
	void usageDayIsUtcDate() {
		jdbc.update("insert into image_generation_usage_daily (tenant_id, usage_date, count) values (?, (now() at time zone 'UTC')::date - 1, 20)", tenant);

		int used = db.as(editor, j -> j.queryForObject("select used from public.image_generation_usage()", Integer.class));
		boolean allowed = db.asServiceRole(j -> j.queryForObject("select allowed from public.try_consume_image_generation(?, 20)", Boolean.class, tenant));
		Boolean day = jdbc.queryForObject("select app.image_generation_day() = (now() at time zone 'UTC')::date", Boolean.class);

		assertThat(used).isZero();
		assertThat(allowed).isTrue();
		assertThat(day).isTrue();
	}

	@Test
	@DisplayName("AC-005-12 候補の参照を付けて保存すると候補の採用が記録され、写真風の生成画像として導出される")
	void adoptionIsRecordedWithRevision() {
		UUID generation = recordGeneration("PHOTOREALISTIC", "SUCCEEDED", 4);

		UUID post = saveDraft(mediaJson(1, generation, 3));

		List<Map<String, Object>> origin = db.as(editor, j -> j.queryForList(
				"select o.style, o.candidate_position from post_media_origin o join post_current c on c.revision_id = o.revision_id where c.post_id = ?", post));
		assertThat(origin).hasSize(1);
		assertThat(origin.get(0)).containsEntry("style", "PHOTOREALISTIC").containsEntry("candidate_position", 3);
	}

	@Test
	@DisplayName("AC-005-12 候補の参照が不正（位置が範囲外・失敗した画像生成・他団体）なら保存できない")
	void invalidCandidateReferenceIsRejected() {
		UUID twoCandidates = recordGeneration("ILLUSTRATION", "SUCCEEDED", 2);
		UUID failed = recordGeneration("ILLUSTRATION", "FAILED", 0);
		UUID otherTenant = db.tenant("他団体-" + UUID.randomUUID());
		LoggedIn outsider = db.member(otherTenant, "other-" + UUID.randomUUID() + "@example.com", "ADMIN");
		UUID foreign = UUID.randomUUID();
		db.asServiceRole(j -> j.queryForList(RECORD, foreign, otherTenant, outsider.memberId(), "ILLUSTRATION", "SUCCEEDED", 4));

		for (String media : List.of(mediaJson(1, twoCandidates, 3), mediaJson(1, failed, 1), mediaJson(1, foreign, 1))) {
			assertThatThrownBy(() -> saveDraft(media)).rootCause().hasMessageContaining("候補の参照が正しくありません");
		}
	}

	@Test
	@DisplayName("AC-005-12 投稿画像の保存先は自団体の posts/ に限る（候補の保存先 candidates/ は使えない）")
	void mediaMustBeUnderPosts() {
		String media = "[{\"position\":1,\"storagePath\":\"" + tenant + "/candidates/x/1.jpg\",\"width\":819,\"height\":1024,\"byteSize\":1}]";

		assertThatThrownBy(() -> saveDraft(media)).rootCause().hasMessageContaining("保存先が正しくありません");
	}

	@Test
	@DisplayName("AC-005-17 画像生成と候補の採用の記録は画面から変更・削除できず、記録は追記のみ")
	void recordsAreAppendOnly() {
		UUID generation = recordGeneration("ILLUSTRATION", "SUCCEEDED", 4);

		db.as(editor, j -> j.update("delete from image_generations where id = ?", generation));
		int remaining = jdbc.queryForObject("select count(*) from image_generations where id = ?", Integer.class, generation);
		assertThat(remaining).isEqualTo(1);
		assertThatThrownBy(() -> jdbc.update("update image_generations set outcome = 'FAILED', candidate_count = 0 where id = ?", generation))
				.rootCause().hasMessageContaining("append-only");
	}

	@Test
	@DisplayName("NFR-001-05 他団体の画像生成は読めず、画面からは記録できない")
	void otherTenantCannotRead() {
		UUID generation = recordGeneration("ILLUSTRATION", "SUCCEEDED", 4);
		UUID otherTenant = db.tenant("他団体-" + UUID.randomUUID());
		LoggedIn outsider = db.member(otherTenant, "other-" + UUID.randomUUID() + "@example.com", "ADMIN");

		int visible = db.as(outsider, j -> j.queryForObject("select count(*) from image_generations where id = ?", Integer.class, generation));
		assertThat(visible).isZero();
		assertThatThrownBy(() -> db.as(editor, j -> j.queryForList(RECORD, UUID.randomUUID(), tenant, editor.memberId(), "ILLUSTRATION", "SUCCEEDED", 4)))
				.rootCause().hasMessageContaining("permission denied");
	}

	private UUID recordGeneration(String style, String outcome, int candidates) {
		UUID id = UUID.randomUUID();
		db.asServiceRole(j -> j.queryForList(RECORD, id, tenant, editor.memberId(), style, outcome, candidates));
		return id;
	}

	private String mediaJson(int position, UUID generation, int candidatePosition) {
		return "[{\"position\":" + position + ",\"storagePath\":\"" + tenant + "/posts/" + UUID.randomUUID()
				+ ".jpg\",\"width\":819,\"height\":1024,\"byteSize\":400000,\"generation\":{\"generationId\":\"" + generation
				+ "\",\"candidatePosition\":" + candidatePosition + "}}]";
	}

	private UUID saveDraft(String mediaArray) {
		String revision = "{\"format\":\"FEED_IMAGE\",\"mediaSource\":\"UPLOAD\",\"caption\":\"本文\",\"prCategory\":\"NONE\",\"media\":" + mediaArray + "}";
		return db.as(editor, j -> j.queryForObject("select post_id from public.save_post_revision(null, ?::jsonb)", UUID.class, revision));
	}
}
