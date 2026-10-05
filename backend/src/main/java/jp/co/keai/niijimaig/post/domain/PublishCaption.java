package jp.co.keai.niijimaig.post.domain;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * 公開用キャプション: Instagram に公開する文。組み立てはここ1か所だけ:
 * PR表記（PR案件のみ）→ キャプション → AI生成の表示（要るときのみ）→ キャプションの定型（テンプレートの投稿のみ）→
 * ハッシュタグ（固定＋追加。テンプレートの投稿のみ。1行に1つ）。2,200文字以下・ハッシュタグ30個以下。
 * TS の PublishCaption と揃える（docs/model/fixtures/caption.json）
 */
public final class PublishCaption {

	/** 定型・ハッシュタグの前に空行を1つ入れる */
	static final String SECTION_SEPARATOR = "\n\n";
	static final String HASHTAG_SEPARATOR = "\n";
	private static final String PR_NAME = "PR表記";
	private static final String TEMPLATE_PARTS_NAME = "キャプションの定型とハッシュタグ";

	private final String text;
	private final int captionLength;
	private final List<String> noticeNames;
	private final boolean hasTemplateParts;

	private PublishCaption(String text, int captionLength, List<String> noticeNames, boolean hasTemplateParts) {
		this.text = text;
		this.captionLength = captionLength;
		this.noticeNames = noticeNames;
		this.hasTemplateParts = hasTemplateParts;
	}

	/** 組み立てる。上限を超えていても作る（理由は violations() で返す）。captionText は検査しない本文 */
	static PublishCaption assemble(String prefix, String captionText, AiDisclosure disclosure, Optional<CaptionFooter> footer,
			List<String> hashtags) {
		String footerPart = footer.map(f -> SECTION_SEPARATOR + f.text()).orElse("");
		String hashtagPart = hashtags.isEmpty() ? "" : SECTION_SEPARATOR + String.join(HASHTAG_SEPARATOR, hashtags);
		// 違反の説明に名前を出すのはPR表記とAI生成の表示だけ。定型とハッシュタグは名前に出さず、文字数には数える
		List<String> names = new ArrayList<>();
		if (!prefix.isEmpty()) {
			names.add(PR_NAME);
		}
		if (disclosure.isRequired()) {
			names.add(AiDisclosure.NAME);
		}
		String assembled = prefix + captionText + disclosure.suffix() + footerPart + hashtagPart;
		return new PublishCaption(assembled, codePoints(captionText), List.copyOf(names), footer.isPresent() || !hashtags.isEmpty());
	}

	public String text() {
		return text;
	}

	public int length() {
		return codePoints(text);
	}

	public long hashtagCount() {
		return Hashtag.IN_TEXT.matcher(text).results().count();
	}

	/** キャプションに使える残りの文字数（付記・定型・ハッシュタグを除いた分。負なら付記だけで上限を超えている） */
	public int remainingForCaption() {
		return Caption.MAX_LENGTH - (length() - captionLength);
	}

	/** 満たさない項目。文字数の超過には、付けたもの（PR表記・AI生成の表示）の名前と文字数を添える */
	public List<String> violations() {
		List<String> violations = new ArrayList<>();
		lengthViolation().ifPresent(violations::add);
		violations.addAll(hashtagViolations());
		return List.copyOf(violations);
	}

	/** 文字数の違反（上限以内なら無し）。付けたものの名前と文字数を添える */
	public Optional<String> lengthViolation() {
		if (length() <= Caption.MAX_LENGTH) {
			return Optional.empty();
		}
		String limit = String.format(Locale.JAPAN, "%,d", Caption.MAX_LENGTH);
		String count = String.format(Locale.JAPAN, "%,d", length());
		if (!noticeNames.isEmpty()) {
			return Optional.of(String.join("と", noticeNames) + "を含めて" + limit + "文字以内にしてください（" + count + "文字）");
		}
		if (hasTemplateParts) {
			return Optional.of(TEMPLATE_PARTS_NAME + "を含めて" + limit + "文字以内にしてください（" + count + "文字）");
		}
		return Optional.of("キャプションは" + limit + "文字以内です（" + count + "文字）");
	}

	/** ハッシュタグの数の違反（30個以内なら空） */
	public List<String> hashtagViolations() {
		if (hashtagCount() <= Caption.MAX_HASHTAGS) {
			return List.of();
		}
		return List.of("ハッシュタグは" + Caption.MAX_HASHTAGS + "個までです（" + hashtagCount() + "個）");
	}

	/** Instagram に渡すキャプション。上限（2,200文字・ハッシュタグ30個）を超えるなら例外 */
	public Caption toCaption() {
		return new Caption(text);
	}

	private static int codePoints(String value) {
		return value.codePointCount(0, value.length());
	}
}
