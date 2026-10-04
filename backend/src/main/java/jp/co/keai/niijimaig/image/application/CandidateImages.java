package jp.co.keai.niijimaig.image.application;

import java.time.Instant;
import java.util.List;

import jp.co.keai.niijimaig.image.domain.ImageCandidate;

/** 候補の画像。記録（DB）と画像（Storage）で実装を分ける（infrastructure） */
public final class CandidateImages {

	private CandidateImages() {
	}

	/** 画像生成の記録から候補を辿る */
	public interface Records {

		/** since 以降の画像生成の候補の位置（全団体・結果を問わず 1〜4）。消したかどうかは問わない（消すのは何度でもよい） */
		List<ImageCandidate> generatedSince(Instant since);
	}

	/** 候補の画像の置き場所 */
	public interface Storage {

		/** 候補の画像を消す（無いものは無視する）。画像生成の記録は残す */
		void delete(List<ImageCandidate> candidates);
	}
}
