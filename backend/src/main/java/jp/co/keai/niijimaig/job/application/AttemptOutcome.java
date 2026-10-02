package jp.co.keai.niijimaig.job.application;

/** 1回の試行の結果（job_attempt_results に追記する内容）。error は区分と説明だけで、秘密情報・本文を含めない */
public record AttemptOutcome(String errorKind, String errorDetail, int inAttemptRetries) {

	public AttemptOutcome {
		errorKind = errorKind == null ? "" : errorKind;
		errorDetail = errorDetail == null ? "" : errorDetail;
		if (inAttemptRetries < 0) {
			throw new IllegalArgumentException("再試行回数は0以上");
		}
	}

	public static AttemptOutcome success(int inAttemptRetries) {
		return new AttemptOutcome("", "", inAttemptRetries);
	}

	public static AttemptOutcome error(String kind, String detail, int inAttemptRetries) {
		return new AttemptOutcome(kind, detail, inAttemptRetries);
	}

	public boolean hasError() {
		return !errorKind.isEmpty();
	}
}
