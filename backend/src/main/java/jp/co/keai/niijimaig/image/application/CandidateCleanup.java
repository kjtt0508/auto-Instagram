package jp.co.keai.niijimaig.image.application;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import jp.co.keai.niijimaig.image.domain.ImageCandidate;

/**
 * ユースケース「放置された候補を消す」（REQ-005 設計 1章、ADR-0009）: daily で、画像生成から24時間を過ぎた候補の画像を消す。
 * daily が止まった日があっても拾えるよう、過去7日分の画像生成を見る（消すのは何度でもよい）
 */
@Service
public class CandidateCleanup {

	static final Duration LOOK_BACK = Duration.ofDays(7);
	private static final Logger LOG = LoggerFactory.getLogger(CandidateCleanup.class);

	private final CandidateImages.Records records;
	private final CandidateImages.Storage storage;
	private final Clock clock;

	public CandidateCleanup(CandidateImages.Records records, CandidateImages.Storage storage, Clock clock) {
		this.records = records;
		this.storage = storage;
		this.clock = clock;
	}

	/** 片付けに失敗しても daily 全体は失敗させない（次の daily でまた消す） */
	public void run() {
		Instant now = clock.instant();
		try {
			List<ImageCandidate> abandoned = records.generatedSince(now.minus(LOOK_BACK)).stream()
					.filter(c -> c.isAbandoned(now)).toList();
			storage.delete(abandoned);
			LOG.info("放置された候補を片付けた: {}枚", abandoned.size());
		} catch (RuntimeException e) {
			LOG.warn("放置された候補を片付けられなかった（次の daily で再試行）: {}", e.getMessage());
		}
	}
}
