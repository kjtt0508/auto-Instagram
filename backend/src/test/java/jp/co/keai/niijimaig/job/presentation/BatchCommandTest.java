package jp.co.keai.niijimaig.job.presentation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.DefaultApplicationArguments;

import jp.co.keai.niijimaig.job.application.DailyScenario;
import jp.co.keai.niijimaig.job.application.TickScenario;

class BatchCommandTest {

	private final TickScenario tick = mock(TickScenario.class);
	private final DailyScenario daily = mock(DailyScenario.class);
	private final BatchCommand command = new BatchCommand(tick, daily);

	@Test
	@DisplayName("BatchCommand: --workflow-started-at があれば、その時刻を tick に渡す")
	void tickWithWorkflowStartedAt() {
		command.run(new DefaultApplicationArguments("--job=tick", "--run-id=r1", "--workflow-started-at=1700000000"));

		verify(tick).run("r1", Instant.ofEpochSecond(1700000000L));
		assertThat(command.getExitCode()).isZero();
	}

	@Test
	@DisplayName("BatchCommand: --workflow-started-at が無ければ、時刻なしで tick を呼ぶ")
	void tickWithoutWorkflowStartedAt() {
		command.run(new DefaultApplicationArguments("--job=tick", "--run-id=r2"));

		verify(tick).run("r2");
		verify(tick, never()).run(any(), any(Instant.class));
	}

	@Test
	@DisplayName("BatchCommand: daily は成否を終了コードにする")
	void dailyExitCode() {
		when(daily.run("r3")).thenReturn(false);

		command.run(new DefaultApplicationArguments("--job=daily", "--run-id=r3"));

		assertThat(command.getExitCode()).isEqualTo(1);
	}

	@Test
	@DisplayName("BatchCommand: --job が無ければ何もしない")
	void noJob() {
		command.run(new DefaultApplicationArguments());

		verify(tick, never()).run(any());
		verify(daily, never()).run(eq("local"));
		assertThat(command.getExitCode()).isZero();
	}

	@Test
	@DisplayName("BatchCommand: 未知の --job は拒否する")
	void unknownJob() {
		assertThatThrownBy(() -> command.run(new DefaultApplicationArguments("--job=x")))
				.isInstanceOf(IllegalArgumentException.class);
	}
}
