package jp.co.keai.niijimaig.job.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.BeforeAll;
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
import jp.co.keai.niijimaig.connection.domain.AccessToken;
import jp.co.keai.niijimaig.connection.infrastructure.TokenCipher;
import jp.co.keai.niijimaig.job.domain.JobType;
import jp.co.keai.niijimaig.post.application.PostPublishing;
import jp.co.keai.niijimaig.post.domain.PostMedia;
import jp.co.keai.niijimaig.post.domain.PostRepository;
import jp.co.keai.niijimaig.support.ChromiumInstaller;
import jp.co.keai.niijimaig.support.FakeExternalsConfiguration;
import jp.co.keai.niijimaig.support.FakeExternalsConfiguration.FakeRenderStorage;
import jp.co.keai.niijimaig.support.FakeInstagram;
import jp.co.keai.niijimaig.support.SupabaseFixture;
import jp.co.keai.niijimaig.support.SupabaseFixture.LoggedIn;

/**
 * テンプレートの投稿の画像化と公開を、実際の DB と実物の Playwright（chromium）で通す。Instagram と Storage は偽物。
 * REQ-002 設計 6章（公開用画像の準備）
 */
@Import({ TestcontainersConfiguration.class, FakeExternalsConfiguration.class })
@SpringBootTest
@ActiveProfiles("test")
class TemplateRenderingScenarioTest {

	/** 画像化のコードはブラウザを自動ダウンロードしないので、使う chromium だけを入れておく */
	@BeforeAll
	static void installChromium() {
		ChromiumInstaller.ensureInstalled();
	}

	@Autowired JobRepository jobRepository;
	@Autowired PostPublishing publishing;
	@Autowired PostRepository postRepository;
	@Autowired TickScenario tick;
	@Autowired FakeInstagram instagram;
	@Autowired FakeRenderStorage storage;
	@Autowired TokenCipher cipher;
	@Autowired JdbcTemplate jdbc;
	@Autowired TransactionTemplate tx;

	SupabaseFixture db;
	UUID tenant;
	LoggedIn admin;
	LoggedIn editor;
	LoggedIn approver;

	@BeforeEach
	void setUp() {
		instagram.reset();
		db = new SupabaseFixture(jdbc, tx);
		jdbc.update("update jobs set status = 'SUCCEEDED', locked_until = null where status in ('PENDING','RUNNING')");
		String suffix = UUID.randomUUID().toString().substring(0, 8);
		tenant = db.tenant("新島info-" + suffix);
		admin = db.member(tenant, "ad-" + suffix + "@example.com", "ADMIN");
		editor = db.member(tenant, "e-" + suffix + "@example.com", "EDITOR");
		approver = db.member(tenant, "a-" + suffix + "@example.com", "APPROVER");
		jdbc.update("""
				insert into tenant_settings (tenant_id, version, llm_provider, llm_model, llm_daily_limit, llm_warn_ratio,
				  publish_grace_minutes, pr_label, auto_draft_enabled) values (?, 1, 'GEMINI', 'gemini-flash', 100, 0.8, 360, '【PR】', false)
				""", tenant);
		connectInstagram();
		db.as(admin, j -> j.queryForObject("select public.save_post_style_settings('同志社生向けSNSメディア', '{同志社大学}'::text[], "
				+ "'ご覧いただきありがとうございます', '@niijima_info', '---\nフッター', '{#固定}'::text[], null)", Integer.class));
	}

	@Test
	@DisplayName("AC-002-02 4スライドの投稿は、1080×1350 の JPEG 4枚に画像化され、公開用に記録されて公開される")
	void rendersFourSlides() {
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(background(), body("学割が使える", material(null)), body("文字だけ", null)));

		tick.run("render-1");

		assertThat(status(post)).isEqualTo("PUBLISHED");
		long approval = latestApproval(post);
		for (int position = 1; position <= 4; position++) {
			BufferedImage image = decode(storage.objects.get(tenant + "/renders/" + approval + "/" + position + ".jpg"));
			assertThat(image.getWidth()).isEqualTo(1080);
			assertThat(image.getHeight()).isEqualTo(1350);
		}
		assertThat(jdbc.queryForObject("select count(*) from template_renders where approval_event_id = ?", Integer.class, approval)).isEqualTo(4);
		assertThat(jdbc.queryForObject("select count(*) from template_publish_media where approval_event_id = ?", Integer.class, approval)).isEqualTo(4);
		assertThat(instagram.publishCalls.get()).isEqualTo(1);
	}

	@Test
	@DisplayName("AC-002-23 画像化に必要な画像が無いと、投稿は失敗（画像化の失敗）になり、公開されない")
	void missingImageFailsRendering() {
		String missing = "{\"storagePath\":\"" + tenant + "/posts/" + UUID.randomUUID() + ".jpg\",\"width\":800,\"height\":600,\"byteSize\":1000}";
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(background(), body("学割が使える", missing)));

		tick.run("render-2");

		assertThat(status(post)).isEqualTo("FAILED");
		assertThat(jdbc.queryForObject("select last_failure_kind from post_current where post_id = ?", String.class, post)).isEqualTo("RENDER_FAILED");
		assertThat(instagram.publishCalls.get()).isZero();
		assertThat(jdbc.queryForObject("select status from jobs where post_id = ? and job_type = 'PREPARE_MEDIA'", String.class, post)).isEqualTo("FAILED");
	}

	@Test
	@DisplayName("AC-002-23 他の団体の画像を指す参照は、読まずに失敗（画像化の失敗）にする")
	void otherTenantImageIsRejected() {
		UUID otherTenant = db.tenant("他団体-" + UUID.randomUUID());
		String foreign = otherTenant + "/posts/" + UUID.randomUUID() + ".jpg";
		storage.objects.put(foreign, jpeg(800, 600, new Color(200, 30, 30)));
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(background(), body("学割が使える", material(null))));
		jdbc.execute("alter table body_materials disable trigger body_materials_append_only");
		jdbc.update("update body_materials set storage_path = ? where slide_id in (select s.id from post_slides s join post_revisions r on r.id = s.revision_id where r.post_id = ?)",
				foreign, post);
		jdbc.execute("alter table body_materials enable trigger body_materials_append_only");

		tick.run("render-3");

		assertThat(status(post)).isEqualTo("FAILED");
		assertThat(jdbc.queryForObject("select last_failure_kind from post_current where post_id = ?", String.class, post)).isEqualTo("RENDER_FAILED");
	}

	@Test
	@DisplayName("AC-002-19 写真風の生成画像を素材画像にした投稿は、AI info が付き、キャプションにAI生成の表示が付く")
	void photorealisticMaterialGetsAiDisclosure() {
		UUID generation = UUID.randomUUID();
		db.asServiceRole(j -> j.queryForList("select public.record_image_generation(?, ?, ?, 'PHOTOREALISTIC', '桜並木', "
				+ "'cherry blossoms', 'CLOUDFLARE_WORKERS_AI', 'flux', 'SUCCEEDED', 4)", generation, tenant, editor.memberId()));
		String generated = material("{\"generationId\":\"" + generation + "\",\"candidatePosition\":1}");
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(background(), body("学割が使える", generated)));

		tick.run("render-4");

		assertThat(status(post)).isEqualTo("PUBLISHED");
		assertThat(instagram.aiGeneratedContainers).hasSize(1);
		assertThat(instagram.publishedCaptions).singleElement().asString().contains("※画像はAIで生成したイメージです").contains("#固定");
	}

	@Test
	@DisplayName("AC-002-14 人が差し替えた画像の素材画像には、AI生成の表示が付かない")
	void replacedMaterialHasNoAiDisclosure() {
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(background(), body("学割が使える", material(null))));

		tick.run("render-5");

		assertThat(status(post)).isEqualTo("PUBLISHED");
		assertThat(instagram.aiGeneratedContainers).isEmpty();
		assertThat(instagram.publishedCaptions).singleElement().asString().doesNotContain("AIで生成");
	}

	@Test
	@DisplayName("AC-002-02 AC-007-08 下書きに戻して再承認すると、新しい承認の出来事の画像を作り直す。公開済みの投稿があっても、最後のスライドに過去の投稿は載らない（承認の記録にも残らない）")
	void reapprovalRendersAgain() {
		UUID post = approvedPost(Instant.now().plus(Duration.ofDays(1)), template(background(), body("学割が使える", material(null))));
		tick.run("render-6a");
		long first = latestApproval(post);
		publishedUploadPost();

		db.as(approver, j -> j.queryForList("select public.cancel_schedule(?)", post));
		reapprove(post, template(background(), body("学割が使える", material(null))));
		tick.run("render-6b");

		long second = latestApproval(post);
		assertThat(second).isGreaterThan(first);
		assertThat(jdbc.queryForObject("select count(*) from approval_past_posts where approval_event_id = ?", Integer.class, second)).isZero();
		assertThat(jdbc.queryForObject("select count(*) from template_renders where approval_event_id = ?", Integer.class, second)).isEqualTo(3);
		assertThat(jdbc.queryForObject("select count(*) from template_renders where approval_event_id = ?", Integer.class, first)).isEqualTo(3);
		assertThat(coverRowColors(second)).as("最後のスライドの画像の欄は空のまま").allMatch(this::isPlainBackground);
	}

	// ───────── 最後のスライドの画像（REQ-007） ─────────

	/** 画像化した最後のスライド（3枚目）で、画像の枠の中心の色。2枚なら左 (320, 608)・右 (760, 608)、1枚なら真ん中 (540, 608) */
	private static final int[][] FRAME_CENTERS = { { 320, 608 }, { 540, 608 }, { 760, 608 } };

	private static final Color RED = new Color(200, 30, 30);
	private static final Color BLUE = new Color(30, 30, 200);
	private static final Color GREEN = new Color(30, 170, 60);

	private List<Color> coverRowColors(long approval) {
		BufferedImage image = decode(storage.objects.get(tenant + "/renders/" + approval + "/3.jpg"));
		return java.util.Arrays.stream(FRAME_CENTERS).map(p -> new Color(image.getRGB(p[0], p[1]))).toList();
	}

	private static boolean isNear(Color actual, Color expected) {
		return Math.abs(actual.getRed() - expected.getRed()) < 60 && Math.abs(actual.getGreen() - expected.getGreen()) < 60
				&& Math.abs(actual.getBlue() - expected.getBlue()) < 60;
	}

	/** 画像の枠の中心が、画像の色（赤・青・緑）のどれでもない（背景のまま） */
	private boolean isPlainBackground(Color color) {
		return !isNear(color, RED) && !isNear(color, BLUE) && !isNear(color, GREEN);
	}

	private String putClosingImage(Color color) {
		String path = tenant + "/style/" + UUID.randomUUID() + ".jpg";
		storage.objects.put(path, jpeg(800, 1000, color));
		return path;
	}

	private void saveStyleWithClosingImages(String... paths) {
		String literal = java.util.Arrays.stream(paths).map(p -> "\"" + p + "\"").collect(java.util.stream.Collectors.joining(",", "{", "}"));
		db.as(admin, j -> j.queryForObject("select public.save_post_style_settings('同志社生向けSNSメディア', '{同志社大学}'::text[], "
				+ "'ご覧いただきありがとうございます', '@niijima_info', '---\nフッター', '{#固定}'::text[], null, ?::text[])", Integer.class, literal));
	}

	@Test
	@DisplayName("AC-007-05 設定の最後のスライドの画像が2枚なら、画像化した最後のスライドの左に1枚目・右に2枚目が並ぶ（承認の記録は空）")
	void twoClosingImagesAreRenderedLeftAndRight() {
		saveStyleWithClosingImages(putClosingImage(RED), putClosingImage(BLUE));
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(background(), body("学割が使える", material(null))));

		tick.run("closing-2");

		assertThat(status(post)).isEqualTo("PUBLISHED");
		List<Color> colors = coverRowColors(latestApproval(post));
		assertThat(isNear(colors.get(0), RED)).as("左: " + colors.get(0)).isTrue();
		assertThat(isNear(colors.get(2), BLUE)).as("右: " + colors.get(2)).isTrue();
		assertThat(isPlainBackground(colors.get(1))).as("真ん中は2枚の間の隙間: " + colors.get(1)).isTrue();
	}

	@Test
	@DisplayName("AC-007-05 設定の最後のスライドの画像が1枚なら真ん中に1枚、0枚なら画像の欄なし。どちらも定型文などの位置は変わらない")
	void oneAndZeroClosingImages() {
		saveStyleWithClosingImages(putClosingImage(RED));
		UUID one = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(background(), body("学割が使える", material(null))));
		saveStyleWithClosingImages();
		UUID none = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(background(), body("学割が使える", material(null))));

		tick.run("closing-1-0");

		List<Color> oneColors = coverRowColors(latestApproval(one));
		assertThat(isNear(oneColors.get(1), RED)).as("真ん中: " + oneColors.get(1)).isTrue();
		assertThat(isPlainBackground(oneColors.get(0))).isTrue();
		assertThat(isPlainBackground(oneColors.get(2))).isTrue();
		assertThat(coverRowColors(latestApproval(none))).allMatch(this::isPlainBackground);
	}

	@Test
	@DisplayName("AC-007-06 設定の画像をあとで変えても、すでに保存した下書きを承認して画像化すると保存した時点の画像のまま")
	void laterSettingsChangeDoesNotChangeASavedDraft() {
		saveStyleWithClosingImages(putClosingImage(RED));
		UUID saved = db.as(editor, j -> j.queryForObject("select post_id from public.save_post_revision(null, ?::jsonb)", UUID.class,
				template(background(), body("学割が使える", material(null)))));
		saveStyleWithClosingImages(putClosingImage(BLUE));

		requestAndApprove(saved, Instant.now().minus(Duration.ofMinutes(5)));
		tick.run("closing-keep");

		List<Color> colors = coverRowColors(latestApproval(saved));
		assertThat(isNear(colors.get(1), RED)).as("真ん中: " + colors.get(1)).isTrue();
	}

	@Test
	@DisplayName("AC-007-09 AC-002-15 REQ-007 より前の承認が過去の投稿の表紙を記録していれば、設定の画像があっても記録した表紙を載せる（設定の画像に変えない）")
	void legacyApprovalRecordWinsOverSettingsImages() {
		saveStyleWithClosingImages(putClosingImage(RED), putClosingImage(BLUE));
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(background(), body("学割が使える", material(null))));
		UUID past = publishedUploadPost();
		String cover = tenant + "/posts/" + UUID.randomUUID() + ".jpg";
		storage.objects.put(cover, jpeg(1080, 1350, GREEN));
		jdbc.update("insert into approval_past_posts (approval_event_id, position, past_post_id, cover_storage_path) values (?, 1, ?, ?)",
				latestApproval(post), past, cover);

		tick.run("closing-legacy");

		assertThat(status(post)).isEqualTo("PUBLISHED");
		List<Color> colors = coverRowColors(latestApproval(post));
		assertThat(isNear(colors.get(1), GREEN)).as("真ん中は記録した表紙: " + colors.get(1)).isTrue();
		assertThat(isPlainBackground(colors.get(0))).isTrue();
		assertThat(isPlainBackground(colors.get(2))).isTrue();
	}

	/** REQ-007 より前の承認が記録していた過去の投稿の表紙（GREEN）を、承認の出来事に直接書く。表紙の画像は Storage に置く。戻り値は表紙の保存先 */
	private String recordLegacyCover(UUID post) {
		UUID past = publishedUploadPost();
		String cover = tenant + "/posts/" + UUID.randomUUID() + ".jpg";
		storage.objects.put(cover, jpeg(1080, 1350, GREEN));
		jdbc.update("insert into approval_past_posts (approval_event_id, position, past_post_id, cover_storage_path) values (?, 1, ?, ?)",
				latestApproval(post), past, cover);
		return cover;
	}

	@Test
	@DisplayName("AC-007-10 改修前の承認が過去の投稿の表紙を記録していても、下書きに戻して保存し直して再承認すると、新しい承認には記録がなく、保存した時点の設定の画像が載る")
	void reapprovalAfterLegacyApprovalUsesSettingsImages() {
		UUID post = approvedPost(Instant.now().plus(Duration.ofDays(1)), template(background(), body("学割が使える", material(null))));
		long first = latestApproval(post);
		recordLegacyCover(post);
		saveStyleWithClosingImages(putClosingImage(RED));

		db.as(approver, j -> j.queryForList("select public.cancel_schedule(?)", post));
		reapprove(post, template(background(), body("学割が使える", material(null))));
		tick.run("closing-reapprove");

		long second = latestApproval(post);
		assertThat(second).isGreaterThan(first);
		assertThat(jdbc.queryForObject("select count(*) from approval_past_posts where approval_event_id = ?", Integer.class, first)).isEqualTo(1);
		assertThat(jdbc.queryForObject("select count(*) from approval_past_posts where approval_event_id = ?", Integer.class, second)).isZero();
		List<Color> colors = coverRowColors(second);
		assertThat(isNear(colors.get(1), RED)).as("真ん中は設定の画像: " + colors.get(1)).isTrue();
		assertThat(isNear(colors.get(1), GREEN)).as("過去の投稿の表紙は載らない").isFalse();
		assertThat(isPlainBackground(colors.get(0))).isTrue();
		assertThat(isPlainBackground(colors.get(2))).isTrue();
	}

	@Test
	@DisplayName("AC-007-13 画像が見つからず失敗した投稿も、画像を設定し直し、下書きに戻して保存し直して承認すれば、画像化できる")
	void failedByMissingClosingImageRecoversAfterSettingsAreFixedAndSavedAgain() {
		saveStyleWithClosingImages(putClosingImage(RED), tenant + "/style/" + UUID.randomUUID() + ".jpg");
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(background(), body("学割が使える", material(null))));
		tick.run("closing-recover-a");
		assertThat(status(post)).isEqualTo("FAILED");

		saveStyleWithClosingImages(putClosingImage(RED), putClosingImage(BLUE));
		db.as(approver, j -> j.queryForList("select public.return_to_draft(?)", post));
		reapprove(post, template(background(), body("学割が使える", material(null))));
		tick.run("closing-recover-b");

		assertThat(status(post)).isEqualTo("SCHEDULED");
		long approval = latestApproval(post);
		assertThat(jdbc.queryForObject("select count(*) from template_renders where approval_event_id = ?", Integer.class, approval)).isEqualTo(3);
		assertThat(jdbc.queryForObject("select count(*) from template_publish_media where approval_event_id = ?", Integer.class, approval)).isEqualTo(3);
		List<Color> colors = coverRowColors(approval);
		assertThat(isNear(colors.get(0), RED)).isTrue();
		assertThat(isNear(colors.get(2), BLUE)).isTrue();
	}

	@Test
	@DisplayName("AC-007-09 AC-002-15 改修前の承認の表紙が見つからず失敗した投稿は、表紙が戻ってから「今すぐ再実行」すると、記録した表紙（設定の画像ではない）が載る")
	void retryOfALegacyApprovalStillUsesTheRecordedCover() {
		saveStyleWithClosingImages(putClosingImage(RED));
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(background(), body("学割が使える", material(null))));
		String cover = recordLegacyCover(post);
		byte[] coverBytes = storage.objects.remove(cover);

		tick.run("closing-retry-a");

		assertThat(status(post)).isEqualTo("FAILED");
		assertThat(jdbc.queryForObject("select f.message from post_failures f join post_events e on e.id = f.event_id where e.post_id = ?", String.class, post))
				.isEqualTo("画像化に失敗しました。今すぐ再実行でやり直せます（画像化に必要な画像が見つかりません）");

		storage.objects.put(cover, coverBytes);
		db.as(approver, j -> j.queryForList("select public.retry_post(?, ?)", post, Timestamp.from(Instant.now().plus(Duration.ofDays(1)))));
		tick.run("closing-retry-b");

		assertThat(status(post)).isEqualTo("SCHEDULED");
		List<Color> colors = coverRowColors(latestApproval(post));
		assertThat(isNear(colors.get(1), GREEN)).as("真ん中は記録した表紙: " + colors.get(1)).isTrue();
		assertThat(isNear(colors.get(1), RED)).isFalse();
	}

	@Test
	@DisplayName("AC-007-09 改修前の設定の版（最後のスライドの画像なし）で、承認の記録も0件なら、画像の欄なしで描く。公開済みの投稿があっても載せない")
	void legacyApprovalWithoutRecordsDrawsNoImages() {
		publishedUploadPost();
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(background(), body("学割が使える", material(null))));

		tick.run("closing-legacy-0");

		assertThat(status(post)).isEqualTo("PUBLISHED");
		assertThat(coverRowColors(latestApproval(post))).allMatch(this::isPlainBackground);
	}

	@Test
	@DisplayName("AC-007-13 最後のスライドの画像が Storage に見つからないと、画像化の失敗になり、最後のスライドの画像の理由が表示される。公開されない")
	void missingClosingImageFailsWithItsReason() {
		String missing = tenant + "/style/" + UUID.randomUUID() + ".jpg";
		saveStyleWithClosingImages(putClosingImage(RED), missing);
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(background(), body("学割が使える", material(null))));

		tick.run("closing-missing");

		assertThat(status(post)).isEqualTo("FAILED");
		assertThat(jdbc.queryForObject("select last_failure_kind from post_current where post_id = ?", String.class, post)).isEqualTo("RENDER_FAILED");
		assertThat(jdbc.queryForObject("select f.message from post_failures f join post_events e on e.id = f.event_id where e.post_id = ?", String.class, post))
				.isEqualTo("最後のスライドの画像が見つかりません。管理者が画像を設定し直したあと、下書きに戻して保存し直してください");
		assertThat(instagram.publishCalls.get()).isZero();
	}

	@Test
	@DisplayName("AC-002-02 公開用画像が途中までしか準備できていない（4枚中1枚）と、公開は拒否（MEDIA_REJECTED）ではなく準備を待つ")
	void partialPreparationWaitsInsteadOfRejecting() {
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(background(), body("学割が使える", material(null)), body("文字だけ", null)));
		long approval = latestApproval(post);
		UUID revision = jdbc.queryForObject("select revision_id from post_events where id = ?", UUID.class, approval);
		db.asServiceRole(j -> j.queryForList("select public.record_template_render(?, ?, 1, ?, 1080, 1350, 200000)", revision, approval,
				tenant + "/renders/" + approval + "/1.jpg"));
		db.asServiceRole(j -> j.queryForList("select public.record_template_publish_media(?, ?, 1, ?, 1080, 1350, 200000)", revision, approval,
				tenant + "/" + UUID.randomUUID() + ".jpg"));
		jobRepository.enqueueForNewSchedules();
		ClaimedJob claimed = jobRepository.claim(JobType.PUBLISH_POST, "partial").orElseThrow();

		publishing.run(claimed);

		assertThat(status(post)).isEqualTo("SCHEDULED");
		assertThat(jdbc.queryForObject("select count(*) from post_failures f join post_events e on e.id = f.event_id where e.post_id = ?",
				Integer.class, post)).isZero();
		assertThat(jdbc.queryForObject("select status from jobs where post_id = ? and job_type = 'PUBLISH_POST'", String.class, post)).isEqualTo("PENDING");
		assertThat(instagram.publishCalls.get()).isZero();
	}

	@Test
	@DisplayName("AC-002-02 写真の投稿の公開用画像は publish_media だけを読む。テンプレートの記録の表が無くても影響を受けない")
	void photoPostPreparedMediaDoesNotTouchTemplateTables() {
		String path = tenant + "/posts/" + UUID.randomUUID() + ".jpg";
		String revisionJson = "{\"format\":\"FEED_IMAGE\",\"mediaSource\":\"UPLOAD\",\"caption\":\"写真\",\"prCategory\":\"NONE\",\"media\":[{\"position\":1,"
				+ "\"storagePath\":\"" + path + "\",\"width\":1080,\"height\":1350,\"byteSize\":500000}]}";
		UUID post = approvedPost(Instant.now().plus(Duration.ofDays(1)), revisionJson);
		UUID revision = jdbc.queryForObject("select id from post_revisions where post_id = ?", UUID.class, post);
		postRepository.recordPreparedMedia(revision, new PostMedia(1, tenant + "/" + UUID.randomUUID() + ".jpg", 1080, 1350, 500000));

		// テンプレートの記録の表を（このトランザクションの中だけ）無くしても読める
		Integer count = tx.execute(status -> {
			jdbc.execute("alter table template_publish_media rename to template_publish_media_hidden");
			try {
				return postRepository.preparedMedia(revision, jp.co.keai.niijimaig.post.domain.RevisionContent.Preparation.COPY).count();
			} finally {
				status.setRollbackOnly();
			}
		});

		assertThat(count).isEqualTo(1);
	}

	@Test
	@DisplayName("AC-002-23 画像化の持ち時間が尽きていても、準備済みの写真の投稿の公開はその回に動く。画像化は次の定期処理に残る")
	void photoPublishingRunsEvenWhenRenderingHasNoTimeLeft() {
		String path = tenant + "/posts/" + UUID.randomUUID() + ".jpg";
		String photoJson = "{\"format\":\"FEED_IMAGE\",\"mediaSource\":\"UPLOAD\",\"caption\":\"写真\",\"prCategory\":\"NONE\",\"media\":[{\"position\":1,"
				+ "\"storagePath\":\"" + path + "\",\"width\":1080,\"height\":1350,\"byteSize\":500000}]}";
		UUID photo = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), photoJson);
		UUID photoRevision = jdbc.queryForObject("select id from post_revisions where post_id = ?", UUID.class, photo);
		postRepository.recordPreparedMedia(photoRevision, new PostMedia(1, tenant + "/" + UUID.randomUUID() + ".jpg", 1080, 1350, 500000));
		UUID template = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), template(background(), body("学割が使える", material(null))));

		// 持ち時間は8分30秒。7分前に始まっていれば、画像化の締め切り（公開の2分前）はもう過ぎていて、公開の時間だけが残っている
		tick.run("render-budget", Instant.now().minus(Duration.ofMinutes(7)));

		assertThat(status(photo)).isEqualTo("PUBLISHED");
		assertThat(status(template)).isEqualTo("SCHEDULED");
		assertThat(jdbc.queryForObject("select count(*) from template_renders where approval_event_id = ?", Integer.class, latestApproval(template)))
				.isZero();
		assertThat(instagram.publishCalls.get()).isEqualTo(1);
	}

	// ───────── 下ごしらえ ─────────

	private String background() {
		UUID photo = db.as(admin, j -> j.queryForObject("select public.register_background_photo(?, ?)", UUID.class,
				tenant + "/backgrounds/" + UUID.randomUUID() + ".jpg", "校舎"));
		String path = jdbc.queryForObject("select storage_path from background_photos where id = ?", String.class, photo);
		storage.objects.put(path, jpeg(1080, 1350, new Color(40, 80, 140)));
		return "{\"role\":\"COVER\",\"target\":\"同志社大学\",\"keyword\":\"オトクな割引\",\"annotation\":\"＼ 学生のうちに ／\","
				+ "\"closingWords\":\"まとめたよ\",\"accent\":\"RED\",\"backgroundPhotoId\":\"" + photo + "\"}";
	}

	/** 素材画像（Storage に置く）。generation は採用する生成画像の参照の JSON か null */
	private String material(String generation) {
		String path = tenant + "/posts/" + UUID.randomUUID() + ".jpg";
		storage.objects.put(path, jpeg(800, 600, new Color(60, 160, 90)));
		return "{\"storagePath\":\"" + path + "\",\"width\":800,\"height\":600,\"byteSize\":1000"
				+ (generation == null ? "" : ",\"generation\":" + generation) + "}";
	}

	private String body(String heading, String material) {
		return "{\"role\":\"BODY\",\"heading\":\"" + heading + "\",\"description\":\"学生証を見せるだけで割引になります\","
				+ "\"emphases\":[{\"start\":0,\"length\":3}],\"picturePrompt\":\"桜並木\",\"needsReplacement\":false"
				+ (material == null ? "" : ",\"material\":" + material) + "}";
	}

	private String template(String cover, String... bodies) {
		String slides = cover + "," + String.join(",", bodies) + ",{\"role\":\"CLOSING\"}";
		return "{\"format\":\"CAROUSEL\",\"mediaSource\":\"TEMPLATE\",\"caption\":\"本文\",\"prCategory\":\"NONE\","
				+ "\"templateVersion\":\"niijima@1\",\"hashtags\":[\"#学割\"],\"slides\":[" + slides + "]}";
	}

	private UUID approvedPost(Instant scheduledAt, String revisionJson) {
		UUID post = db.as(editor, j -> j.queryForObject("select post_id from public.save_post_revision(null, ?::jsonb)", UUID.class, revisionJson));
		requestAndApprove(post, scheduledAt);
		return post;
	}

	private void reapprove(UUID post, String revisionJson) {
		db.as(editor, j -> j.queryForObject("select revision_id from public.save_post_revision(?, ?::jsonb)", UUID.class, post, revisionJson));
		requestAndApprove(post, Instant.now().plus(Duration.ofDays(1)));
	}

	private void requestAndApprove(UUID post, Instant scheduledAt) {
		UUID revision = jdbc.queryForObject("select id from post_revisions where post_id = ? order by revision_no desc limit 1", UUID.class, post);
		db.as(editor, j -> j.queryForList("select public.request_approval(?, ?)", post, revision));
		db.as(approver, j -> j.queryForList("select public.approve_post(?, ?, ?)", post, revision, Timestamp.from(scheduledAt)));
	}

	/** 公開済みのアップロードの投稿（REQ-007 より前は最後のスライドに載せる過去の投稿になった。今は選ばれない）。戻り値は投稿ID */
	private UUID publishedUploadPost() {
		String path = tenant + "/posts/" + UUID.randomUUID() + ".jpg";
		storage.objects.put(path, jpeg(1080, 1350, new Color(150, 60, 160)));
		String revision = "{\"format\":\"FEED_IMAGE\",\"mediaSource\":\"UPLOAD\",\"caption\":\"過去\",\"prCategory\":\"NONE\",\"media\":[{\"position\":1,"
				+ "\"storagePath\":\"" + path + "\",\"width\":1080,\"height\":1350,\"byteSize\":500000}]}";
		UUID past = db.as(editor, j -> j.queryForObject("select post_id from public.save_post_revision(null, ?::jsonb)", UUID.class, revision));
		requestAndApprove(past, Instant.now().plus(Duration.ofDays(1)));
		UUID rev = jdbc.queryForObject("select id from post_revisions where post_id = ?", UUID.class, past);
		jdbc.update("insert into post_events (post_id, event_type, from_status, to_status, revision_id) values (?, 'PUBLISH_STARTED', 'SCHEDULED', 'PUBLISHING', ?)", past, rev);
		jdbc.update("insert into post_events (post_id, event_type, from_status, to_status, revision_id) values (?, 'PUBLISHED', 'PUBLISHING', 'PUBLISHED', ?)", past, rev);
		jdbc.update("insert into post_publications (post_id, ig_media_id, permalink, published_at) values (?, ?, ?, now())",
				past, "ig-" + UUID.randomUUID(), "https://www.instagram.com/p/x/");
		return past;
	}

	private void connectInstagram() {
		UUID connection = jdbc.queryForObject("""
				insert into instagram_connections (tenant_id, ig_user_id, ig_username, account_type, connected_by)
				values (?, '1784', 'niijima_info', 'BUSINESS', ?) returning id""", UUID.class, tenant, approver.memberId());
		TokenCipher.Sealed sealed = cipher.seal(new AccessToken("test-token"), connection);
		jdbc.update("""
				insert into instagram_token_grants (connection_id, grant_kind, token_ciphertext, token_iv, key_version, expires_at)
				values (?, 'INITIAL', ?, ?, ?, ?)""", connection, sealed.ciphertext(), sealed.iv(), sealed.keyVersion(),
				Timestamp.from(Instant.now().plus(Duration.ofDays(50))));
	}

	private long latestApproval(UUID post) {
		return jdbc.queryForObject("select max(id) from post_events where post_id = ? and event_type = 'APPROVED'", Long.class, post);
	}

	private String status(UUID post) {
		return jdbc.queryForObject("select status from post_current where post_id = ?", String.class, post);
	}

	private static byte[] jpeg(int width, int height, Color color) {
		BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
		Graphics2D g = image.createGraphics();
		g.setColor(color);
		g.fillRect(0, 0, width, height);
		g.dispose();
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		try {
			ImageIO.write(image, "jpg", out);
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
		return out.toByteArray();
	}

	private static BufferedImage decode(byte[] jpeg) {
		try {
			return ImageIO.read(new ByteArrayInputStream(jpeg));
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
	}
}
