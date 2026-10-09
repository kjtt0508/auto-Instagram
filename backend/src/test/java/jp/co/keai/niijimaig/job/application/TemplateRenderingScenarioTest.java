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
	@DisplayName("AC-002-15 下書きに戻して再承認すると、新しい承認の出来事の画像を作り直し、最後のスライドに選び直した過去の投稿を載せる")
	void reapprovalRendersAgain() {
		UUID post = approvedPost(Instant.now().plus(Duration.ofDays(1)), template(background(), body("学割が使える", material(null))));
		tick.run("render-6a");
		long first = latestApproval(post);
		byte[] firstClosing = storage.objects.get(tenant + "/renders/" + first + "/3.jpg");
		publishedUploadPost();

		db.as(approver, j -> j.queryForList("select public.cancel_schedule(?)", post));
		reapprove(post, template(background(), body("学割が使える", material(null))));
		tick.run("render-6b");

		long second = latestApproval(post);
		assertThat(second).isGreaterThan(first);
		assertThat(jdbc.queryForObject("select count(*) from approval_past_posts where approval_event_id = ?", Integer.class, second)).isEqualTo(1);
		assertThat(jdbc.queryForObject("select count(*) from template_renders where approval_event_id = ?", Integer.class, second)).isEqualTo(3);
		assertThat(jdbc.queryForObject("select count(*) from template_renders where approval_event_id = ?", Integer.class, first)).isEqualTo(3);
		assertThat(storage.objects.get(tenant + "/renders/" + second + "/3.jpg")).isNotEqualTo(firstClosing);
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

	/** 公開済みのアップロードの投稿（最後のスライドに載せる過去の投稿になる） */
	private void publishedUploadPost() {
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
