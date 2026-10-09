package jp.co.keai.niijimaig.job.presentation;

import java.time.Instant;
import java.util.List;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.ExitCodeGenerator;
import org.springframework.stereotype.Component;

import jp.co.keai.niijimaig.job.application.DailyScenario;
import jp.co.keai.niijimaig.job.application.TickScenario;

/**
 * 定期処理の入口（GitHub Actions から `java -jar batch.jar --job=tick --run-id=...`）。
 * --job が無ければ何もしない（テストやローカル起動で勝手に動かないように）。
 * daily でトークンの期限が迫って更新に失敗したら、終了コード 1 でワークフローを失敗させる。
 */
@Component
public class BatchCommand implements ApplicationRunner, ExitCodeGenerator {

	private final TickScenario tick;
	private final DailyScenario daily;
	private int exitCode;

	public BatchCommand(TickScenario tick, DailyScenario daily) {
		this.tick = tick;
		this.daily = daily;
	}

	@Override
	public void run(ApplicationArguments args) {
		String runId = single(args.getOptionValues("run-id")).orElse("local");
		single(args.getOptionValues("job")).ifPresent(job -> exitCode = runJob(job, runId));
	}

	private int runJob(String job, String runId) {
		if ("tick".equals(job)) {
			single(args.getOptionValues("workflow-started-at"))
					.map(epochSeconds -> Instant.ofEpochSecond(Long.parseLong(epochSeconds)))
					.ifPresentOrElse(startedAt -> tick.run(runId, startedAt), () -> tick.run(runId));
			return 0;
		}
		if ("daily".equals(job)) {
			return daily.run(runId) ? 0 : 1;
		}
		throw new IllegalArgumentException("--job は tick か daily: " + job);
	}

	private java.util.Optional<String> single(List<String> values) {
		return values == null ? java.util.Optional.empty() : values.stream().findFirst();
	}

	@Override
	public int getExitCode() {
		return exitCode;
	}
}
