package jp.co.keai.niijimaig.job.application;

import java.util.Optional;
import java.util.UUID;

import jp.co.keai.niijimaig.job.domain.Job;

/** 実行権を取ったジョブ: ジョブと、その試行（何回目か）と、対象の投稿 */
public record ClaimedJob(Job job, long attemptId, Optional<UUID> postId) {

	public ClaimedJob {
		if (job == null || postId == null) {
			throw new IllegalArgumentException("ジョブと対象は必須");
		}
	}

	public UUID requirePostId() {
		return postId.orElseThrow(() -> new IllegalStateException(job.type() + " には投稿が必要"));
	}
}
