package jp.co.keai.niijimaig.job.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.stream.IntStream;

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
import jp.co.keai.niijimaig.post.domain.FailureKind;
import jp.co.keai.niijimaig.support.FakeExternalsConfiguration;
import jp.co.keai.niijimaig.support.FakeInstagram;
import jp.co.keai.niijimaig.support.SupabaseFixture;
import jp.co.keai.niijimaig.support.SupabaseFixture.LoggedIn;

/** tick（15分ごとの定期処理）を実際の DB で通す。Instagram と Storage は偽物 */
@Import({ TestcontainersConfiguration.class, FakeExternalsConfiguration.class })
@SpringBootTest
@ActiveProfiles("test")
class TickScenarioTest {

	@Autowired TickScenario tick;
	@Autowired DailyScenario daily;
	@Autowired JobRepository jobs;
	@Autowired FakeInstagram instagram;
	@Autowired TokenCipher cipher;
	@Autowired JdbcTemplate jdbc;
	@Autowired TransactionTemplate tx;

	SupabaseFixture db;
	UUID tenant;
	LoggedIn editor;
	LoggedIn approver;

	@BeforeEach
	void setUp() {
		instagram.reset();
		db = new SupabaseFixture(jdbc, tx);
		jdbc.update("update jobs set status = 'SUCCEEDED', locked_until = null where status in ('PENDING','RUNNING')");
		String suffix = UUID.randomUUID().toString().substring(0, 8);
		tenant = db.tenant("新島info-" + suffix);
		editor = db.member(tenant, "e-" + suffix + "@example.com", "EDITOR");
		approver = db.member(tenant, "a-" + suffix + "@example.com", "APPROVER");
		jdbc.update("""
				insert into tenant_settings (tenant_id, version, llm_provider, llm_model, llm_daily_limit, llm_warn_ratio,
				  publish_grace_minutes, pr_label, auto_draft_enabled) values (?, 1, 'GEMINI', 'gemini-flash', 100, 0.8, 360, '【PR】', false)
				""", tenant);
		connectInstagram(Instant.now().plus(Duration.ofDays(50)));
	}

	@Test
	@DisplayName("AC-001-12 予約日時を過ぎた投稿が公開され、メディアIDとパーマリンクが記録される")
	void publishesDuePost() {
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), "学園祭のお知らせ");

		tick.run("run-1");

		assertThat(status(post)).isEqualTo("PUBLISHED");
		assertThat(jdbc.queryForObject("select permalink from post_publications where post_id = ?", String.class, post))
				.startsWith("https://www.instagram.com/p/");
		assertThat(instagram.publishCalls.get()).isEqualTo(1);
		assertThat(jdbc.queryForObject("select count(*) from batch_heartbeats where run_id = 'run-1'", Integer.class)).isEqualTo(2);
	}

	@Test
	@DisplayName("AC-001-13 公開猶予（6時間）を過ぎた投稿は公開せず失敗（公開猶予切れ）にする")
	void graceExceeded() {
		UUID post = approvedPost(Instant.now().minus(Duration.ofHours(6).plusMinutes(1)), "古いお知らせ");

		tick.run("run-2");

		assertThat(status(post)).isEqualTo("FAILED");
		assertThat(lastFailureKind(post)).isEqualTo("GRACE_EXCEEDED");
		assertThat(instagram.publishCalls.get()).isZero();
	}

	@Test
	@DisplayName("AC-001-14 実行権を同時に取りに行っても、取れるのは1つだけ")
	void onlyOneClaimWins() throws Exception {
		approvedPost(Instant.now().minus(Duration.ofMinutes(1)), "同時実行");
		jobs.enqueueForNewSchedules();

		List<Callable<Optional<ClaimedJob>>> claims = IntStream.range(0, 8)
				.mapToObj(i -> (Callable<Optional<ClaimedJob>>) () -> jobs.claim(JobType.PUBLISH_POST, "runner-" + i))
				.toList();
		long winners = Executors.newFixedThreadPool(8).invokeAll(claims).stream()
				.map(f -> { try { return f.get(); } catch (Exception e) { throw new IllegalStateException(e); } })
				.filter(Optional::isPresent).count();

		assertThat(winners).isEqualTo(1);
	}

	@Test
	@DisplayName("AC-001-15 公開APIの直後に落ちても、次の tick でコンテナの状態を確かめ二重公開しない")
	void recoversWithoutDoublePublishing() {
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), "中断テスト");
		tick.run("run-3a");
		// 公開済みの記録だけが失われた状況を作る（処理が落ちた）
		simulateCrashAfterPublish(post);

		tick.run("run-3b");

		assertThat(status(post)).isEqualTo("PUBLISHED");
		assertThat(instagram.publishCalls.get()).isEqualTo(1);
	}

	@Test
	@DisplayName("AC-001-16 一時的なエラー2回の後に成功したら公開済みになり、同じ試行内の再試行2回が記録される")
	void retriesTransientErrors() {
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), "リトライ");
		instagram.containerFailures.add(FailureKind.TRANSIENT);
		instagram.containerFailures.add(FailureKind.TRANSIENT);

		tick.run("run-4");

		assertThat(status(post)).isEqualTo("PUBLISHED");
		assertThat(jdbc.queryForObject("""
				select r.in_job_retries from job_attempt_results r join job_attempts a on a.id = r.job_attempt_id
				  join jobs j on j.id = a.job_id where j.post_id = ? and j.job_type = 'PUBLISH_POST'
				""", Integer.class, post)).isEqualTo(2);
	}

	@Test
	@DisplayName("AC-001-17 トークン無効はリトライせず失敗（連携切れ）になり、連携のやり直しを案内する")
	void tokenInvalidFailsWithoutRetry() {
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), "連携切れ");
		instagram.containerFailures.add(FailureKind.TOKEN_INVALID);

		tick.run("run-5");

		assertThat(status(post)).isEqualTo("FAILED");
		assertThat(lastFailureKind(post)).isEqualTo("TOKEN_INVALID");
		assertThat(jdbc.queryForObject("select message from post_failures where post_id = ?", String.class, post))
				.contains("連携をやり直してください");
		assertThat(instagram.containerCalls.get()).isEqualTo(1);
	}

	@Test
	@DisplayName("AC-001-18 失敗した投稿を承認者が今すぐ再実行すると、次の tick で公開される")
	void retryAfterFailure() {
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), "再実行");
		instagram.containerFailures.add(FailureKind.TOKEN_INVALID);
		tick.run("run-6a");

		db.as(approver, j -> j.queryForList("select public.retry_post(?, ?)", post, Timestamp.from(Instant.now())));
		tick.run("run-6b");

		assertThat(status(post)).isEqualTo("PUBLISHED");
	}

	@Test
	@DisplayName("BR-001-09 公開数の上限なら予約中に戻し（公開延期）、ジョブは次の tick に回す")
	void deferredWhenRateLimited() {
		UUID post = approvedPost(Instant.now().minus(Duration.ofMinutes(5)), "上限");
		instagram.quotaAvailable = false;

		tick.run("run-7");

		assertThat(status(post)).isEqualTo("SCHEDULED");
		assertThat(jdbc.queryForObject("select status from jobs where post_id = ? and job_type = 'PUBLISH_POST'",
				String.class, post)).isEqualTo("PENDING");
	}

	@Test
	@DisplayName("AC-001-20 残り7日でトークン更新に失敗したら、daily はワークフローを失敗させる")
	void dailyFailsWorkflowWhenTokenNearlyExpired() {
		jdbc.update("insert into instagram_disconnections (connection_id, disconnected_by) "
				+ "select id, ? from instagram_connections where tenant_id = ?", approver.memberId(), tenant);
		connectInstagram(Instant.now().plus(Duration.ofDays(7)));
		instagram.refreshFailure = Optional.of(FailureKind.TOKEN_INVALID);

		boolean ok = daily.run("daily-1");

		assertThat(ok).isFalse();
		assertThat(jdbc.queryForObject("""
				select count(*) from instagram_token_refresh_failures f join instagram_connections c on c.id = f.connection_id
				 where c.tenant_id = ?""", Integer.class, tenant)).isEqualTo(1);
	}

	@Test
	@DisplayName("AC-001-19 残り30日以下なら更新し、新しいトークンの記録が追記される")
	void dailyRefreshesToken() {
		jdbc.update("insert into instagram_disconnections (connection_id, disconnected_by) "
				+ "select id, ? from instagram_connections where tenant_id = ?", approver.memberId(), tenant);
		connectInstagram(Instant.now().plus(Duration.ofDays(30)));

		assertThat(daily.run("daily-2")).isTrue();
		assertThat(jdbc.queryForObject("""
				select count(*) from instagram_token_grants g join instagram_connections c on c.id = g.connection_id
				 where c.tenant_id = ? and g.grant_kind = 'REFRESH'""", Integer.class, tenant)).isEqualTo(1);
	}

	private UUID approvedPost(Instant scheduledAt, String caption) {
		String revision = """
				{"format":"FEED_IMAGE","mediaSource":"UPLOAD","caption":"%s","prCategory":"NONE",
				 "media":[{"position":1,"storagePath":"%s/posts/%s.jpg","width":1080,"height":1350,"byteSize":500000}]}
				""".formatted(caption, tenant, UUID.randomUUID());
		UUID post = db.as(editor, j -> j.queryForObject("select post_id from public.save_post_revision(null, ?::jsonb)", UUID.class, revision));
		UUID rev = jdbc.queryForObject("select id from post_revisions where post_id = ?", UUID.class, post);
		db.as(editor, j -> j.queryForList("select public.request_approval(?, ?)", post, rev));
		db.as(approver, j -> j.queryForList("select public.approve_post(?, ?, ?)", post, rev, Timestamp.from(scheduledAt)));
		return post;
	}

	private void connectInstagram(Instant expiresAt) {
		UUID connection = jdbc.queryForObject("""
				insert into instagram_connections (tenant_id, ig_user_id, ig_username, account_type, connected_by)
				values (?, '1784', 'niijima_info', 'BUSINESS', ?) returning id""", UUID.class, tenant, approver.memberId());
		TokenCipher.Sealed sealed = cipher.seal(new AccessToken("test-token"), connection);
		jdbc.update("""
				insert into instagram_token_grants (connection_id, grant_kind, token_ciphertext, token_iv, key_version, expires_at)
				values (?, 'INITIAL', ?, ?, ?, ?)""", connection, sealed.ciphertext(), sealed.iv(), sealed.keyVersion(),
				Timestamp.from(expiresAt));
	}

	/** 公開には成功したが、記録の前に落ちた: 公開の記録と出来事を消し、ジョブを実行中（期限切れ）に戻す */
	private void simulateCrashAfterPublish(UUID post) {
		jdbc.execute("alter table post_publications disable trigger post_publications_append_only");
		jdbc.execute("alter table post_events disable trigger post_events_append_only");
		jdbc.update("delete from post_publications where post_id = ?", post);
		jdbc.update("delete from post_events where id = (select max(id) from post_events where post_id = ?)", post);
		jdbc.execute("alter table post_publications enable trigger post_publications_append_only");
		jdbc.execute("alter table post_events enable trigger post_events_append_only");
		jdbc.update("""
				update jobs set status = 'RUNNING', locked_until = now() - interval '1 minute'
				 where post_id = ? and job_type = 'PUBLISH_POST'""", post);
	}

	private String status(UUID post) {
		return jdbc.queryForObject("select status from post_current where post_id = ?", String.class, post);
	}

	private String lastFailureKind(UUID post) {
		return jdbc.queryForObject("select last_failure_kind from post_current where post_id = ?", String.class, post);
	}
}
