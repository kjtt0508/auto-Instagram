package jp.co.keai.niijimaig.image.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class ImageCandidateTest {

	static final Instant GENERATED = Instant.parse("2026-10-04T01:00:00Z");

	@Test
	@DisplayName("AC-005-13 画像生成から24時間ちょうどはまだ放置ではなく、それを過ぎたら放置")
	void abandonedAfter24Hours() {
		ImageCandidate candidate = new ImageCandidate(UUID.randomUUID(), UUID.randomUUID(), 1, GENERATED);

		assertThat(candidate.isAbandoned(GENERATED.plus(Duration.ofHours(23)))).isFalse();
		assertThat(candidate.isAbandoned(GENERATED.plus(Duration.ofHours(24)))).isFalse();
		assertThat(candidate.isAbandoned(GENERATED.plus(Duration.ofHours(24)).plusSeconds(1))).isTrue();
	}

	@Test
	void 候補の位置は1から4() {
		assertThatThrownBy(() -> new ImageCandidate(UUID.randomUUID(), UUID.randomUUID(), 0, GENERATED))
				.isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> new ImageCandidate(UUID.randomUUID(), UUID.randomUUID(), 5, GENERATED))
				.isInstanceOf(IllegalArgumentException.class);
	}
}
