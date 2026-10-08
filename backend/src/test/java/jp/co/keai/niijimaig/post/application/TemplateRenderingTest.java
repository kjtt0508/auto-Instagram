package jp.co.keai.niijimaig.post.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import jp.co.keai.niijimaig.job.application.AttemptOutcome;
import jp.co.keai.niijimaig.job.application.ClaimedJob;
import jp.co.keai.niijimaig.job.application.JobRepository;
import jp.co.keai.niijimaig.job.domain.Job;
import jp.co.keai.niijimaig.job.domain.JobStatus;
import jp.co.keai.niijimaig.job.domain.JobType;
import jp.co.keai.niijimaig.post.domain.BodyContent;
import jp.co.keai.niijimaig.post.domain.Caption;
import jp.co.keai.niijimaig.post.domain.CaptionFooter;
import jp.co.keai.niijimaig.post.domain.ClosingContent;
import jp.co.keai.niijimaig.post.domain.CoverContent;
import jp.co.keai.niijimaig.post.domain.CoverText;
import jp.co.keai.niijimaig.post.domain.FailureKind;
import jp.co.keai.niijimaig.post.domain.FailureReason;
import jp.co.keai.niijimaig.post.domain.FixedHashtags;
import jp.co.keai.niijimaig.post.domain.PastPostCover;
import jp.co.keai.niijimaig.post.domain.Post;
import jp.co.keai.niijimaig.post.domain.PostEvent;
import jp.co.keai.niijimaig.post.domain.PostFormat;
import jp.co.keai.niijimaig.post.domain.PostMedia;
import jp.co.keai.niijimaig.post.domain.PostMediaList;
import jp.co.keai.niijimaig.post.domain.PostRepository;
import jp.co.keai.niijimaig.post.domain.PostRevision;
import jp.co.keai.niijimaig.post.domain.PostStatus;
import jp.co.keai.niijimaig.post.domain.PostStyleSettings;
import jp.co.keai.niijimaig.post.domain.PrCategory;
import jp.co.keai.niijimaig.post.domain.PublishResult;
import jp.co.keai.niijimaig.post.domain.ScheduledAt;
import jp.co.keai.niijimaig.post.domain.Slide;
import jp.co.keai.niijimaig.post.domain.SlideList;
import jp.co.keai.niijimaig.post.domain.SlideText;

/**
 * 公開用画像の準備（画像化）の振る舞いを、偽の Storage・記録・描画で確かめる（REQ-002 設計 6・7章）。
 * 失敗の分類（一時的な失敗は再試行、内容による失敗は RENDER_FAILED）、冪等（記録済みは作り直さない）、途中からの再開。
 */
class TemplateRenderingTest {

	static final Instant NOW = Instant.parse("2026-10-08T00:00:00Z");

	UUID tenant = UUID.randomUUID();
	UUID revisionId = UUID.randomUUID();
	long approval = 77;
	String background = tenant + "/backgrounds/bg.jpg";
	String pastCover = tenant + "/renders/5/1.jpg";

	FakeRecords records = new FakeRecords();
	FakeRenderStorage storage = new FakeRenderStorage();
	ScriptedRenderer renderer = new ScriptedRenderer();
	FakeMediaStorage media = new FakeMediaStorage();
	FakePosts posts = new FakePosts();
	FakeJobs jobs = new FakeJobs();
	MediaPreparation preparation;

	@BeforeEach
	void setUp() {
		storage.objects.put(background, new byte[] {1});
		storage.objects.put(pastCover, new byte[] {2});
		records.past = List.of(PastPostCover.restore(UUID.randomUUID(), pastCover));
		TemplateRendering rendering = new TemplateRendering(records, storage, renderer, media);
		preparation = new MediaPreparation(posts, new MediaCopying(posts, media), rendering, jobs, Clock.fixed(NOW, ZoneOffset.UTC));
		posts.post = scheduledPost(PostStatus.SCHEDULED);
	}

	// ───────── ブラウザが起動できないとき ─────────

	@ParameterizedTest(name = "{0}")
	@EnumSource(Attempt.class)
	@DisplayName("AC-002-23 ブラウザを起動できないとき、1・2回目はジョブを再試行にし、3回目は画像化の失敗（RENDER_FAILED）にする")
	void browserUnavailable(Attempt attempt) {
		renderer.script.add(() -> {
			throw new RenderBrowserUnavailableException(new RuntimeException("chromium がありません"));
		});

		preparation.run(claimed(attempt.number));

		if (attempt.finalAttempt) {
			assertThat(jobs.finished.get(0).next.status()).isEqualTo(JobStatus.FAILED);
			assertThat(posts.failures).singleElement().satisfies(f -> assertThat(f.kind()).isEqualTo(FailureKind.RENDER_FAILED));
			assertThat(jobs.finished.get(0).outcome.errorKind()).isEqualTo("RENDER_FAILED");
		} else {
			assertThat(jobs.finished.get(0).next.status()).isEqualTo(JobStatus.PENDING);
			assertThat(jobs.finished.get(0).runAgainAt).isEqualTo(NOW.plus(MediaPreparation.RETRY_AFTER));
			assertThat(jobs.finished.get(0).outcome.errorKind()).isEqualTo("BROWSER_UNAVAILABLE");
			assertThat(posts.failures).isEmpty();
		}
	}

	enum Attempt {
		FIRST(1, false), SECOND(2, false), THIRD(3, true);

		final int number;
		final boolean finalAttempt;

		Attempt(int number, boolean finalAttempt) {
			this.number = number;
			this.finalAttempt = finalAttempt;
		}
	}

	// ───────── 失敗の分類 ─────────

	/** 外部の都合で起きる失敗（Storage の 5xx・接続失敗、記録の失敗） */
	enum ExternalFailure {
		STORAGE_READ, STORAGE_SAVE, STORAGE_COPY_TO_PUBLIC, RECORD;

		void breakIt(TemplateRenderingTest t) {
			switch (this) {
				case STORAGE_READ -> t.storage.readFailure = new IllegalStateException("Storage からの読み込みに失敗: HTTP 503");
				case STORAGE_SAVE -> t.storage.saveFailure = new IllegalStateException("Storage に接続できない: IOException");
				case STORAGE_COPY_TO_PUBLIC -> t.media.failure = new IllegalStateException("Storage への複製に失敗: HTTP 502");
				case RECORD -> t.records.failure = new IllegalStateException("接続が切れた");
			}
		}
	}

	@ParameterizedTest(name = "{0}")
	@EnumSource(ExternalFailure.class)
	@DisplayName("AC-002-23 Storage の 5xx・接続失敗（画像の読み込み・保存・公開用への複製）と記録の失敗は一時的な失敗: 再試行にし、投稿は失敗にしない")
	void temporaryFailuresAreRetried(ExternalFailure failure) {
		failure.breakIt(this);

		preparation.run(claimed(1));

		assertThat(jobs.finished).hasSize(1);
		assertThat(jobs.finished.get(0).next.status()).isEqualTo(JobStatus.PENDING);
		assertThat(posts.failures).isEmpty();
	}

	@Test
	@DisplayName("AC-002-23 一時的な失敗が3回目も続いたら、画像化の失敗（RENDER_FAILED）にする")
	void temporaryFailureOnFinalAttemptFailsRendering() {
		media.failure = new IllegalStateException("Storage への複製に失敗: HTTP 502");
		renderer.script.add(() -> jpeg(1080, 1350));

		preparation.run(claimed(3));

		assertThat(jobs.finished.get(0).next.status()).isEqualTo(JobStatus.FAILED);
		assertThat(posts.failures).singleElement().satisfies(f -> assertThat(f.kind()).isEqualTo(FailureKind.RENDER_FAILED));
	}

	@Test
	@DisplayName("AC-002-23 内容による失敗（画像が無い）は、再試行せずにその場で画像化の失敗（RENDER_FAILED）にする")
	void missingImageFailsAtOnce() {
		storage.objects.remove(background);

		preparation.run(claimed(1));

		assertThat(jobs.finished.get(0).next.status()).isEqualTo(JobStatus.FAILED);
		assertThat(posts.failures).singleElement().satisfies(f -> assertThat(f.kind()).isEqualTo(FailureKind.RENDER_FAILED));
		assertThat(renderer.calls).isEmpty();
	}

	@Test
	@DisplayName("AC-002-23 画像化した画像が仕様に合わない（大きさが違う）のは内容による失敗: その場で画像化の失敗にする")
	void wrongSizeFailsAtOnce() {
		renderer.script.add(() -> jpeg(800, 600));

		preparation.run(claimed(1));

		assertThat(jobs.finished.get(0).next.status()).isEqualTo(JobStatus.FAILED);
		assertThat(posts.failures).hasSize(1);
		assertThat(media.copies).isEmpty();
	}

	@Test
	@DisplayName("AC-002-23 描画の失敗は内容による失敗: その場で画像化の失敗にする")
	void renderFailureFailsAtOnce() {
		renderer.script.add(() -> {
			throw new RenderFailedException("テンプレートの描画に失敗しました");
		});

		preparation.run(claimed(1));

		assertThat(jobs.finished.get(0).next.status()).isEqualTo(JobStatus.FAILED);
		assertThat(posts.failures).hasSize(1);
	}

	@Test
	@DisplayName("AC-002-23 準備の途中で下書きに戻されていたら、失敗の出来事を作らない（ジョブだけを終える）")
	void noFailureEventAfterBeingReturnedToDraft() {
		posts.post = scheduledPost(PostStatus.DRAFT);
		storage.objects.remove(background);

		preparation.run(claimed(1));

		assertThat(posts.failures).isEmpty();
		assertThat(jobs.finished.get(0).next.status()).isEqualTo(JobStatus.FAILED);
	}

	// ───────── 冪等・再開 ─────────

	@Test
	@DisplayName("AC-002-02 3枚を順に画像化し、公開用への複製は承認と順番から決まる名前で行う")
	void rendersAllSlidesWithStableNames() {
		for (int i = 0; i < 3; i++) {
			renderer.script.add(() -> jpeg(1080, 1350));
		}

		preparation.run(claimed(1));

		assertThat(jobs.finished.get(0).next.status()).isEqualTo(JobStatus.SUCCEEDED);
		assertThat(records.renders.keySet()).containsExactlyInAnyOrder(77L * 10 + 1, 77L * 10 + 2, 77L * 10 + 3);
		assertThat(media.copies).extracting(c -> c.key).containsExactly("render/77/1", "render/77/2", "render/77/3");
		assertThat(records.publish.keySet()).hasSize(3);
	}

	@Test
	@DisplayName("AC-002-15 画像は、そのスライドが使うものだけをテンプレートに渡す（表紙は背景写真、最後は過去の投稿の表紙）")
	void imagesArePassedPerSlide() {
		for (int i = 0; i < 3; i++) {
			renderer.script.add(() -> jpeg(1080, 1350));
		}

		preparation.run(claimed(1));

		assertThat(renderer.calls).hasSize(3);
		assertThat(imageKeys(0)).containsExactly(background);
		assertThat(imageKeys(1)).isEmpty();
		assertThat(imageKeys(2)).containsExactly(pastCover);
	}

	@SuppressWarnings("unchecked")
	private List<String> imageKeys(int call) {
		return List.copyOf(((Map<String, Object>) renderer.calls.get(call).get("images")).keySet());
	}

	@Test
	@DisplayName("AC-002-02 記録済みの順番は描き直さない。公開用の記録がある順番は複製もしない")
	void recordedPositionsAreNotRenderedOrCopiedAgain() {
		records.addRender(approval, 1);
		records.addRender(approval, 2);
		records.addRender(approval, 3);
		records.addPublish(approval, 1);
		records.addPublish(approval, 2);
		records.addPublish(approval, 3);

		preparation.run(claimed(1));

		assertThat(jobs.finished.get(0).next.status()).isEqualTo(JobStatus.SUCCEEDED);
		assertThat(renderer.calls).isEmpty();
		assertThat(media.copies).isEmpty();
		assertThat(storage.saved).isEmpty();
	}

	@Test
	@DisplayName("AC-002-02 途中まで準備した状態（1枚目は公開用まで、2枚目は描画のみ）から再開すると、残りだけを作る")
	void resumesFromPartialPreparation() {
		records.addRender(approval, 1);
		records.addPublish(approval, 1);
		records.addRender(approval, 2);
		renderer.script.add(() -> jpeg(1080, 1350));

		preparation.run(claimed(1));

		assertThat(jobs.finished.get(0).next.status()).isEqualTo(JobStatus.SUCCEEDED);
		assertThat(renderer.calls).hasSize(1);
		assertThat(media.copies).extracting(c -> c.key).containsExactly("render/77/2", "render/77/3");
		assertThat(records.publish.keySet()).hasSize(3);
	}

	@Test
	@DisplayName("AC-002-02 承認された版を承認した出来事が最新でなければ（再承認された）、記録せずに再試行にする")
	void staleApprovalIsNotUsed() {
		records.approvalRevision = UUID.randomUUID();

		preparation.run(claimed(1));

		assertThat(jobs.finished.get(0).next.status()).isEqualTo(JobStatus.PENDING);
		assertThat(renderer.calls).isEmpty();
	}

	// ───────── 下ごしらえ ─────────

	private ClaimedJob claimed(int attempt) {
		Job job = new Job(UUID.randomUUID(), JobType.PREPARE_MEDIA, JobStatus.RUNNING, new Job.Attempts(attempt, 3));
		return new ClaimedJob(job, 1L, Optional.of(posts.post.id()));
	}

	private Post scheduledPost(PostStatus status) {
		PostStyleSettings settings = new PostStyleSettings(tenant, 1, "新島info", List.of("同志社大学"), "ありがとうございます", "@niijima_info",
				new CaptionFooter("定型の文面"), new FixedHashtags(List.of("#固定")), Optional.empty());
		List<Slide> slides = List.of(
				new Slide(new CoverContent(CoverText.restore(new CoverText.Parts("同志社大学", "期末試験", "", "まとめたよ", "RED")),
						Optional.of(new CoverContent.Background(UUID.randomUUID(), background)))),
				new Slide(new BodyContent(SlideText.restore("学割が使える", "学生証を見せるだけで割引になります", List.of("学生証")), Optional.empty())),
				new Slide(ClosingContent.empty()));
		PostRevision revision = PostRevision.ofSlides(new Caption("本文"), PrCategory.NONE, SlideList.of(slides), "niijima@1", settings, List.of());
		records.approvalRevision = revisionId;
		return new Post(new Post.Identity(UUID.randomUUID(), tenant), status,
				new Post.ApprovedContent(revisionId, PostFormat.CAROUSEL, revision), ScheduledAt.restore(NOW));
	}

	static byte[] jpeg(int width, int height) {
		BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		try {
			ImageIO.write(image, "jpg", out);
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
		return out.toByteArray();
	}

	// ───────── 偽物 ─────────

	/** 順に決めた結果を返す描画。台本が尽きたら 1080×1350 の JPEG */
	static class ScriptedRenderer implements TemplateRenderer {
		final Deque<Supplier<byte[]>> script = new ArrayDeque<>();
		final List<Map<String, Object>> calls = new ArrayList<>();

		@Override
		public byte[] render(String templateVersion, Map<String, Object> data) {
			calls.add(data);
			Supplier<byte[]> next = script.poll();
			return next == null ? jpeg(1080, 1350) : next.get();
		}
	}

	static class FakeRenderStorage implements RenderStorage {
		final Map<String, byte[]> objects = new HashMap<>();
		final List<String> saved = new ArrayList<>();
		RuntimeException readFailure;
		RuntimeException saveFailure;

		@Override
		public Optional<byte[]> read(UUID tenantId, String privatePath) {
			if (readFailure != null) {
				throw readFailure;
			}
			return Optional.ofNullable(objects.get(privatePath));
		}

		@Override
		public void save(UUID tenantId, String privatePath, byte[] jpeg) {
			if (saveFailure != null) {
				throw saveFailure;
			}
			saved.add(privatePath);
			objects.put(privatePath, jpeg);
		}
	}

	record Copy(String privatePath, String key) {
	}

	static class FakeMediaStorage implements MediaStorage {
		final List<Copy> copies = new ArrayList<>();
		RuntimeException failure;

		@Override
		public String copyToPublic(UUID tenantId, String privatePath) {
			throw new UnsupportedOperationException();
		}

		@Override
		public String copyToPublic(UUID tenantId, String privatePath, String idempotencyKey) {
			if (failure != null) {
				throw failure;
			}
			copies.add(new Copy(privatePath, idempotencyKey));
			return tenantId + "/" + UUID.nameUUIDFromBytes(idempotencyKey.getBytes()) + ".jpg";
		}

		@Override
		public String publicUrl(String publicPath) {
			return "https://example.test/" + publicPath;
		}
	}

	/** 画像化の記録。renders / publish のキーは 承認*10+順番 */
	class FakeRecords implements RenderRecords {
		final Map<Long, PostMedia> renders = new HashMap<>();
		final Map<Long, PostMedia> publish = new HashMap<>();
		List<PastPostCover> past = List.of();
		UUID approvalRevision;
		RuntimeException failure;

		void addRender(long approvalEvent, int position) {
			renders.put(approvalEvent * 10 + position,
					new PostMedia(position, tenant + "/renders/" + approvalEvent + "/" + position + ".jpg", 1080, 1350, 1000));
		}

		void addPublish(long approvalEvent, int position) {
			publish.put(approvalEvent * 10 + position, new PostMedia(position, tenant + "/pub-" + position + ".jpg", 1080, 1350, 1000));
		}

		private void check() {
			if (failure != null) {
				throw failure;
			}
		}

		@Override
		public long approvalEvent(UUID postId, UUID approvedRevisionId) {
			check();
			if (!approvedRevisionId.equals(approvalRevision)) {
				throw new IllegalStateException("承認された版を承認した出来事がありません");
			}
			return approval;
		}

		@Override
		public List<PastPostCover> pastPosts(long approvalEventId) {
			check();
			return past;
		}

		@Override
		public Optional<PostMedia> rendered(long approvalEventId, int position) {
			check();
			return Optional.ofNullable(renders.get(approvalEventId * 10 + position));
		}

		@Override
		public void recordRender(UUID revision, long approvalEventId, PostMedia rendered) {
			check();
			renders.put(approvalEventId * 10 + rendered.position(), rendered);
		}

		@Override
		public Optional<PostMedia> publishMedia(UUID revision, long approvalEventId, int position) {
			check();
			return Optional.ofNullable(publish.get(approvalEventId * 10 + position));
		}

		@Override
		public void recordPublishMedia(UUID revision, long approvalEventId, PostMedia published) {
			check();
			publish.put(approvalEventId * 10 + published.position(), published);
		}
	}

	static class FakePosts implements PostRepository {
		Post post;
		final List<FailureReason> failures = new ArrayList<>();

		@Override
		public Optional<Post> findForPublishing(UUID postId) {
			return Optional.ofNullable(post);
		}

		@Override
		public void recordFailure(Post target, PostEvent failedEvent, FailureReason reason) {
			failures.add(reason);
		}

		@Override
		public PostMediaList preparedMedia(UUID revisionId) {
			return new PostMediaList(List.of());
		}

		@Override
		public void recordPreparedMedia(UUID revisionId, PostMedia prepared) {
			throw new UnsupportedOperationException();
		}

		@Override
		public void record(Post target, PostEvent event) {
			throw new UnsupportedOperationException();
		}

		@Override
		public void recordPublished(Post target, PostEvent publishedEvent, PublishResult result) {
			throw new UnsupportedOperationException();
		}
	}

	record Finished(Job next, AttemptOutcome outcome, Instant runAgainAt) {
	}

	static class FakeJobs implements JobRepository {
		final List<Finished> finished = new ArrayList<>();

		@Override
		public int enqueueForNewSchedules() {
			return 0;
		}

		@Override
		public Optional<ClaimedJob> claim(JobType type, String runner) {
			return Optional.empty();
		}

		@Override
		public List<ClaimedJob> expiredRunning() {
			return List.of();
		}

		@Override
		public void finish(ClaimedJob claimed, Job next, AttemptOutcome outcome, Instant runAgainAt) {
			finished.add(new Finished(next, outcome, runAgainAt));
		}
	}
}
