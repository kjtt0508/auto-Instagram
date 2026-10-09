package jp.co.keai.niijimaig.job.application;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.function.Consumer;

import org.springframework.stereotype.Service;

import jp.co.keai.niijimaig.job.domain.JobType;
import jp.co.keai.niijimaig.post.application.MediaPreparation;
import jp.co.keai.niijimaig.post.application.PostPublishing;

/**
 * シナリオ「tick（15分ごと）」: 稼働記録 → 期限切れジョブの回収 → 新しい予約にジョブを積む →
 * 公開用画像の準備 → 公開 → 稼働記録（REQ-001.md 6.1）。持ち時間を超えそうならジョブを取らずに終わる。
 */
@Service
public class TickScenario {

	/** ワークフロー（.github/workflows/tick.yml）の timeout-minutes と同じ。これを超えると実行が強制終了される */
	static final Duration WORKFLOW_TIMEOUT = Duration.ofMinutes(10);
	/** 強制終了の前に、稼働記録と終了処理を済ませるための余裕 */
	static final Duration SAFETY_MARGIN = Duration.ofSeconds(90);
	/** ジョブの開始時刻が分からないときの持ち時間（この処理の開始から） */
	static final Duration BUDGET = WORKFLOW_TIMEOUT.minus(SAFETY_MARGIN);
	/** 公開用画像の準備を打ち切って、写真の投稿の公開に残す時間 */
	static final Duration RESERVE_FOR_PUBLISH = Duration.ofMinutes(2);
	static final String WORKFLOW = "tick";

	private final BatchHeartbeatRepository heartbeats;
	private final JobRecovery recovery;
	private final JobRepository jobs;
	private final MediaPreparation preparation;
	private final PostPublishing publishing;
	private final Clock clock;

	public TickScenario(BatchHeartbeatRepository heartbeats, JobRecovery recovery, JobRepository jobs,
			MediaPreparation preparation, PostPublishing publishing, Clock clock) {
		this.heartbeats = heartbeats;
		this.recovery = recovery;
		this.jobs = jobs;
		this.preparation = preparation;
		this.publishing = publishing;
		this.clock = clock;
	}

	public void run(String runId) {
		run(runId, clock.instant());
	}

	/**
	 * @param workflowStartedAt ワークフローの実行（ジョブ）が始まった時刻。Java の起動前の手順（ブラウザの用意など）に
	 *                          かかった時間も持ち時間から引くために渡す
	 */
	public void run(String runId, Instant workflowStartedAt) {
		Instant deadline = deadlineFor(workflowStartedAt);
		Instant prepareUntil = deadline.minus(RESERVE_FOR_PUBLISH);
		heartbeats.started(WORKFLOW, runId);
		recovery.run();
		jobs.enqueueForNewSchedules();
		// 画像化が長引いても、写真の投稿の公開の時間を残す: 準備は prepareUntil までで打ち切る（スライドの間で確かめる）
		drain(JobType.PREPARE_MEDIA, runId, prepareUntil, claimed -> preparation.run(claimed, prepareUntil));
		drain(JobType.PUBLISH_POST, runId, deadline, publishing::run);
		heartbeats.finished(WORKFLOW, runId);
	}

	private Instant deadlineFor(Instant workflowStartedAt) {
		Instant fromWorkflow = workflowStartedAt.plus(WORKFLOW_TIMEOUT).minus(SAFETY_MARGIN);
		Instant fromNow = clock.instant().plus(BUDGET);
		return fromWorkflow.isBefore(fromNow) ? fromWorkflow : fromNow;
	}

	private void drain(JobType type, String runId, Instant until, Consumer<ClaimedJob> work) {
		while (clock.instant().isBefore(until)) {
			Optional<ClaimedJob> claimed = jobs.claim(type, runId);
			if (claimed.isEmpty()) {
				return;
			}
			runSafely(claimed.get(), work);
		}
	}

	/**
	 * 1件の想定外の失敗で tick 全体を止めない。ジョブは実行中のまま残り、実行期限が過ぎたら回収される。
	 * ログには ID と例外の種類だけを出す（公開リポジトリのため本文・秘密情報を出さない）。
	 */
	private void runSafely(ClaimedJob claimed, Consumer<ClaimedJob> work) {
		try {
			work.accept(claimed);
		} catch (RuntimeException e) {
			LOG.error("job {} ({}) failed unexpectedly: {}", claimed.job().id(), claimed.job().type(), e.getClass().getSimpleName());
		}
	}

	private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(TickScenario.class);
}
