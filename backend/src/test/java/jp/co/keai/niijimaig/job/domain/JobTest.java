package jp.co.keai.niijimaig.job.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;

import org.junit.jupiter.api.Test;

class JobTest {

	@Test
	void 試行回数が残っていれば待機に戻し_尽きたら失敗() {
		assertThat(running(1, 4).failedOrRetry().willRetry()).isTrue();
		assertThat(running(4, 4).failedOrRetry().isFinallyFailed()).isTrue();
	}

	@Test
	void 実行期限切れの回収も同じ規則() {
		assertThat(running(2, 3).recoverExpired().willRetry()).isTrue();
		assertThat(running(3, 3).recoverExpired().isFinallyFailed()).isTrue();
	}

	@Test
	void 持ち越した試行は数えない_待機に戻し上限を1つ増やす() {
		Job deferred = running(3, 3).deferred();

		assertThat(deferred.willRetry()).isTrue();
		assertThat(deferred.maxAttempts()).isEqualTo(4);
		assertThat(running(3, 3).failedOrRetry().isFinallyFailed()).isTrue();
	}

	@Test
	void 重複防止の鍵は種別_対象_機会で決まる() {
		assertThat(JobType.PUBLISH_POST.dedupeKey("p1", 7L)).isEqualTo("PUBLISH_POST:p1:7");
	}

	private Job running(int done, int max) {
		return new Job(UUID.randomUUID(), JobType.PUBLISH_POST, JobStatus.RUNNING, new Job.Attempts(done, max));
	}
}
