package jp.co.keai.niijimaig.post.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import static jp.co.keai.niijimaig.post.domain.PostStatus.*;

@DisplayName("投稿状態の遷移表（domain.yaml 投稿状態と一致）")
class PostStatusTest {

	/** domain.yaml の transitions をそのまま書いたもの（仕様） */
	static final Map<PostStatus, Set<PostStatus>> SPEC = Map.of(
			DRAFT, EnumSet.of(AWAITING_APPROVAL, DISCARDED),
			AWAITING_APPROVAL, EnumSet.of(SCHEDULED, DRAFT, DISCARDED),
			SCHEDULED, EnumSet.of(PUBLISHING, DRAFT, FAILED),
			PUBLISHING, EnumSet.of(PUBLISHED, FAILED, SCHEDULED),
			PUBLISHED, EnumSet.noneOf(PostStatus.class),
			FAILED, EnumSet.of(SCHEDULED, DRAFT, DISCARDED),
			DISCARDED, EnumSet.noneOf(PostStatus.class));

	@ParameterizedTest(name = "{0} からの遷移")
	@EnumSource(PostStatus.class)
	void 遷移表の全組み合わせ(PostStatus from) {
		for (PostStatus to : PostStatus.values()) {
			assertThat(from.canTransitTo(to)).as(from + " → " + to).isEqualTo(SPEC.get(from).contains(to));
		}
	}

	@ParameterizedTest
	@EnumSource(value = PostStatus.class, names = { "PUBLISHED", "DISCARDED" })
	void 公開済みと破棄からはどこへも遷移できない(PostStatus terminal) {
		assertThatThrownBy(() -> terminal.transitTo(DRAFT)).isInstanceOf(IllegalStateException.class);
	}

	@ParameterizedTest
	@EnumSource(PostStatus.class)
	void 編集できるのは下書きだけ(PostStatus status) {
		assertThat(status.isEditable()).isEqualTo(status == DRAFT);
	}
}
