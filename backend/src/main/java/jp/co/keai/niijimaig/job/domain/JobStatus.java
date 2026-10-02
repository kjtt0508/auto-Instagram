package jp.co.keai.niijimaig.job.domain;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/** ジョブ状態（domain.yaml ジョブ状態） */
public enum JobStatus {
	PENDING, RUNNING, SUCCEEDED, FAILED;

	private static final Map<JobStatus, Set<JobStatus>> ALLOWED = Map.of(
			PENDING, EnumSet.of(RUNNING),
			RUNNING, EnumSet.of(SUCCEEDED, FAILED, PENDING),
			SUCCEEDED, EnumSet.noneOf(JobStatus.class),
			FAILED, EnumSet.noneOf(JobStatus.class));

	public boolean canTransitTo(JobStatus next) {
		return ALLOWED.get(this).contains(next);
	}

	public JobStatus transitTo(JobStatus next) {
		if (!canTransitTo(next)) {
			throw new IllegalStateException(this + " から " + next + " へは遷移できない");
		}
		return next;
	}
}
